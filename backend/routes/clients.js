// routes/clients.js — company-scoped (MongoDB)
const express = require('express');
const { Client, Order } = require('../db/models');
const { auth, adminOnly } = require('../middleware/auth');
const router = express.Router();
router.use(auth);

router.get('/', async (req, res) => {
  try {
    const clients = await Client.find({ company_id: req.company_id }).sort({ name: 1 }).lean();
    const withCount = await Promise.all(clients.map(async c => {
      const count = await Order.countDocuments({ company_id: req.company_id, client_id: c._id });
      return { ...c, id: c._id, order_count: count };
    }));
    res.json(withCount);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const c = await Client.findOne({ _id: req.params.id, company_id: req.company_id }).lean();
    if (!c) return res.status(404).json({ error: 'Client not found' });
    const orders = await Order.find({ company_id: req.company_id, client_id: c._id })
      .select('order_number status priority created_at').sort({ created_at: -1 }).lean();
    res.json({ ...c, id: c._id, orders: orders.map(o => ({ ...o, id: o._id })) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/', adminOnly, async (req, res) => {
  try {
    const { name, company, email, phone, address, credit_status, pending_amount, notes } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Client name required' });
    const c = await Client.create({
      company_id:     req.company_id,
      name:           name.trim(),
      company:        company || '',
      email:          email || '',
      phone:          phone || '',
      address:        address || '',
      credit_status:  credit_status || 'good',
      pending_amount: parseFloat(pending_amount) || 0,
      notes:          notes || '',
      created_by:     req.user._id,
    });
    res.status(201).json({ ...c.toObject(), id: c._id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', adminOnly, async (req, res) => {
  try {
    const c = await Client.findOne({ _id: req.params.id, company_id: req.company_id });
    if (!c) return res.status(404).json({ error: 'Client not found' });
    const { name, company, email, phone, address, credit_status, pending_amount, notes } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Client name required' });
    const updated = await Client.findByIdAndUpdate(c._id, {
      name:           name.trim(),
      company:        company || '',
      email:          email || '',
      phone:          phone || '',
      address:        address || '',
      credit_status:  credit_status || 'good',
      pending_amount: parseFloat(pending_amount) || 0,
      notes:          notes || '',
    }, { new: true }).lean();
    res.json({ ...updated, id: updated._id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;