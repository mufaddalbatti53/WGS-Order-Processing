// middleware/auth.js — company-scoped JWT auth
const jwt  = require('jsonwebtoken');
const { User, Company } = require('../db/models');

async function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const token   = header.slice(7);
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user    = await User.findById(payload.id).select('-password');
    if (!user || !user.is_active) return res.status(401).json({ error: 'User not found or inactive' });
    // Attach company_id to every request for easy scoping
    req.user       = user;
    req.company_id = user.company_id;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

module.exports = { auth, adminOnly };
