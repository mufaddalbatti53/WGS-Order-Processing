// routes/orders.js — company-scoped (MongoDB) + WhatsApp at every stage
const express = require('express');
const { Order, User, Client } = require('../db/models');
const { notifyClientEmail } = require('../services/notify');
const { notifyClientWA } = require('../services/whatsapp');
const { auth, adminOnly } = require('../middleware/auth');
const router = express.Router();
router.use(auth);

function genOrderNum() {
  const d = new Date();
  const date = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `ORD-${date}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function addTimeline(order, status, action, userId, actorName, notes, isFail) {
  order.timeline.push({
    status, action,
    performed_by: userId,
    actor_name: actorName,
    notes: notes || null,
    is_fail: isFail || false,
  });
}

const BASE_POPULATE = [
  { path: 'partner_id', select: 'name email phone' },
  { path: 'created_by', select: 'name' },
];

// GET /api/orders
router.get('/', async (req, res) => {
  try {
    const u = req.user;
    const cid = req.company_id;
    let query = { company_id: cid };
    if (u.role === 'partner') query.partner_id = u._id;
    else if (u.role === 'billing') query.status = { $in: ['billing', 'dispatched', 'completed'] };
    else if (u.role === 'quality') query.status = { $in: ['goods_received', 'quality_check', 'quality_failed', 'billing', 'dispatched', 'completed'] };

    const orders = await Order.find(query).populate(BASE_POPULATE).sort({ updated_at: -1 }).lean();
    res.json(orders.map(o => ({
      ...o, id: o._id,
      partner_name: o.partner_id?.name || null,
      partner_email: o.partner_id?.email || null,
      partner_phone: o.partner_id?.phone || null,
      created_by_name: o.created_by?.name || null,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/orders/:id
router.get('/:id', async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, company_id: req.company_id }).populate(BASE_POPULATE).lean();
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json({ ...order, id: order._id, partner_name: order.partner_id?.name, partner_email: order.partner_id?.email });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/orders
// POST /api/orders
router.post('/', adminOnly, async (req, res) => {
  try {
    const { clientId, clientName, clientEmail, clientPhone, source, description, priority, amount } = req.body;
    if (!clientName?.trim()) return res.status(400).json({ error: 'Client name required' });
    if (!description?.trim()) return res.status(400).json({ error: 'Description required' });

    let actualClientId = clientId;

    // AUTO-SAVE NEW WALK-IN CLIENT
    if (!actualClientId) {
      // Check if client already exists by phone/email to avoid duplicates
      const orConditions = [];
      if (clientEmail && clientEmail.trim()) orConditions.push({ email: clientEmail.trim().toLowerCase() });
      if (clientPhone && clientPhone.trim()) orConditions.push({ phone: clientPhone.trim() });

      let existingClient = null;
      if (orConditions.length > 0) {
        existingClient = await Client.findOne({ company_id: req.company_id, $or: orConditions });
      }

      if (existingClient) {
        actualClientId = existingClient._id;
      } else {
        const newClient = await Client.create({
          company_id: req.company_id,
          name: clientName.trim(),
          email: clientEmail ? clientEmail.trim().toLowerCase() : '',
          phone: clientPhone ? clientPhone.trim() : '',
          created_by: req.user._id,
        });
        actualClientId = newClient._id;
      }
    }

    let initialStatus = 'received', creditNote = null;
    if (actualClientId) {
      const cl = await Client.findOne({ _id: actualClientId, company_id: req.company_id });
      if (cl && cl.credit_status !== 'good') {
        initialStatus = 'credit_rejected';
        creditNote = 'Client has pending dues — credit hold in effect.';
      }
    }

    const order = await Order.create({
      company_id: req.company_id,
      order_number: genOrderNum(),
      client_id: clientId || null,
      client_name: clientName.trim(),
      client_email: clientEmail || '',
      client_phone: clientPhone || '',
      source: source || 'direct',
      description: description.trim(),
      status: initialStatus,
      priority: priority || 'normal',
      amount: parseFloat(amount) || 0,
      rej_reason: creditNote,
      created_by: req.user._id,
      timeline: [{
        status: initialStatus,
        action: initialStatus === 'credit_rejected'
          ? '❌ Order placed ON HOLD — pending dues.'
          : 'Order received and logged.',
        performed_by: req.user._id,
        actor_name: req.user.name,
        notes: creditNote,
        is_fail: initialStatus === 'credit_rejected',
      }],
    });

    // Email + WhatsApp notifications
    // ONLY send client notifications
    let notifMsg = '';
    if (initialStatus === 'received') {
      const eRes = await notifyClientEmail(order, 'received');
      const wRes = await notifyClientWA(order, 'received');
      if (eRes) notifMsg += eRes + '. ';
      if (wRes) notifMsg += wRes + '.';
    }

    res.status(201).json({ ...order.toObject(), id: order._id, notifMsg: notifMsg.trim() });

  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/orders/:id/action
router.post('/:id/action', async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, company_id: req.company_id });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const { actionKey, notes, partnerId, qcFailReason, rejReason, billingAmount, dispatchInfo } = req.body;
    const u = req.user, uName = u.name;

    let notifMsg = ''; // To collect notification logs

    switch (actionKey) {
      case 'approve_credit':
        if (u.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
        order.status = 'credit_check';
        addTimeline(order, 'credit_check', '✅ Credit approved. Ready to assign partner.', u._id, uName, notes);
        break;

      case 'reject_credit': {
        if (u.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
        const r = rejReason || notes || 'Pending payment issues.';
        order.status = 'credit_rejected'; order.rej_reason = r;
        addTimeline(order, 'credit_rejected', '❌ Credit rejected.', u._id, uName, r, true);
        break;
      }

      case 'assign_partner': {
        if (u.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
        if (!partnerId) return res.status(400).json({ error: 'Partner ID required' });
        const p = await User.findOne({ _id: partnerId, company_id: req.company_id, role: 'partner' });
        if (!p) return res.status(400).json({ error: 'Partner not found' });
        order.status = 'assigned'; order.partner_id = p._id;
        addTimeline(order, 'assigned', `👷 Assigned to ${p.name}.`, u._id, uName, notes ? `Instructions: ${notes}` : null);
        break;
      }

      case 'start_production':
        if (!['admin', 'partner'].includes(u.role)) return res.status(403).json({ error: 'Not allowed' });
        if (u.role === 'partner' && String(order.partner_id) !== String(u._id)) return res.status(403).json({ error: 'Not your order' });
        order.status = 'in_production';
        addTimeline(order, 'in_production', '⚙️ Production started.', u._id, uName, notes);

        // Notify Client
        const p_eRes = await notifyClientEmail(order, 'production');
        const p_wRes = await notifyClientWA(order, 'production');
        if (p_eRes) notifMsg += p_eRes + '. ';
        if (p_wRes) notifMsg += p_wRes + '.';
        break;

      case 'goods_received':
      case 'production_done':
        if (!['admin', 'partner'].includes(u.role)) return res.status(403).json({ error: 'Not allowed' });
        if (u.role === 'partner' && String(order.partner_id) !== String(u._id)) return res.status(403).json({ error: 'Not your order' });
        order.status = 'goods_received';
        addTimeline(order, 'goods_received', '📦 Production complete. Goods returned to Team A.', u._id, uName, notes);
        break;

      case 'start_qc':
        if (!['admin', 'quality'].includes(u.role)) return res.status(403).json({ error: 'Not allowed' });
        order.status = 'quality_check';
        addTimeline(order, 'quality_check', '🔍 Quality check in progress.', u._id, uName, notes);

        // Notify Client
        const q_eRes = await notifyClientEmail(order, 'qc');
        const q_wRes = await notifyClientWA(order, 'qc');
        if (q_eRes) notifMsg += q_eRes + '. ';
        if (q_wRes) notifMsg += q_wRes + '.';
        break;

      case 'qc_pass':
        if (!['admin', 'quality'].includes(u.role)) return res.status(403).json({ error: 'Not allowed' });
        order.status = 'billing'; order.quality_notes = notes || 'Passed quality inspection.';
        addTimeline(order, 'billing', '✅ QC passed. Sent to billing.', u._id, uName, notes);
        break;

      case 'qc_fail': {
        if (!['admin', 'quality'].includes(u.role)) return res.status(403).json({ error: 'Not allowed' });
        const reason = qcFailReason || notes || 'Quality not met.';
        order.status = 'quality_failed'; order.quality_notes = reason;
        addTimeline(order, 'quality_failed', '❌ QC FAILED. Returned to partner.', u._id, uName, reason, true);
        break;
      }

      case 'dispatch':
      case 'mark_dispatched': {
        if (!['admin', 'billing'].includes(u.role)) return res.status(403).json({ error: 'Not allowed' });
        const fa = billingAmount ? parseFloat(billingAmount) : order.amount;
        const di = dispatchInfo || notes || 'Order dispatched.';
        order.status = 'dispatched'; order.amount = fa; order.dispatch_info = di; order.billing_notes = notes || '';
        addTimeline(order, 'dispatched', '🚚 Order billed and dispatched.', u._id, uName, di);

        // Build attachment object from bill file if uploaded
        const attachment = (req.body.billFileBase64 && req.body.billFileName)
          ? { content: req.body.billFileBase64.split(',').pop(), name: req.body.billFileName }
          : null;

        // Notify client + admin with full summary and bill attachment
        const d_eRes = await notifyClientEmail(order, 'dispatched', di, attachment);
        const d_wRes = await notifyClientWA(order, 'dispatched', di);
        if (d_eRes) notifMsg += d_eRes + '. ';
        if (d_wRes) notifMsg += d_wRes + '.';

        order.status = 'completed';
        addTimeline(order, 'completed', '✅ Order completed. Client notified.', u._id, uName);
        break;
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${actionKey}` });
    }

    await order.save();
    const final = await Order.findById(order._id).populate(BASE_POPULATE).lean();
    res.json({ ...final, id: final._id, partner_name: final.partner_id?.name, notifMsg: notifMsg.trim() });
  } catch (e) {
    console.error('Action error:', e);
    res.status(500).json({ error: 'Action failed: ' + e.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await Order.findOneAndDelete({ _id: req.params.id, company_id: req.user.company_id });
    res.json({ message: 'Order deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// POST /api/orders/bulk-delete
router.post('/bulk-delete', adminOnly, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'Invalid IDs array' });
    await Order.deleteMany({ _id: { $in: ids }, company_id: req.company_id });
    res.json({ message: `${ids.length} orders deleted` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
module.exports = router;
