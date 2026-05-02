// services/notify.js — Email + SMS with company-scoped notification logging
const nodemailer = require('nodemailer');
const axios = require('axios');
const { Notification, User } = require('../db/models');

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    tls: { rejectUnauthorized: false },
  });
  return transporter;
}

function emailHTML(title, bodyHTML) {
  const appName = process.env.SMTP_FROM_NAME || 'WGS Order Processing';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#eef4fb;font-family:'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#eef4fb;padding:32px 0">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0"
      style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(15,45,82,.10)">
      <tr><td style="background:linear-gradient(135deg,#5b2d8e,#1c3d6e);padding:22px 32px">
        <h1 style="margin:0;color:#fff;font-size:20px;font-weight:800">⚡ ${appName}</h1>
      </td></tr>
      <tr><td style="padding:30px 32px">
        <h2 style="color:#0f2d52;margin-top:0">${title}</h2>
        ${bodyHTML}
        <hr style="border:none;border-top:1px solid #dbeeff;margin:24px 0">
        <p style="color:#7aafd1;font-size:12px;margin:0">Automated message from ${appName}. Do not reply.</p>
      </td></tr>
      <tr><td style="background:#f4f9ff;padding:14px 32px;border-top:1px solid #dbeeff">
        <p style="margin:0;font-size:11px;color:#7aafd1;text-align:center">${appName} &copy; ${new Date().getFullYear()}</p>
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`;
}

async function logNotif({ companyId, orderId, type, recipient, subject, message, status, errorMsg }) {
  try {
    const n = await Notification.create({
      company_id: companyId,
      order_id: orderId || null,
      type, recipient: recipient || '', subject: subject || '',
      message: message || '', status: status || 'pending',
      error_msg: errorMsg || null,
    });
    return n._id;
  } catch (e) { console.error('[NOTIFY] Log error:', e.message); return null; }
}

async function sendEmail(to, subject, bodyHTML, companyId = null, orderId = null) {
  if (!to || !process.env.SMTP_USER) {
    await logNotif({ companyId, orderId, type: 'email', recipient: to, subject, message: bodyHTML, status: 'failed', errorMsg: 'SMTP not configured' });
    return false;
  }
  const logId = await logNotif({ companyId, orderId, type: 'email', recipient: to, subject, message: bodyHTML, status: 'pending' });
  try {
    const info = await getTransporter().sendMail({
      from: `"${process.env.SMTP_FROM_NAME || 'WGS Order Processing'}" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
      to, subject, html: emailHTML(subject, bodyHTML),
    });
    console.log(`[EMAIL] ✅ Sent to ${to} | ${info.messageId}`);
    if (logId) await Notification.findByIdAndUpdate(logId, { status: 'sent', sent_at: new Date() });
    return true;
  } catch (err) {
    console.error(`[EMAIL] ❌ Failed to ${to}:`, err.message);
    if (logId) await Notification.findByIdAndUpdate(logId, { status: 'failed', error_msg: err.message });
    return false;
  }
}

async function sendSMS(phone, message, companyId = null, orderId = null) {
  if (process.env.SMS_ENABLED !== 'true') {
    await logNotif({ companyId, orderId, type: 'sms', recipient: phone, subject: 'SMS', message, status: 'failed', errorMsg: 'SMS_ENABLED=false' });
    return false;
  }
  if (!process.env.MSG91_AUTH_KEY) {
    await logNotif({ companyId, orderId, type: 'sms', recipient: phone, subject: 'SMS', message, status: 'failed', errorMsg: 'MSG91 not configured' });
    return false;
  }
  let clean = phone.replace(/\D/g, '');
  if (clean.length === 10) clean = '91' + clean;
  const logId = await logNotif({ companyId, orderId, type: 'sms', recipient: phone, subject: 'SMS', message, status: 'pending' });
  try {
    const res = await axios.post('https://api.msg91.com/api/v5/flow/', {
      template_id: process.env.MSG91_TEMPLATE_ID, sender: process.env.MSG91_SENDER_ID || 'WGSORD',
      short_url: '0', mobiles: clean, var1: message,
    }, { headers: { authkey: process.env.MSG91_AUTH_KEY, 'Content-Type': 'application/json' }, timeout: 10000 });
    const ok = res.data?.type === 'success';
    if (ok && logId) await Notification.findByIdAndUpdate(logId, { status: 'sent', sent_at: new Date() });
    else if (!ok) throw new Error(JSON.stringify(res.data));
    return ok;
  } catch (err) {
    const msg = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    if (logId) await Notification.findByIdAndUpdate(logId, { status: 'failed', error_msg: msg });
    return false;
  }
}

// ── Notification Templates ────────────────────────────────

