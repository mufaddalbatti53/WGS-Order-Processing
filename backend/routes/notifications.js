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
  try {
    const { sendEmail } = require('../services/notify');
    const ok = await sendEmail(
      req.user.email,
      'WGS Order Processing — Email Test',
      '<p>This is a test email. Email notifications are working! ✅</p>',
      req.company_id
    );
    res.json({
      success: ok,
      message: ok ? `Test email sent to ${req.user.email}` : 'Failed — check SMTP config in .env',
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
      null,
      'TEST'
    );
    res.json({
      success: ok,
      message: ok ? `Test WhatsApp sent to ${phone}` : 'Failed — check WA_PHONE_NUMBER_ID and WA_ACCESS_TOKEN in .env',
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
