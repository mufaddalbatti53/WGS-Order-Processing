// routes/users.js — company-scoped (MongoDB)
const express = require('express');
const bcrypt = require('bcryptjs');
const { User } = require('../db/models');
const { auth, adminOnly } = require('../middleware/auth');
const router = express.Router();
router.use(auth, adminOnly);

const fs = require('fs');
const { google } = require('googleapis');
const { User, Client, Order, Notification } = require('../db/models');

// Google Drive setup
const drive = google.drive({ version: 'v3', auth: new google.auth.GoogleAuth({
  keyFile: 'path/to/credentials.json',
  scopes: ['https://www.googleapis.com/auth/drive.file'],
}) });

router.get('/', async (req, res) => {
  try {
    const users = await User.find({ company_id: req.company_id }).select('-password').sort({ role: 1, name: 1 }).lean();
    res.json(users.map(u => ({ ...u, id: u._id })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { name, email, password, role, phone } = req.body;
    if (!name?.trim() || !email?.trim() || !password) return res.status(400).json({ error: 'Name, email and password required' });
    if (!['admin', 'partner', 'quality', 'billing'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    const exists = await User.findOne({ company_id: req.company_id, email: email.trim().toLowerCase() });
    if (exists) return res.status(400).json({ error: 'Email already exists in this company' });
    const u = await User.create({
      company_id: req.company_id,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password: bcrypt.hashSync(password, 10),
      role,
      phone: phone || '',
    });
    const safe = await User.findById(u._id).select('-password').lean();
    res.status(201).json({ ...safe, id: safe._id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/backup', async (req, res) => {
  try {
    // Fetch data
    const staff = await User.find({ company_id: req.company_id }).lean();
    const clients = await Client.find({ company_id: req.company_id }).lean();
    const orders = await Order.find({ company_id: req.company_id }).lean();
    const notifications = await Notification.find({ company_id: req.company_id }).lean();

    // Create backup file
    const backupData = { staff, clients, orders, notifications };
    const backupFile = `backup-${Date.now()}.json`;
    fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));

    // Upload to Google Drive
    const driveResponse = await drive.files.create({
      requestBody: { name: backupFile, mimeType: 'application/json' },
      media: { mimeType: 'application/json', body: fs.createReadStream(backupFile) },
    });

    res.json({ message: 'Backup successful', driveFileId: driveResponse.data.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const u = await User.findOne({ _id: req.params.id, company_id: req.company_id });
    if (!u) return res.status(404).json({ error: 'User not found' });
    const { name, email, phone, role, password } = req.body;
    if (!name?.trim() || !email?.trim()) return res.status(400).json({ error: 'Name and email required' });
    if (!['admin', 'partner', 'quality', 'billing'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    const dup = await User.findOne({ company_id: req.company_id, email: email.trim().toLowerCase(), _id: { $ne: u._id } });
    if (dup) return res.status(400).json({ error: 'Email already exists in this company' });
    u.name = name.trim();
    u.email = email.trim().toLowerCase();
    u.phone = phone || '';
    u.role = role;
    if (password && password.length >= 6) {
      u.password = bcrypt.hashSync(password, 10);
    }
    await u.save();
    const safe = await User.findById(u._id).select('-password').lean();
    res.json({ ...safe, id: safe._id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id/toggle', async (req, res) => {
  try {
    const u = await User.findOne({ _id: req.params.id, company_id: req.company_id });
    if (!u) return res.status(404).json({ error: 'User not found' });
    if (String(u._id) === String(req.user._id)) return res.status(400).json({ error: 'Cannot deactivate yourself' });
    u.is_active = !u.is_active;
    await u.save();
    res.json({ message: `User ${u.is_active ? 'activated' : 'deactivated'}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const u = await User.findOne({ _id: req.params.id, company_id: req.company_id });
    if (!u) return res.status(404).json({ error: 'User not found' });
    if (String(u._id) === String(req.user._id)) return res.status(400).json({ error: 'Cannot delete yourself' });
    await User.findByIdAndDelete(u._id);
    res.json({ message: 'User deleted successfully' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;