// services/notify.js — Email via Brevo HTTP API (no IP restrictions) or SMTP fallback
const { Notification } = require('../db/models');
const axios = require('axios');

// ── App name ─────────────────────────────────────────────────────────────────
const APP_NAME = process.env.SMTP_FROM_NAME || 'WGS Order Processing';

// ── Fetch Team A (admin role) users for this company from DB ─────────────────
async function getCompanyAdmins(companyId) {
  try {
    const { User } = require('../db/models');
    const admins = await User.find({
      company_id: companyId,
      role: 'admin',
      is_active: true,
      email: { $exists: true, $ne: '' }
    }).select('name email phone').lean();
    return admins; // array of { name, email, phone }
  } catch (e) {
    console.error('[notify] Failed to fetch admins:', e.message);
    return [];
  }
}

// ── Send via Brevo HTTP API with optional attachment ─────────────────────────
async function sendViaBrevoAPI(to, subject, htmlBody, attachment = null) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return false;
  const payload = {
    sender: { name: APP_NAME, email: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER },
    to: Array.isArray(to) ? to.map(e => ({ email: e })) : [{ email: to }],
    subject, htmlContent: htmlBody
  };
  if (attachment && attachment.content && attachment.name) {
    payload.attachment = [{ name: attachment.name, content: attachment.content }];
  }
  try {
    await axios.post('https://api.brevo.com/v3/smtp/email', payload, {
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json' }
    });
    return true;
  } catch (e) {
    console.error('[Brevo API] Error:', e.response?.data || e.message);
    return false;
  }
}

// ── Send via SMTP fallback ───────────────────────────────────────────────────
async function sendViaSMTP(to, subject, htmlBody, attachment = null) {
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    tls: { rejectUnauthorized: false },
  });
  const mailOpts = {
    from: `"${APP_NAME}" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
    to: Array.isArray(to) ? to.join(',') : to,
    subject, html: htmlBody,
  };
  if (attachment && attachment.content && attachment.name) {
    mailOpts.attachments = [{ filename: attachment.name, content: Buffer.from(attachment.content, 'base64') }];
  }
  await transporter.sendMail(mailOpts);
  return true;
}

// ── Email HTML wrapper ────────────────────────────────────────────────────────
function emailHTML(title, bodyHTML, admins = []) {
  const adminContactHTML = admins.length ? `
    <div style="margin-top:20px;padding:14px 16px;background:#f4f9ff;border-radius:8px;border:1px solid #dbeeff">
      <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#4a7fa8;text-transform:uppercase;letter-spacing:0.5px">Contact Us</p>
      ${admins.map(a => `<p style="margin:0;font-size:13px;color:#2e5a84">
        <strong>${a.name}</strong>
        ${a.email ? `&nbsp;·&nbsp;<a href="mailto:${a.email}" style="color:#0284c7">${a.email}</a>` : ''}
        ${a.phone ? `&nbsp;·&nbsp;📞 ${a.phone}` : ''}
      </p>`).join('')}
    </div>` : '';

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef4fb;font-family:'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#eef4fb;padding:32px 0">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(15,45,82,.10);max-width:600px">
      <tr><td style="background:linear-gradient(135deg,#5b2d8e,#1c3d6e);padding:22px 32px">
        <h1 style="margin:0;color:#fff;font-size:20px;font-weight:800">⚡ ${APP_NAME}</h1>
        <p style="margin:4px 0 0;color:rgba(255,255,255,0.7);font-size:12px">Professional Order Management</p>
      </td></tr>
      <tr><td style="padding:30px 32px">
        <h2 style="color:#0f2d52;margin-top:0;font-size:20px">${title}</h2>
        ${bodyHTML}
        <hr style="border:none;border-top:1px solid #dbeeff;margin:24px 0">
        ${adminContactHTML}
        <p style="color:#7aafd1;font-size:11px;margin:16px 0 0">Automated message from ${APP_NAME}. Please do not reply to this email directly.</p>
      </td></tr>
      <tr><td style="background:#f4f9ff;padding:14px 32px;border-top:1px solid #dbeeff">
        <p style="margin:0;font-size:11px;color:#7aafd1;text-align:center">© ${new Date().getFullYear()} ${APP_NAME} · Developed by Web Graphics Studio</p>
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`;
}

