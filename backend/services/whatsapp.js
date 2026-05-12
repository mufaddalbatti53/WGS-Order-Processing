// services/whatsapp.js — WhatsApp notifications via Meta Cloud API (or Twilio fallback)
// Manager's WhatsApp number (from their registration) is the sender.
// Every message is logged to Notification and an alert is sent to the admin.
'use strict';

const axios = require('axios');
const { Notification, User } = require('../db/models');

// ── Helpers ───────────────────────────────────────────────

function normalisePhone(raw = '') {
  let d = raw.replace(/\D/g, '');
  if (d.length === 10) d = '91' + d;          // India default
  return d;
}

async function logWA({ companyId, orderId, recipient, message, status, errorMsg }) {
  try {
    return await Notification.create({
      company_id: companyId,
      order_id: orderId || null,
      type: 'whatsapp',
      recipient,
      subject: 'WhatsApp',
      message,
      status,
      error_msg: errorMsg || null,
      sent_at: status === 'sent' ? new Date() : undefined,
    });
  } catch (e) {
    console.error('[WA] Log error:', e.message);
    return null;
  }
}

// ── Alert admin about every WhatsApp sent ─────────────────
async function alertAdmin({ companyId, toNumber, message, orderNumber, status }) {
  try {
    const admins = await User.find({ company_id: companyId, role: 'admin', is_active: true }).select('email phone');
    const alertText =
      `📲 *WhatsApp ${status === 'sent' ? 'Sent ✅' : 'FAILED ❌'}*\n` +
      `Order: *#${orderNumber || 'N/A'}*\n` +
      `To: *${toNumber}*\n` +
      `Message: _${message.slice(0, 200)}${message.length > 200 ? '…' : ''}_`;

    // Send alert WA to each admin's phone
    for (const admin of admins) {
      if (admin.phone) {
        // fire-and-forget — no recursive alert
        sendRaw(normalisePhone(admin.phone), alertText, companyId, null).catch(() => {});
      }
    }
  } catch (e) {
    console.error('[WA] Alert admin error:', e.message);
  }
}

// ── Core sender (Meta Cloud API) ──────────────────────────
async function sendRaw(toE164, text, companyId, orderId) {
  const waNumberId = process.env.WA_PHONE_NUMBER_ID;
  const waToken    = process.env.WA_ACCESS_TOKEN;

  if (!waNumberId || !waToken) {
    await logWA({ companyId, orderId, recipient: toE164, message: text, status: 'failed', errorMsg: 'WA_PHONE_NUMBER_ID or WA_ACCESS_TOKEN not set' });
    return false;
  }

  const logDoc = await logWA({ companyId, orderId, recipient: toE164, message: text, status: 'pending' });

  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/${waNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: toE164,
        type: 'text',
        text: { body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${waToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 12000,
      }
    );
    if (logDoc) await logDoc.updateOne({ status: 'sent', sent_at: new Date() });
    console.log(`[WA] ✅ Sent to ${toE164}`);
    return true;
  } catch (err) {
    const msg = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    if (logDoc) await logDoc.updateOne({ status: 'failed', error_msg: msg });
    console.error(`[WA] ❌ Failed to ${toE164}:`, msg);
    return false;
  }
}

// ── Public send (with admin alert) ────────────────────────
async function sendWA(toPhone, text, companyId, orderId, orderNumber) {
  if (!toPhone) return false;
  const toE164 = normalisePhone(toPhone);
  const ok = await sendRaw(toE164, text, companyId, orderId);
  // Always alert admin (success or failure)
  await alertAdmin({ companyId, toNumber: toE164, message: text, orderNumber, status: ok ? 'sent' : 'failed' });
  return ok;
}

// ══════════════════════════════════════════════════════════
// Notification Templates — one per order stage
// ══════════════════════════════════════════════════════════

async function waOrderReceived(order) {
  const msg =
    `✅ *Order Received!*\n\n` +
    `Hi *${order.client_name}*,\n` +
    `Your order *#${order.order_number}* has been received and is under credit review.\n` +
    `We'll keep you updated at every step. Thank you! 🙏`;
  return sendWA(order.client_phone, msg, order.company_id, order._id, order.order_number);
}

async function waCreditRejected(order) {
  const msg =
    `⚠️ *Order On Hold — Pending Dues*\n\n` +
    `Hi *${order.client_name}*,\n` +
    `Your order *#${order.order_number}* is currently on hold due to outstanding payments.\n` +
    `Please clear your dues and contact us to proceed. 📞`;
  return sendWA(order.client_phone, msg, order.company_id, order._id, order.order_number);
}

async function waCreditApproved(order) {
  const msg =
    `✅ *Credit Approved!*\n\n` +
    `Hi *${order.client_name}*,\n` +
    `Great news! Credit check for order *#${order.order_number}* has been approved.\n` +
    `We are now assigning a production partner. ⚙️`;
  return sendWA(order.client_phone, msg, order.company_id, order._id, order.order_number);
}

async function waPartnerAssigned(order, partner) {
  const msg =
    `👷 *Production Partner Assigned*\n\n` +
    `Hi *${order.client_name}*,\n` +
    `Order *#${order.order_number}* has been assigned to our production team.\n` +
    `Production will begin shortly! ⚙️`;
  return sendWA(order.client_phone, msg, order.company_id, order._id, order.order_number);
}

async function waProductionStarted(order) {
  const msg =
    `⚙️ *Production Started*\n\n` +
    `Hi *${order.client_name}*,\n` +
    `Work on your order *#${order.order_number}* has officially begun!\n` +
    `We'll notify you when it's ready for quality check. 🔍`;
  return sendWA(order.client_phone, msg, order.company_id, order._id, order.order_number);
}

async function waGoodsReceived(order) {
  const msg =
    `📦 *Production Complete!*\n\n` +
    `Hi *${order.client_name}*,\n` +
    `Production for order *#${order.order_number}* is done.\n` +
    `Your order is now entering our Quality Control process. 🔍`;
  return sendWA(order.client_phone, msg, order.company_id, order._id, order.order_number);
}

async function waQCPassed(order) {
  const msg =
    `✅ *Quality Check Passed!*\n\n` +
    `Hi *${order.client_name}*,\n` +
    `Your order *#${order.order_number}* passed our quality inspection with flying colours! 🎉\n` +
    `It's now being processed for billing and dispatch. 🚚`;
  return sendWA(order.client_phone, msg, order.company_id, order._id, order.order_number);
}

async function waQCFailed(order, reason) {
  const msg =
    `❌ *Quality Check — Needs Rework*\n\n` +
    `Hi *${order.client_name}*,\n` +
    `Order *#${order.order_number}* requires rework before dispatch.\n` +
    `Reason: _${reason}_\n` +
    `Our team is on it — we'll update you soon. 🛠️`;
  return sendWA(order.client_phone, msg, order.company_id, order._id, order.order_number);
}

async function waDispatched(order) {
  const msg =
    `🚚 *Your Order is On Its Way!*\n\n` +
    `Hi *${order.client_name}*,\n` +
    `Order *#${order.order_number}* has been dispatched! 🎉\n` +
    `${order.dispatch_info ? `Dispatch Info: _${order.dispatch_info}_\n` : ''}` +
    `Thank you for choosing us! 🙏`;
  return sendWA(order.client_phone, msg, order.company_id, order._id, order.order_number);
}

module.exports = {
  sendWA,
  waOrderReceived,
  waCreditRejected,
  waCreditApproved,
  waPartnerAssigned,
  waProductionStarted,
  waGoodsReceived,
  waQCPassed,
  waQCFailed,
  waDispatched,
};
