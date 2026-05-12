// routes/backup.js — Backup & Restore (admin only)
// Backup: download JSON to device OR push to Google Drive
// Restore: upload a JSON backup file to re-import data
'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { User, Client, Order, Notification, Company } = require('../db/models');
const { auth, adminOnly } = require('../middleware/auth');
const router = express.Router();
router.use(auth, adminOnly);

// ── Google Drive client (service-account based) ────────────
function getDriveClient() {
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON;

  if (!keyFile && !keyJson) return null;

  const authClient = keyJson
    ? new google.auth.GoogleAuth({
        credentials: JSON.parse(keyJson),
        scopes: ['https://www.googleapis.com/auth/drive.file'],
      })
    : new google.auth.GoogleAuth({
        keyFile,
        scopes: ['https://www.googleapis.com/auth/drive.file'],
      });

  return google.drive({ version: 'v3', auth: authClient });
}

// ── Helper: build backup payload ───────────────────────────
async function buildBackup(companyId) {
  const [staff, clients, orders, notifications, company] = await Promise.all([
    User.find({ company_id: companyId }).select('-password').lean(),
    Client.find({ company_id: companyId }).lean(),
    Order.find({ company_id: companyId }).lean(),
    Notification.find({ company_id: companyId }).lean(),
    Company.findById(companyId).lean(),
  ]);

  return {
    meta: {
      app: 'WGS Order Processing',
      version: '1.0',
      exported_at: new Date().toISOString(),
      company_id: String(companyId),
      company_name: company?.name || '',
    },
    company,
    staff,
    clients,
    orders,
    notifications,
  };
}

// ══════════════════════════════════════════════════════════
// GET /api/backup/download
// Returns the JSON file as a download attachment
// ══════════════════════════════════════════════════════════
router.get('/download', async (req, res) => {
  try {
    const data = await buildBackup(req.company_id);
    const filename = `wgs-backup-${data.meta.company_name.replace(/\s+/g, '_')}-${Date.now()}.json`;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[BACKUP] Download error:', e.message);
    res.status(500).json({ error: 'Backup failed: ' + e.message });
  }
});

// ══════════════════════════════════════════════════════════
// POST /api/backup/drive
// Uploads the backup JSON to Google Drive
// ══════════════════════════════════════════════════════════
router.post('/drive', async (req, res) => {
  try {
    const drive = getDriveClient();
    if (!drive) {
      return res.status(503).json({
        error: 'Google Drive not configured. Set GOOGLE_SERVICE_ACCOUNT_KEY_FILE or GOOGLE_SERVICE_ACCOUNT_KEY_JSON in .env',
      });
    }

    const data = await buildBackup(req.company_id);
    const filename = `wgs-backup-${data.meta.company_name.replace(/\s+/g, '_')}-${Date.now()}.json`;
    const tmpPath = path.join('/tmp', filename);
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));

    // Optionally place inside a specific Drive folder
    const folderId = process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID;
    const requestBody = { name: filename, mimeType: 'application/json' };
    if (folderId) requestBody.parents = [folderId];

    const driveRes = await drive.files.create({
      requestBody,
      media: { mimeType: 'application/json', body: fs.createReadStream(tmpPath) },
      fields: 'id,name,webViewLink',
    });

    fs.unlinkSync(tmpPath);

    res.json({
      success: true,
      message: `Backup uploaded to Google Drive`,
      file: {
        id: driveRes.data.id,
        name: driveRes.data.name,
        link: driveRes.data.webViewLink,
      },
      stats: {
        staff: data.staff.length,
        clients: data.clients.length,
        orders: data.orders.length,
        notifications: data.notifications.length,
      },
    });
  } catch (e) {
    console.error('[BACKUP] Drive error:', e.message);
    res.status(500).json({ error: 'Drive upload failed: ' + e.message });
  }
});

// ══════════════════════════════════════════════════════════
// GET /api/backup/status
// Returns Drive config status + backup stats
// ══════════════════════════════════════════════════════════
router.get('/status', async (req, res) => {
  try {
    const [staffCount, clientCount, orderCount, notifCount] = await Promise.all([
      User.countDocuments({ company_id: req.company_id }),
      Client.countDocuments({ company_id: req.company_id }),
      Order.countDocuments({ company_id: req.company_id }),
      Notification.countDocuments({ company_id: req.company_id }),
    ]);

    res.json({
      driveConfigured: !!(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON),
      driveFolderSet: !!process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID,
      data: { staff: staffCount, clients: clientCount, orders: orderCount, notifications: notifCount },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════
// POST /api/backup/restore
// Accepts a JSON backup and re-imports missing records
// (safe: skips duplicates, never overwrites existing data)
// ══════════════════════════════════════════════════════════
router.post('/restore', async (req, res) => {
  try {
    const backup = req.body;
    if (!backup?.meta || !backup.meta.company_id) {
      return res.status(400).json({ error: 'Invalid backup file. Missing meta.company_id.' });
    }

    // Security: only restore into the authenticated manager's own company
    if (String(backup.meta.company_id) !== String(req.company_id)) {
      return res.status(403).json({ error: 'Backup belongs to a different company. Restore denied.' });
    }

    const result = { staff: 0, clients: 0, orders: 0, notifications: 0, skipped: 0 };

    // Restore clients (skip existing by _id)
    for (const c of (backup.clients || [])) {
      try {
        const exists = await Client.findById(c._id);
        if (!exists) {
          await Client.create({ ...c, _id: c._id, company_id: req.company_id });
          result.clients++;
        } else { result.skipped++; }
      } catch { result.skipped++; }
    }

    // Restore orders (skip existing by _id)
    for (const o of (backup.orders || [])) {
      try {
        const exists = await Order.findById(o._id);
        if (!exists) {
          await Order.create({ ...o, _id: o._id, company_id: req.company_id });
          result.orders++;
        } else { result.skipped++; }
      } catch { result.skipped++; }
    }

    // Restore staff (skip existing by _id, never overwrite passwords)
    for (const u of (backup.staff || [])) {
      try {
        const exists = await User.findById(u._id);
        if (!exists) {
          await User.create({ ...u, _id: u._id, company_id: req.company_id });
          result.staff++;
        } else { result.skipped++; }
      } catch { result.skipped++; }
    }

    // Restore notifications (skip existing)
    for (const n of (backup.notifications || [])) {
      try {
        const exists = await Notification.findById(n._id);
        if (!exists) {
          await Notification.create({ ...n, _id: n._id, company_id: req.company_id });
          result.notifications++;
        } else { result.skipped++; }
      } catch { result.skipped++; }
    }

    res.json({
      success: true,
      message: 'Restore completed successfully.',
      imported: result,
    });
  } catch (e) {
    console.error('[RESTORE] Error:', e.message);
    res.status(500).json({ error: 'Restore failed: ' + e.message });
  }
});

module.exports = router;
