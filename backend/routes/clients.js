// routes/clients.js — company-scoped (MongoDB) + duplicate check by phone & email
const express = require('express');
const { Client, Order } = require('../db/models');
const { auth, adminOnly } = require('../middleware/auth');
const router = express.Router();
router.use(auth);

// ── Duplicate checker ──────────────────────────────────────
async function checkDuplicate(companyId, email, phone, excludeId = null) {
  const orConditions = [];
  if (email && email.trim()) orConditions.push({ email: email.trim().toLowerCase() });
  if (phone && phone.trim()) orConditions.push({ phone: phone.trim() });
  if (!orConditions.length) return null;

  const q = { company_id: companyId, $or: orConditions };
  if (excludeId) q._id = { $ne: excludeId };

  const existing = await Client.findOne(q).lean();
  if (!existing) return null;

  // Return a helpful message saying what matched
  const matches = [];
  if (email && existing.email === email.trim().toLowerCase()) matches.push('email');
  if (phone && existing.phone === phone.trim()) matches.push('phone number');
  return `A client already exists with the same ${matches.join(' and ')}: "${existing.name}"`;
}

// GET /api/clients
router.get('/', async (req, res) => {
  try {
    const clients = await Client.find({ company_id: req.company_id }).sort({ name: 1 }).lean();
    const withCount = await Promise.all(clients.map(async c => {
      const count = await Order.countDocuments({ company_id: req.company_id, client_id: c._id });
      return { ...c, id: c._id, order_count: count };
    }));
    res.json(withCount);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/clients/:id
router.get('/:id', async (req, res) => {
  try {
    const c = await Client.findOne({ _id: req.params.id, company_id: req.company_id }).lean();
    if (!c) return res.status(404).json({ error: 'Client not found' });
    const orders = await Order.find({ company_id: req.company_id, client_id: c._id })
      .select('order_number status priority created_at').sort({ created_at: -1 }).lean();
    res.json({ ...c, id: c._id, orders: orders.map(o => ({ ...o, id: o._id })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/clients  — adminOnly + duplicate check
router.post('/', adminOnly, async (req, res) => {
  try {
    const { name, company, email, phone, address, credit_status, pending_amount, notes } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Client name required' });

    // Duplicate check
    const dupMsg = await checkDuplicate(req.company_id, email, phone);
    if (dupMsg) return res.status(409).json({ error: dupMsg });

    const c = await Client.create({
      company_id: req.company_id,
      name: name.trim(),
      company: company || '',
      email: email ? email.trim().toLowerCase() : '',
      phone: phone ? phone.trim() : '',
      address: address || '',
      credit_status: credit_status || 'good',
      pending_amount: parseFloat(pending_amount) || 0,
      notes: notes || '',
      created_by: req.user._id,
    });
    res.status(201).json({ ...c.toObject(), id: c._id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/clients/:id  — adminOnly + duplicate check (exclude self)
router.put('/:id', adminOnly, async (req, res) => {
  try {
    const c = await Client.findOne({ _id: req.params.id, company_id: req.company_id });
    if (!c) return res.status(404).json({ error: 'Client not found' });

    const { name, company, email, phone, address, credit_status, pending_amount, notes } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Client name required' });

    // Duplicate check (exclude this client's own id)
    const dupMsg = await checkDuplicate(req.company_id, email, phone, c._id);
    if (dupMsg) return res.status(409).json({ error: dupMsg });

    const updated = await Client.findByIdAndUpdate(c._id, {
      name: name.trim(),
      company: company || '',
      email: email ? email.trim().toLowerCase() : '',
      phone: phone ? phone.trim() : '',
      address: address || '',
      credit_status: credit_status || 'good',
      pending_amount: parseFloat(pending_amount) || 0,
      notes: notes || '',
    }, { new: true }).lean();

    res.json({ ...updated, id: updated._id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/clients/:id
router.delete('/:id', async (req, res) => {
  try {
    await Client.findOneAndDelete({ _id: req.params.id, company_id: req.user.company_id });
    res.json({ message: 'Client deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// POST /api/clients/bulk-delete
router.post('/bulk-delete', adminOnly, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'Invalid IDs array' });
    await Client.deleteMany({ _id: { $in: ids }, company_id: req.company_id });
    res.json({ message: `${ids.length} clients deleted` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
module.exports = router;
