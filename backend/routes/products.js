const express = require('express');
const { Product } = require('../db/models');
const { auth, adminOnly } = require('../middleware/auth');
const router = express.Router();
router.use(auth);

// GET all products
router.get('/', async (req, res) => {
    try {
        const products = await Product.find({ company_id: req.company_id }).sort({ name: 1 }).lean();
        res.json(products.map(p => ({ ...p, id: p._id })));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST new product
router.post('/', adminOnly, async (req, res) => {
    try {
        const p = await Product.create({
            company_id: req.company_id,
            name: req.body.name,
            description: req.body.description || '',
            price: Number(req.body.price) || 0,
            created_by: req.user._id,
        });
        res.status(201).json({ ...p.toObject(), id: p._id });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT edit product
router.put('/:id', adminOnly, async (req, res) => {
    try {
        const p = await Product.findOneAndUpdate(
            { _id: req.params.id, company_id: req.company_id },
            { name: req.body.name, description: req.body.description, price: Number(req.body.price) },
            { new: true }
        ).lean();
        res.json({ ...p, id: p._id });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE product
router.delete('/:id', adminOnly, async (req, res) => {
    try {
        await Product.findOneAndDelete({ _id: req.params.id, company_id: req.company_id });
        res.json({ message: 'Product deleted' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;