// ── Order details table ───────────────────────────────────────────────────────
function orderDetailsTable(order) {
  const productName = order.product_name || order.productName || '';
  return `
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
      <tr><td style="padding:10px 14px;background:#f4f9ff;border:1px solid #dbeeff;font-weight:700;color:#2e5a84;width:130px">Order #</td><td style="padding:10px 14px;border:1px solid #dbeeff;color:#0f2d52;font-weight:600">${order.order_number}</td></tr>
      ${productName ? `<tr><td style="padding:10px 14px;background:#f4f9ff;border:1px solid #dbeeff;font-weight:700;color:#2e5a84">Product</td><td style="padding:10px 14px;border:1px solid #dbeeff;color:#0f2d52">${productName}</td></tr>` : ''}
      <tr><td style="padding:10px 14px;background:#f4f9ff;border:1px solid #dbeeff;font-weight:700;color:#2e5a84">Description</td><td style="padding:10px 14px;border:1px solid #dbeeff;color:#0f2d52">${order.description || 'N/A'}</td></tr>
      <tr><td style="padding:10px 14px;background:#f4f9ff;border:1px solid #dbeeff;font-weight:700;color:#2e5a84">Amount</td><td style="padding:10px 14px;border:1px solid #dbeeff;color:#059669;font-weight:700;font-size:15px">₹${Number(order.amount || 0).toLocaleString('en-IN')}</td></tr>
    </table>`;
}

// ── Full summary table (dispatch email) ──────────────────────────────────────
function fullSummaryTable(order, dispatchInfo) {
  const productName = order.product_name || order.productName || '';
  return `
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
      <tr style="background:linear-gradient(135deg,#5b2d8e,#1c3d6e)">
        <td colspan="2" style="padding:10px 14px;color:#fff;font-weight:700;font-size:13px;letter-spacing:0.5px">📋 ORDER SUMMARY</td>
      </tr>
      <tr><td style="padding:10px 14px;background:#f4f9ff;border:1px solid #dbeeff;font-weight:700;color:#2e5a84;width:140px">Order #</td><td style="padding:10px 14px;border:1px solid #dbeeff;color:#0f2d52;font-weight:700">${order.order_number}</td></tr>
      <tr><td style="padding:10px 14px;background:#f4f9ff;border:1px solid #dbeeff;font-weight:700;color:#2e5a84">Client Name</td><td style="padding:10px 14px;border:1px solid #dbeeff;color:#0f2d52">${order.client_name}</td></tr>
      <tr><td style="padding:10px 14px;background:#f4f9ff;border:1px solid #dbeeff;font-weight:700;color:#2e5a84">Phone</td><td style="padding:10px 14px;border:1px solid #dbeeff;color:#0f2d52">${order.client_phone || '—'}</td></tr>
      <tr><td style="padding:10px 14px;background:#f4f9ff;border:1px solid #dbeeff;font-weight:700;color:#2e5a84">Email</td><td style="padding:10px 14px;border:1px solid #dbeeff;color:#0f2d52">${order.client_email || '—'}</td></tr>
      ${productName ? `<tr><td style="padding:10px 14px;background:#f4f9ff;border:1px solid #dbeeff;font-weight:700;color:#2e5a84">Product</td><td style="padding:10px 14px;border:1px solid #dbeeff;color:#0f2d52">${productName}</td></tr>` : ''}
      <tr><td style="padding:10px 14px;background:#f4f9ff;border:1px solid #dbeeff;font-weight:700;color:#2e5a84">Description</td><td style="padding:10px 14px;border:1px solid #dbeeff;color:#0f2d52">${order.description || 'N/A'}</td></tr>
      <tr><td style="padding:10px 14px;background:#f4f9ff;border:1px solid #dbeeff;font-weight:700;color:#2e5a84">Amount</td><td style="padding:10px 14px;border:1px solid #dbeeff;color:#059669;font-weight:700;font-size:16px">₹${Number(order.amount || 0).toLocaleString('en-IN')}</td></tr>
      <tr><td style="padding:10px 14px;background:#f4f9ff;border:1px solid #dbeeff;font-weight:700;color:#2e5a84">Dispatch Info</td><td style="padding:10px 14px;border:1px solid #dbeeff;color:#0f2d52">${dispatchInfo || order.dispatch_info || '—'}</td></tr>
      <tr><td style="padding:10px 14px;background:#f4f9ff;border:1px solid #dbeeff;font-weight:700;color:#2e5a84">Date</td><td style="padding:10px 14px;border:1px solid #dbeeff;color:#0f2d52">${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</td></tr>
    </table>`;
}

// ── Log notification ─────────────────────────────────────────────────────────
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

// ── Core sendEmail ────────────────────────────────────────────────────────────
async function sendEmail(to, subject, bodyHTML, companyId = null, orderId = null, attachment = null, admins = []) {
  if (!to) return false;
  if (!process.env.BREVO_API_KEY && !process.env.SMTP_USER) return false;
  const recipients = Array.isArray(to) ? to : [to];
  const logId = await logNotif({ companyId, orderId, type: 'email', recipient: recipients.join(','), subject, message: bodyHTML, status: 'pending' });
  try {
    const html = emailHTML(subject, bodyHTML, admins);
    let ok = false;
    if (process.env.BREVO_API_KEY) ok = await sendViaBrevoAPI(recipients, subject, html, attachment);
    if (!ok && process.env.SMTP_USER) ok = await sendViaSMTP(recipients, subject, html, attachment);
    if (ok) {
      if (logId) await Notification.findByIdAndUpdate(logId, { status: 'sent', sent_at: new Date() });
      return true;
    }
    throw new Error('All email providers failed');
  } catch (err) {
    console.error('[Email] Failed:', err.message);
    if (logId) await Notification.findByIdAndUpdate(logId, { status: 'failed', error_msg: err.message });
    return false;
  }
}

