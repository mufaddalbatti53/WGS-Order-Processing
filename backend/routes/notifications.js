// routes/notifications.js — company-scoped (MongoDB) + WhatsApp logs
const express = require('express');
const { Notification } = require('../db/models');
const { auth, adminOnly } = require('../middleware/auth');
const router = express.Router();
router.use(auth, adminOnly);

router.get('/', async (req, res) => {
  try {
    const cid = req.company_id;
    const logs = await Notification.find({ company_id: cid })
      .populate('order_id', 'order_number')
      .sort({ created_at: -1 })
      .limit(200)
      .lean();

    const total   = await Notification.countDocuments({ company_id: cid });
    const sent    = await Notification.countDocuments({ company_id: cid, status: 'sent' });
    const failed  = await Notification.countDocuments({ company_id: cid, status: 'failed' });
    const emails  = await Notification.countDocuments({ company_id: cid, type: 'email' });
    const sms     = await Notification.countDocuments({ company_id: cid, type: 'sms' });
    const whatsapp = await Notification.countDocuments({ company_id: cid, type: 'whatsapp' });

    res.json({
      stats: { total, sent, failed, emails, sms, whatsapp },
      logs: logs.map(n => ({
        ...n,
        id: n._id,
        order_number: n.order_id?.order_number,
      })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Test email
router.post('/test-email', async (req, res) => {
  // Check env vars first
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
  const smtpPort = parseInt(process.env.SMTP_PORT || '587');
  const smtpSecure = process.env.SMTP_SECURE === 'true';

  if (!smtpUser) return res.status(400).json({ success: false, message: 'SMTP_USER is not set in environment variables.' });
  if (!smtpPass) return res.status(400).json({ success: false, message: 'SMTP_PASS is not set in environment variables.' });
  if (smtpPass.length < 10) return res.status(400).json({ success: false, message: `SMTP_PASS looks too short (${smtpPass.length} chars). Gmail App Passwords are 16 characters.` });

  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: { user: smtpUser, pass: smtpPass },
      tls: { rejectUnauthorized: false },
    });

    // Verify connection first
    await transporter.verify();

    // Send test email
    await transporter.sendMail({
      from: `"${process.env.SMTP_FROM_NAME || 'WGS Order Processing'}" <${smtpUser}>`,
      to: req.user.email,
      subject: 'WGS Order Processing — Email Test ✅',
      html: '<p>This is a test email. Email notifications are working! ✅</p><p>SMTP is configured correctly.</p>',
    });

    res.json({ success: true, message: `Test email sent to ${req.user.email}` });

  } catch (e) {
    // Return the real nodemailer error
    let hint = '';
    const msg = e.message || '';
    if (msg.includes('Invalid login') || msg.includes('Username and Password not accepted')) {
      hint = ' → Your App Password is wrong or expired. Generate a new one at myaccount.google.com/apppasswords';
    } else if (msg.includes('ECONNREFUSED') || msg.includes('connect')) {
      hint = ` → Cannot connect to ${smtpHost}:${smtpPort}. Check SMTP_HOST and SMTP_PORT.`;
    } else if (msg.includes('ETIMEDOUT') || msg.includes('timeout')) {
      hint = ' → Connection timed out. Try SMTP_PORT=465 with SMTP_SECURE=true instead.';
    } else if (msg.includes('self signed') || msg.includes('certificate')) {
      hint = ' → TLS certificate issue. Already handled — try again.';
    }
    res.json({ success: false, message: `${msg}${hint}` });
  }
});

// Test WhatsApp
router.post('/test-whatsapp', async (req, res) => {
  try {
    const { sendWA } = require('../services/whatsapp');
    const phone = req.body.phone || req.user.phone;
    if (!phone) return res.status(400).json({ error: 'Phone number required (pass phone in body or set it in your profile)' });

    const ok = await sendWA(
      phone,
      '✅ *WGS Order Processing*\n\nWhatsApp notifications are working! This is a test message.',
      req.company_id,
      null
    );
    res.json({
      success: ok,
      message: ok ? `Test WhatsApp sent to ${phone}` : 'Failed — check WA_PHONE_NUMBER_ID and WA_ACCESS_TOKEN in .env',
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// POST /api/notifications/bulk-delete
router.post('/bulk-delete', adminOnly, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'Invalid IDs array' });
    const { Notification } = require('../db/models'); // Ensure model is imported
    await Notification.deleteMany({ _id: { $in: ids }, company_id: req.company_id });
    res.json({ message: `${ids.length} notifications deleted` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
module.exports = router;