async function notifyOrderReceived(order, companyId) {
  const admins = await User.find({ company_id: companyId, role: 'admin', is_active: true }).select('email');
  const html = `<p>A new order is awaiting your credit check.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:9px 14px;background:#f4f9ff;border:1px solid #dbeeff;font-weight:700;color:#0f2d52;width:130px">Order #</td>
          <td style="padding:9px 14px;border:1px solid #dbeeff">${order.order_number}</td></tr>
      <tr><td style="padding:9px 14px;background:#f4f9ff;border:1px solid #dbeeff;font-weight:700;color:#0f2d52">Client</td>
          <td style="padding:9px 14px;border:1px solid #dbeeff">${order.client_name}</td></tr>
      <tr><td style="padding:9px 14px;background:#f4f9ff;border:1px solid #dbeeff;font-weight:700;color:#0f2d52">Description</td>
          <td style="padding:9px 14px;border:1px solid #dbeeff">${order.description || 'N/A'}</td></tr>
    </table>`;
  for (const a of admins) await sendEmail(a.email, `New Order — #${order.order_number}`, html, companyId, order._id);
}

async function notifyCreditRejected(order) {
  const html = `<p>Dear <strong>${order.client_name}</strong>,</p>
    <p style="color:#dc2626;background:#fef2f2;padding:12px;border-radius:8px;border-left:4px solid #dc2626">
      Order <strong>#${order.order_number}</strong> is on hold due to <strong>outstanding pending payments</strong>.</p>
    <p>Please clear your dues and contact us to reprocess.</p>`;
  if (order.client_email) await sendEmail(order.client_email, `Order #${order.order_number} — On Hold`, html, order.company_id, order._id);
  if (order.client_phone) await sendSMS(order.client_phone, `Your order #${order.order_number} is on hold due to pending payments.`, order.company_id, order._id);
}

async function notifyPartnerAssigned(order, partner) {
  const html = `<p>Dear <strong>${partner.name}</strong>,</p>
    <p>Order <strong>#${order.order_number}</strong> has been assigned to you for production.</p>
    <p>Client: <strong>${order.client_name}</strong></p>
    <p>Description: ${order.description || 'N/A'}</p>`;
  await sendEmail(partner.email, `Order Assigned — #${order.order_number}`, html, order.company_id, order._id);
}

async function notifyQCFailed(order, partner, reason) {
  const html = `<p>Dear <strong>${partner.name}</strong>,</p>
    <p>Order <strong>#${order.order_number}</strong> <strong style="color:#dc2626">failed quality control</strong>.</p>
    <div style="background:#fef2f2;padding:12px;border-radius:8px;border-left:4px solid #dc2626;margin:16px 0">
      <strong>Reason:</strong> ${reason}</div>`;
  await sendEmail(partner.email, `QC Failed — Order #${order.order_number}`, html, order.company_id, order._id);
}

async function notifyGoodsReceived(order, companyId) {
  const team = await User.find({ company_id: companyId, role: { $in: ['admin', 'quality'] }, is_active: true }).select('email');
  const html = `<p>Order <strong>#${order.order_number}</strong> production is complete. Please proceed with <strong>quality check</strong>.</p>`;
  for (const t of team) await sendEmail(t.email, `Goods Ready for QC — #${order.order_number}`, html, companyId, order._id);
}

async function notifyQCPassed(order, companyId) {
  const billers = await User.find({ company_id: companyId, role: 'billing', is_active: true }).select('email');
  const html = `<p>Order <strong>#${order.order_number}</strong> <strong style="color:#059669">passed quality control</strong>.</p>
    <p>Client: <strong>${order.client_name}</strong>. Please proceed with billing and dispatch.</p>`;
  for (const b of billers) await sendEmail(b.email, `QC Passed — Ready for Billing #${order.order_number}`, html, companyId, order._id);
}

async function notifyDispatched(order) {
  const html = `<p>Dear <strong>${order.client_name}</strong>,</p>
    <p style="color:#059669;font-size:16px;font-weight:700">🎉 Your order has been dispatched!</p>
    <p>Order: <strong>#${order.order_number}</strong></p>
    <p>Dispatch info: ${order.dispatch_info || 'Our team will contact you shortly.'}</p>
    <p>Thank you for your business! 🙏</p>`;
  if (order.client_email) await sendEmail(order.client_email, `Order #${order.order_number} Dispatched!`, html, order.company_id, order._id);
  if (order.client_phone) await sendSMS(order.client_phone, `Your order #${order.order_number} has been dispatched! ${order.dispatch_info || ''}`, order.company_id, order._id);
}

module.exports = { sendEmail, sendSMS, logNotif, notifyOrderReceived, notifyCreditRejected, notifyPartnerAssigned, notifyQCFailed, notifyGoodsReceived, notifyQCPassed, notifyDispatched };
