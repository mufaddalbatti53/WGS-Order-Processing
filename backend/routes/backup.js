// backend/routes/backup.js
const express = require('express');
const path = require('path');
const { Readable } = require('stream');
const { google } = require('googleapis');
const { Company, User, Client, Order, Notification, Product } = require('../db/models');
const { auth, adminOnly } = require('../middleware/auth');
const router = express.Router();

// Apply authentication & ensure only Admins can run backups
router.use(auth);
router.use(adminOnly);

// 1. Helper: Fetch all company data
async function fetchAllData(companyId) {
  const company = await Company.findById(companyId).lean();
  const staff = await User.find({ company_id: companyId }).lean();
  const clients = await Client.find({ company_id: companyId }).lean();
  const orders = await Order.find({ company_id: companyId }).lean();
  const products = await Product.find({ company_id: companyId }).lean(); // Included the new products
  const notifications = await Notification.find({ company_id: companyId }).lean();

  return {
    meta: {
      company_id: company._id,
      company_name: company.name,
      company_slug: company.slug,
      exported_at: new Date().toISOString(),
      version: '1.0'
    },
    staff, clients, orders, products, notifications
  };
}

// 2. GET /api/backup/status
router.get('/status', async (req, res) => {
  try {
    const staff = await User.countDocuments({ company_id: req.company_id });
    const clients = await Client.countDocuments({ company_id: req.company_id });
    const orders = await Order.countDocuments({ company_id: req.company_id });
    const notifications = await Notification.countDocuments({ company_id: req.company_id });

    // Check if the service-account.json exists and Drive is ready
    let driveConfigured = false;
    try {
      const fs = require('fs');
      driveConfigured = fs.existsSync(path.join(__dirname, '..', 'service-account.json'));
    } catch (e) { }

    res.json({
      data: { staff, clients, orders, notifications },
      driveConfigured,
      driveFolderSet: !!process.env.GOOGLE_DRIVE_FOLDER_ID
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 3. GET /api/backup/download (Local Download)
router.get('/download', async (req, res) => {
  try {
    const backupData = await fetchAllData(req.company_id);
    const filename = `wgs-backup-${backupData.meta.company_slug}-${Date.now()}.json`;

    res.setHeader('Content-disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-type', 'application/json');
    res.send(JSON.stringify(backupData, null, 2));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 4. POST /api/backup/drive (Google Drive Upload)
router.post('/drive', async (req, res) => {
  try {
    const backupData = await fetchAllData(req.company_id);

    // Authenticate with Google using the service account file
    const gAuth = new google.auth.GoogleAuth({
      keyFile: path.join(__dirname, '..', 'service-account.json'),
      scopes: ['https://www.googleapis.com/auth/drive.file']
    });
    const drive = google.drive({ version: 'v3', auth: gAuth });

    // Convert JSON to a readable stream for Google Drive
    const buffer = Buffer.from(JSON.stringify(backupData, null, 2));
    const stream = new Readable();
    stream.push(buffer);
    stream.push(null);

    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    const filename = `WGS_Orders_Backup_${backupData.meta.company_slug}_${new Date().toISOString().split('T')[0]}.json`;

    const driveRes = await drive.files.create({
      requestBody: {
        name: filename,
        parents: folderId ? [folderId] : []
      },
      media: {
        mimeType: 'application/json',
        body: stream
      },
      fields: 'id, name, webViewLink'
    });

    res.json({
      file: {
        id: driveRes.data.id,
        name: driveRes.data.name,
        link: driveRes.data.webViewLink
      },
      stats: {
        staff: backupData.staff.length,
        clients: backupData.clients.length,
        orders: backupData.orders.length,
        products: backupData.products.length,
        notifications: backupData.notifications.length
      }
    });
  } catch (e) {
    console.error('Drive Upload Error:', e);
    res.status(500).json({ error: 'Failed to upload to Google Drive. Check service-account.json and permissions.' });
  }
});

// 5. POST /api/backup/restore (Safe Import)
router.post('/restore', async (req, res) => {
  try {
    const data = req.body;
    if (!data || !data.meta) return res.status(400).json({ error: 'Invalid backup file format' });

    const imp = { staff: 0, clients: 0, orders: 0, products: 0, notifications: 0, skipped: 0 };

    // Safe import function: Only inserts if ID doesn't exist to prevent overwriting current data
    const safeImport = async (Model, items, category) => {
      if (!items || !Array.isArray(items)) return;
      for (const item of items) {
        // Security check: ensure restored data is bound to current company
        item.company_id = req.company_id;
        const exists = await Model.exists({ _id: item._id });
        if (!exists) {
          await Model.create(item);
          imp[category]++;
        } else {
          imp.skipped++;
        }
      }
    };

    await safeImport(User, data.staff, 'staff');
    await safeImport(Client, data.clients, 'clients');
    await safeImport(Order, data.orders, 'orders');
    await safeImport(Product, data.products, 'products');
    await safeImport(Notification, data.notifications, 'notifications');

    res.json({ message: 'Restore successfully completed', imported: imp });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;