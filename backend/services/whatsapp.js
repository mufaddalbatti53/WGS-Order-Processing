// services/whatsapp.js — Client-facing only
const axios = require('axios');
const { logNotif } = require('./notify');

async function sendWA(phone, message, companyId = null, orderId = null) {
  if (!phone || process.env.WA_ENABLED !== 'true') return false;

  let clean = phone.replace(/\D/g, '');
  if (clean.length === 10) clean = '91' + clean;

  const logId = await logNotif({ companyId, orderId, type: 'whatsapp', recipient: clean, subject: 'WhatsApp Update', message, status: 'pending' });

  try {
    // Replace this with your actual WhatsApp API integration (e.g., Meta Cloud API, Wati, Twilio)
    // const res = await axios.post('YOUR_WA_API_URL', { phone: clean, text: message }, { headers: { ... } });

    // Simulating success for now:
    console.log(`[WA] Sent to ${clean}: ${message}`);

    if (logId) {
      const { Notification } = require('../db/models');
      await Notification.findByIdAndUpdate(logId, { status: 'sent', sent_at: new Date() });
    }
    return true;
  } catch (err) {
    if (logId) {
      const { Notification } = require('../db/models');
      await Notification.findByIdAndUpdate(logId, { status: 'failed', error_msg: err.message });
    }
    return false;
  }
}

async function notifyClientWA(order, stage, extraInfo = '') {
  if (!order.client_phone) return null;

  const details = `\nOrder: #${order.order_number}\nProduct: ${order.description}\nAmount: ₹${order.amount || 0}`;
  let msg = '';

  switch (stage) {
    case 'received':
      msg = `Hello ${order.client_name}, we have received your order! We will begin processing it shortly.${details}`;
      break;
    case 'production':
      msg = `Hello ${order.client_name}, great news! Your order is now in production.${details}`;
      break;
    case 'qc':
      msg = `Hello ${order.client_name}, your order has finished production and is undergoing quality checks.${details}`;
      break;
    case 'dispatched':
      msg = `🎉 Hello ${order.client_name}, your order is on its way!${details}\n\n*Courier/Tracking Info:*\n${extraInfo || order.dispatch_info}`;
      break;
    default: return null;
  }

  const success = await sendWA(order.client_phone, msg, order.company_id, order._id);
  const cleanPhone = order.client_phone.replace(/\D/g, '');
  return success ? `WhatsApp sent to ${cleanPhone}: ${stage.toUpperCase()} stage` : null;
}

module.exports = { notifyClientWA };