// Admin emails fetched dynamically via getCompanyAdmins(companyId)

// ── Main notification function ────────────────────────────────────────────────
async function notifyClientEmail(order, stage, extraInfo = '', attachment = null) {
  const results = [];
  const details = orderDetailsTable(order);
  // Fetch Team A managers for this company dynamically
  const admins = await getCompanyAdmins(order.company_id);
  const adminEmails = admins.map(a => a.email).filter(Boolean);

  let clientSubject = '', clientBody = '', adminSubject = '', adminBody = '';

  switch (stage) {
    case 'received': {
      clientSubject = `✅ Order Received — #${order.order_number}`;
      clientBody = `<p>Dear <strong>${order.client_name}</strong>,</p>
        <p>Thank you for your order! We have successfully received it and will begin processing shortly.</p>
        ${details}
        <div style="background:#eff8ff;padding:12px 16px;border-left:4px solid #0284c7;border-radius:4px;margin-top:8px">
          <p style="margin:0;font-size:13.5px;color:#0284c7">We will keep you updated at every step. Feel free to contact us if you have any questions.</p>
        </div>`;
      adminSubject = `🆕 New Order — #${order.order_number} — ${order.client_name}`;
      adminBody = `<p>A new order has been placed and is awaiting credit review.</p>${fullSummaryTable(order, '')}`;
      break;
    }
    case 'production': {
      clientSubject = `⚙️ Order In Production — #${order.order_number}`;
      clientBody = `<p>Dear <strong>${order.client_name}</strong>,</p>
        <p>Great news! Your order has passed credit review and is now <strong>in production</strong>.</p>${details}`;
      adminSubject = `⚙️ Order In Production — #${order.order_number}`;
      adminBody = `<p>Order #${order.order_number} for <strong>${order.client_name}</strong> has started production.</p>${details}`;
      break;
    }
    case 'qc': {
      clientSubject = `🔍 Quality Check In Progress — #${order.order_number}`;
      clientBody = `<p>Dear <strong>${order.client_name}</strong>,</p>
        <p>Your order has completed production and is currently undergoing our <strong>quality check</strong>.</p>${details}`;
      adminSubject = `🔍 Order In QC — #${order.order_number}`;
      adminBody = `<p>Order #${order.order_number} for <strong>${order.client_name}</strong> is now in quality check.</p>${details}`;
      break;
    }
    case 'dispatched': {
      const di = extraInfo || order.dispatch_info || 'Our team will contact you with courier details.';
      const summary = fullSummaryTable(order, di);
      const attachNote = attachment ? `<p style="margin-top:16px;font-size:13.5px;color:#2e5a84">📎 Your <strong>bill/invoice</strong> is attached to this email.</p>` : '';

      clientSubject = `🎉 Order Dispatched! — #${order.order_number}`;
      clientBody = `<p>Dear <strong>${order.client_name}</strong>,</p>
        <div style="background:#ecfdf5;padding:14px 16px;border-left:4px solid #059669;border-radius:4px;margin-bottom:16px">
          <p style="margin:0;font-size:16px;font-weight:700;color:#059669">🚚 Your order is on its way!</p>
        </div>
        ${summary}
        <div style="background:#f4f9ff;padding:12px 16px;border-left:4px solid #0284c7;border-radius:4px;margin-top:4px">
          <p style="margin:0 0 4px;font-weight:700;color:#2e5a84">📦 Dispatch & Tracking Info:</p>
          <p style="margin:0;color:#0f2d52">${di}</p>
        </div>
        ${attachNote}`;

      adminSubject = `✅ Dispatched — #${order.order_number} — ${order.client_name}`;
      adminBody = `<p>Order #${order.order_number} has been <strong>billed and dispatched</strong>.</p>
        ${summary}
        ${attachment ? `<p style="font-size:13.5px;color:#2e5a84">📎 Bill file is attached.</p>` : ''}`;
      break;
    }
    default: return null;
  }

  // Send to client
  if (order.client_email) {
    const ok = await sendEmail(order.client_email, clientSubject, clientBody, order.company_id, order._id, attachment, admins);
    if (ok) results.push(`Client email → ${order.client_email}`);
  }

  // Send admin copy
  if (adminEmails.length) {
    await sendEmail(adminEmails, adminSubject, adminBody, order.company_id, order._id, attachment, []);
    results.push(`Admin copy → ${adminEmails.join(', ')}`);
  }

  return results.length ? results.join(' | ') : null;
}

module.exports = { notifyClientEmail, logNotif, sendEmail };
