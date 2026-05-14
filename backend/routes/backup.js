// backend/routes/backup.js
const express = require('express');
const { Readable } = require('stream');
const { google } = require('googleapis');
const { Company, User, Client, Order, Notification, Product } = require('../db/models');
const { auth, adminOnly } = require('../middleware/auth');
const router = express.Router();

router.use(auth);
router.use(adminOnly);

// Initialize OAuth2 Client
function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

// Helper: Fetch all company data
async function fetchAllData(companyId) {
  const company = await Company.findById(companyId).lean();
  const cid = company._id;
  return {
    meta: { company_id: cid, company_name: company.name, company_slug: company.slug, exported_at: new Date().toISOString() },
    staff: await User.find({ company_id: cid }).lean(),
    clients: await Client.find({ company_id: cid }).lean(),
    orders: await Order.find({ company_id: cid }).lean(),
    products: await Product.find({ company_id: cid }).lean(),
    notifications: await Notification.find({ company_id: cid }).lean()
  };
}

// 1. GET /api/backup/status
router.get('/status', async (req, res) => {
  try {
    const stats = {
      staff: await User.countDocuments({ company_id: req.company_id }),
      clients: await Client.countDocuments({ company_id: req.company_id }),
      orders: await Order.countDocuments({ company_id: req.company_id }),
      notifications: await Notification.countDocuments({ company_id: req.company_id })
    };
    const company = await Company.findById(req.company_id).lean();
    res.json({ data: stats, config: company.backup_config || {} });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 2. GET /api/backup/auth-url (Generate Google Login Link)
router.get('/auth-url', async (req, res) => {
  try {
    const oauth2Client = getOAuthClient();
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline', // CRITICAL: forces refresh_token
      prompt: 'consent',      // CRITICAL: forces prompt so we get token again if needed
      scope: ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/userinfo.email']
    });
    res.json({ url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 3. POST /api/backup/connect (Exchange code for token)
router.post('/connect', async (req, res) => {
  try {
    const { code, folder_id } = req.body;
    const oauth2Client = getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);

    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ auth: oauth2Client, version: 'v2' });
    const userInfo = await oauth2.userinfo.get();

    // Save token and email to company profile
    await Company.findByIdAndUpdate(req.company_id, {
      'backup_config.is_connected': true,
      'backup_config.google_refresh_token': tokens.refresh_token, // Must save this!
      'backup_config.google_email': userInfo.data.email,
      'backup_config.drive_folder_id': folder_id || ''
    });

    res.json({ message: 'Google Drive connected successfully!', email: userInfo.data.email });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 4. POST /api/backup/disconnect
router.post('/disconnect', async (req, res) => {
  try {
    await Company.findByIdAndUpdate(req.company_id, {
      'backup_config.is_connected': false,
      'backup_config.google_refresh_token': '',
      'backup_config.google_email': '',
      'backup_config.drive_folder_id': ''
    });
    res.json({ message: 'Disconnected from Google Drive' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 5. POST /api/backup/drive (Force Upload using saved token)
router.post('/drive', async (req, res) => {
  try {
    const company = await Company.findById(req.company_id).lean();
    const config = company.backup_config;

    if (!config || !config.google_refresh_token) {
      return res.status(400).json({ error: 'Google Drive not connected for this workspace.' });
    }

    const oauth2Client = getOAuthClient();
    oauth2Client.setCredentials({ refresh_token: config.google_refresh_token });
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    const backupData = await fetchAllData(req.company_id);
    const buffer = Buffer.from(JSON.stringify(backupData, null, 2));
    const stream = new Readable(); stream.push(buffer); stream.push(null);

    const filename = `WGS_Backup_${company.slug}_${new Date().toISOString().split('T')[0]}.json`;

    await drive.files.create({
      requestBody: { name: filename, parents: config.drive_folder_id ? [config.drive_folder_id] : [] },
      media: { mimeType: 'application/json', body: stream }
    });

    res.json({ message: 'Backup successfully pushed to Google Drive!' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// 6. POST /api/backup/config (Save automation settings)
router.post('/config', async (req, res) => {
  try {
    const { drive_folder_id, frequency_days } = req.body;
    await Company.findByIdAndUpdate(req.company_id, {
      'backup_config.drive_folder_id': drive_folder_id || '',
      'backup_config.frequency_days': Number(frequency_days) || 0
    });
    res.json({ message: 'Settings saved' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 7. POST /api/backup/restore (Safe Import)
router.post('/restore', async (req, res) => {
  try {
    const data = req.body;
    if (!data || !data.meta) return res.status(400).json({ error: 'Invalid backup file' });
    const imp = { orders: 0, clients: 0 };

    // Helper to safely insert without overwriting
    const safeImport = async (Model, items, key) => {
      if (!items) return;
      for (const item of items) {
        item.company_id = req.company_id; // Secure it
        const exists = await Model.exists({ _id: item._id });
        if (!exists) { await Model.create(item); imp[key]++; }
      }
    };

    await safeImport(User, data.staff, 'staff');
    await safeImport(Client, data.clients, 'clients');
    await safeImport(Order, data.orders, 'orders');
    res.json({ message: 'Restore completed', imported: imp });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
module.exports = router;