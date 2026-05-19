// services/whatsapp.js — Meta Cloud API (free)
const axios = require('axios');
const { logNotif } = require('./notify');

async function sendWA(phone, message, companyId = null, orderId = null) {
  if (!phone || process.env.WA_ENABLED !== 'true') return false;

  // Clean phone number — ensure it has country code
  let clean = phone.replace(/\D/g, '');
  if (clean.length === 10) clean = '91' + clean; // add India code if missing

  const phoneNumberId = process.env.WA_PHONE_NUMBER_ID;
  const accessToken   = process.env.WA_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    console.warn('[WA] WA_PHONE_NUMBER_ID or WA_ACCESS_TOKEN not set in env vars');
    return false;
  }

  const logId = await logNotif({
    companyId, orderId,
    type: 'whatsapp',
    recipient: clean,
    subject: 'WhatsApp Update',
    message,
    status: 'pending'
  });

  try {
    // ── Meta Cloud API ──────────────────────────────────────────────
    await axios.post(
      `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: clean,
        type: 'text',
        text: { body: message }
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    // ───────────────────────────────────────────────────────────────

    console.log(`[WA] ✅ Sent to +${clean}`);

    if (logId) {
      const { Notification } = require('../db/models');
      await Notification.findByIdAndUpdate(logId, { status: 'sent', sent_at: new Date() });
    }
    return true;

  } catch (err) {
    const errMsg = err.response?.data?.error?.message || err.message;
    console.error(`[WA] ❌ Failed to send to +${clean}:`, errMsg);

    if (logId) {
      const { Notification } = require('../db/models');
      await Notification.findByIdAndUpdate(logId, { status: 'failed', error_msg: errMsg });
    }
    return false;
  }
}

// ── Admin alert — notifies all admin phone numbers on every WA send ──────────
async function alertAdmins(orderNum, clientPhone, stage, success) {
  const adminPhones = (process.env.WA_ADMIN_PHONES || '').split(',').map(p => p.trim()).filter(Boolean);
  if (!adminPhones.length) return;

  const icon = success ? '✅' : '❌';
  const msg = `${icon} *WGS Order Alert*\nOrder: #${orderNum}\nClient: +${clientPhone}\nStage: ${stage.toUpperCase()}\nWA Status: ${success ? 'Sent' : 'Failed'}`;

  for (const adminPhone of adminPhones) {
    await sendWA(adminPhone, msg); // no companyId/orderId for admin alerts
  }
}

// ── Client notifications at each order stage ────────────────────────────────
async function notifyClientWA(order, stage, extraInfo = '') {
  if (!order.client_phone) return null;

  const details = `\n\n📋 *Order:* #${order.order_number}\n📦 *Item:* ${order.description}\n💰 *Amount:* ₹${order.amount || 0}`;
  let msg = '';

  switch (stage) {
    case 'received':
      msg = `Hello *${order.client_name}*! 👋\n\nWe have received your order and will begin processing it shortly.${details}`;
      break;
    case 'production':
      msg = `Hello *${order.client_name}*! ⚙️\n\nGreat news — your order is now *in production*.${details}`;
      break;
    case 'qc':
      msg = `Hello *${order.client_name}*! 🔍\n\nYour order has completed production and is undergoing *quality checks*.${details}`;
      break;
    case 'dispatched':
      msg = `Hello *${order.client_name}*! 🎉\n\nYour order is *on its way!*${details}\n\n🚚 *Courier/Tracking Info:*\n${extraInfo || order.dispatch_info || 'Our team will contact you with details.'}`;
      break;
    default:
      return null;
  }

  const cleanPhone = order.client_phone.replace(/\D/g, '');
  if (cleanPhone.length < 10) return null;

  const success = await sendWA(order.client_phone, msg, order.company_id, order._id);

  // Optionally alert admins too
  if (process.env.WA_ADMIN_PHONES) {
    alertAdmins(order.order_number, cleanPhone, stage, success).catch(() => {});
  }

  return success
    ? `WhatsApp sent to +${cleanPhone}: ${stage.toUpperCase()} stage`
    : `WhatsApp FAILED for +${cleanPhone} — check WA_PHONE_NUMBER_ID and WA_ACCESS_TOKEN`;
}

module.exports = { notifyClientWA, sendWA };
