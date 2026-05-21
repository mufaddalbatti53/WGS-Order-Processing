// services/notify.js — Email via Brevo HTTP API (no IP restrictions) or SMTP fallback
const { Notification } = require('../db/models');
const axios = require('axios');

// ── Send via Brevo HTTP API (recommended — no IP whitelist needed) ──────────
async function sendViaBrevoAPI(to, subject, htmlBody) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return false;

  try {
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: {
        name: process.env.SMTP_FROM_NAME || 'WGS Order Processing',
        email: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER
      },
      to: [{ email: to }],
      subject,
      htmlContent: htmlBody
    }, {
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json'
      }
    });
    return true;
  } catch (e) {
    console.error('[Brevo API] Error:', e.response?.data || e.message);
    return false;
  }
}

// ── Send via SMTP fallback (if BREVO_API_KEY not set) ──────────────────────
async function sendViaSMTP(to, subject, htmlBody) {
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    tls: { rejectUnauthorized: false },
  });
  await transporter.sendMail({
    from: `"${process.env.SMTP_FROM_NAME || 'WGS'}" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
    to, subject, html: htmlBody
  });
  return true;
}

function emailHTML(title, bodyHTML) {
  const appName = process.env.SMTP_FROM_NAME || 'WGS Order Processing';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#eef4fb;font-family:'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#eef4fb;padding:32px 0">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(15,45,82,.10)">
      <tr><td style="background:linear-gradient(135deg,#5b2d8e,#1c3d6e);padding:22px 32px">
        <h1 style="margin:0;color:#fff;font-size:20px;font-weight:800">⚡ ${appName}</h1>
      </td></tr>
      <tr><td style="padding:30px 32px">
        <h2 style="color:#0f2d52;margin-top:0">${title}</h2>
        ${bodyHTML}
        <hr style="border:none;border-top:1px solid #dbeeff;margin:24px 0">
        <p style="color:#7aafd1;font-size:12px;margin:0">Automated message from ${appName}. Do not reply.</p>
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`;
}

async function logNotif({ companyId, orderId, type, recipient, subject, message, status, errorMsg }) {
  try {
    const n = await Notification.create({
      company_id: companyId, order_id: orderId || null,
      type, recipient: recipient || '', subject: subject || '',
      message: message || '', status: status || 'pending', error_msg: errorMsg || null,
    });
    return n._id;
  } catch (e) { return null; }
}

async function sendEmail(to, subject, bodyHTML, companyId = null, orderId = null) {
  if (!to) return false;
  // Must have either Brevo API key or SMTP credentials
  if (!process.env.BREVO_API_KEY && !process.env.SMTP_USER) return false;

  const logId = await logNotif({ companyId, orderId, type: 'email', recipient: to, subject, message: bodyHTML, status: 'pending' });
  try {
    const html = emailHTML(subject, bodyHTML);
    let ok = false;

    // Try Brevo API first (no IP restrictions)
    if (process.env.BREVO_API_KEY) {
      ok = await sendViaBrevoAPI(to, subject, html);
    }
    // Fallback to SMTP if API not configured or failed
    if (!ok && process.env.SMTP_USER) {
      ok = await sendViaSMTP(to, subject, html);
    }

    if (ok) {
      if (logId) await Notification.findByIdAndUpdate(logId, { status: 'sent', sent_at: new Date() });
      return true;
    } else {
      throw new Error('All email providers failed');
    }
  } catch (err) {
    console.error('[Email] Failed:', err.message);
    if (logId) await Notification.findByIdAndUpdate(logId, { status: 'failed', error_msg: err.message });
    return false;
  }
}

// Unified Client Notification Template
async function notifyClientEmail(order, stage, extraInfo = '') {
  if (!order.client_email) return null;

  let subject = '';
  let body = `<p>Dear <strong>${order.client_name}</strong>,</p>`;

  const details = `
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
      <tr><td style="padding:8px;background:#f4f9ff;border:1px solid #dbeeff;font-weight:700;width:120px">Order #</td><td style="padding:8px;border:1px solid #dbeeff">${order.order_number}</td></tr>
      <tr><td style="padding:8px;background:#f4f9ff;border:1px solid #dbeeff;font-weight:700">Product/Desc</td><td style="padding:8px;border:1px solid #dbeeff">${order.description || 'N/A'}</td></tr>
      <tr><td style="padding:8px;background:#f4f9ff;border:1px solid #dbeeff;font-weight:700">Amount</td><td style="padding:8px;border:1px solid #dbeeff">₹${order.amount || 0}</td></tr>
    </table>`;

  switch (stage) {
    case 'received':
      subject = `Order Received — #${order.order_number}`;
      body += `<p>We have successfully received your order. We will begin processing it shortly.</p>${details}`;
      break;
    case 'production':
      subject = `Order In Production — #${order.order_number}`;
      body += `<p>Great news! Your order is now in production.</p>${details}`;
      break;
    case 'qc':
      subject = `Order in Quality Check — #${order.order_number}`;
      body += `<p>Your order has finished production and is currently undergoing our standard quality checks to ensure everything is perfect.</p>${details}`;
      break;
    case 'dispatched':
      subject = `Order Dispatched! 🎉 — #${order.order_number}`;
      body += `<p style="color:#059669;font-size:16px;font-weight:700">Your order is on its way!</p>${details}`;
      body += `<div style="background:#ecfdf5;padding:12px;border-left:4px solid #059669;margin-top:16px">
                 <strong>Dispatch & Tracking Info:</strong><br>${extraInfo || order.dispatch_info || 'Our team will contact you with courier details.'}
               </div>`;
      break;
    default: return null;
  }

  const success = await sendEmail(order.client_email, subject, body, order.company_id, order._id);
  return success ? `Email sent to ${order.client_email}: ${subject}` : null;
}

module.exports = { notifyClientEmail, logNotif, sendEmail };