// routes/auth.js — Multi-company: Register + Password + OTP + Google OAuth
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { Company, User, Otp } = require('../db/models');
const notify = require('../services/notify');
const { auth } = require('../middleware/auth');

const router = express.Router();
const gClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

function issueToken(user) {
  return jwt.sign(
    { id: user._id, role: user.role, company_id: user.company_id },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );
}

function safeUser(u, company) {
  return {
    id: u._id,
    name: u.name,
    email: u.email,
    role: u.role,
    phone: u.phone,
    avatar_url: u.avatar_url,
    auth_provider: u.auth_provider,
    company_id: u.company_id,
    company_name: company?.name || '',
    company_slug: company?.slug || '',
  };
}

// Helper: generate a URL-safe slug from company name
function makeSlug(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40);
}

// Helper: find company by slug header or body field
async function resolveCompany(req) {
  const slug = (req.headers['x-company-slug'] || req.body?.company_slug || '').trim().toLowerCase();
  if (!slug) return null;
  return Company.findOne({ slug, is_active: true });
}

// ══════════════════════════════════════════════════════════
// 1. REGISTER COMPANY  (creates company + first admin user)
// POST /api/auth/register-company
// ══════════════════════════════════════════════════════════
router.post('/register-company', async (req, res) => {
  try {
    const { company_name, admin_name, email, password, phone } = req.body;

    if (!company_name?.trim()) return res.status(400).json({ error: 'Company name is required' });
    if (!admin_name?.trim()) return res.status(400).json({ error: 'Your name is required' });
    if (!email?.trim()) return res.status(400).json({ error: 'Email address is required' });
    if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const emailClean = email.trim().toLowerCase();

    // Generate a unique slug
    let baseSlug = makeSlug(company_name.trim());
    if (!baseSlug) baseSlug = 'company';
    let slug = baseSlug;
    let attempt = 0;
    while (await Company.findOne({ slug })) {
      attempt++;
      slug = `${baseSlug}-${attempt}`;
    }

    // Create the company
    const company = await Company.create({ name: company_name.trim(), slug });

    // Create the admin user for this company
    const user = await User.create({
      company_id: company._id,
      name: admin_name.trim(),
      email: emailClean,
      password: bcrypt.hashSync(password, 10),
      role: 'admin',
      phone: phone?.trim() || '',
      auth_provider: 'local',
    });

    console.log(`[REGISTER] New company: "${company.name}" (${slug}) | Admin: ${emailClean}`);

    res.status(201).json({
      token: issueToken(user),
      user: safeUser(user, company),
      company: { id: company._id, name: company.name, slug: company.slug },
    });
  } catch (e) {
    if (e.code === 11000) return res.status(400).json({ error: 'Email already registered in this company' });
    console.error('[REGISTER] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════
// 2. PASSWORD LOGIN
// POST /api/auth/login  — requires x-company-slug header or company_slug in body
// ══════════════════════════════════════════════════════════
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const company = await resolveCompany(req);
    if (!company) return res.status(400).json({ error: 'Company workspace not found. Check your company slug.' });

    const user = await User.findOne({ company_id: company._id, email: email.trim().toLowerCase(), is_active: true });
    if (!user || !user.password || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    user.last_login = new Date();
    await user.save();

    res.json({ token: issueToken(user), user: safeUser(user, company), company: { id: company._id, name: company.name, slug: company.slug } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════
// 3. EMAIL OTP
// ══════════════════════════════════════════════════════════

// POST /api/auth/otp/send
router.post('/otp/send', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email?.trim()) return res.status(400).json({ error: 'Email required' });

    const company = await resolveCompany(req);
    if (!company) return res.status(400).json({ error: 'Company workspace not found.' });

    const emailClean = email.trim().toLowerCase();
    const user = await User.findOne({ company_id: company._id, email: emailClean, is_active: true });
    // Security: don't reveal if email exists
    if (!user) return res.json({ message: 'If that email is registered, you will receive a code shortly.' });

    const tenMinsAgo = new Date(Date.now() - 10 * 60000);
    const recentCount = await Otp.countDocuments({ company_id: company._id, email: emailClean, used: false, created_at: { $gt: tenMinsAgo } });
    if (recentCount >= 3) return res.status(429).json({ error: 'Too many OTP requests. Please wait 10 minutes.' });

    await Otp.updateMany({ company_id: company._id, email: emailClean, used: false }, { $set: { used: true } });

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const expireMin = parseInt(process.env.OTP_EXPIRE_MINUTES || '10');
    await Otp.create({
      company_id: company._id,
      email: emailClean,
      code: bcrypt.hashSync(otp, 8),
      expires_at: new Date(Date.now() + expireMin * 60000),
    });

    const html = `<p>Hi <strong>${user.name}</strong>,</p><p>Your WGS Order Processing login code is:</p>
      <div style="text-align:center;margin:24px 0">
        <span style="font-size:42px;font-weight:900;letter-spacing:12px;color:#5b2d8e;font-family:'Courier New',monospace;background:#f5f0ff;padding:16px 24px;border-radius:12px;border:2px dashed #c4b5fd;display:inline-block">${otp}</span>
      </div><p>Expires in <strong>${expireMin} minutes</strong>.</p>`;

    const sent = await notify.sendEmail(user.email, 'Your WGS Login Code', html);
    if (!sent && process.env.NODE_ENV !== 'production') console.log(`\n🔐 DEV OTP for ${emailClean}: ${otp}\n`);

    res.json({ message: `Login code sent to ${emailClean}.`, expiresInMinutes: expireMin });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/auth/otp/verify
router.post('/otp/verify', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email?.trim() || !otp?.trim()) return res.status(400).json({ error: 'Email and OTP required' });

    const company = await resolveCompany(req);
    if (!company) return res.status(400).json({ error: 'Company workspace not found.' });

    const emailClean = email.trim().toLowerCase();
    const record = await Otp.findOne({ company_id: company._id, email: emailClean, used: false }).sort({ created_at: -1 });

    if (!record) return res.status(401).json({ error: 'No active OTP found. Please request a new code.' });
    if (record.expires_at < new Date()) {
      record.used = true; await record.save();
      return res.status(401).json({ error: 'Code has expired. Please request a new one.' });
    }
    if (!bcrypt.compareSync(otp.trim(), record.code)) return res.status(401).json({ error: 'Incorrect code.' });

    record.used = true; await record.save();

    const user = await User.findOne({ company_id: company._id, email: emailClean, is_active: true });
    if (!user) return res.status(401).json({ error: 'Account not found or deactivated' });

    user.last_login = new Date(); await user.save();
    res.json({ token: issueToken(user), user: safeUser(user, company), company: { id: company._id, name: company.name, slug: company.slug } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════
// 4. GOOGLE OAUTH
// ══════════════════════════════════════════════════════════

// POST /api/auth/google/verify  (SPA flow — frontend sends Google ID token)
router.post('/google/verify', async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) return res.status(400).json({ error: 'Google ID token required' });
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'Google OAuth not configured' });

  const company = await resolveCompany(req);
  if (!company) return res.status(400).json({ error: 'Company workspace not found.' });

  try {
    const ticket = await gClient.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload.email_verified) return res.status(401).json({ error: 'Google email not verified' });

    const googleId = payload.sub;
    const email = payload.email.toLowerCase();
    const name = payload.name || email.split('@')[0];
    const avatar = payload.picture || null;

    let user = await User.findOne({ company_id: company._id, $or: [{ google_id: googleId }, { email }] });
    if (user) {
      user.google_id = googleId; user.avatar_url = avatar; user.auth_provider = 'google'; user.last_login = new Date();
      await user.save();
    } else {
      user = await User.create({ company_id: company._id, name, email, google_id: googleId, avatar_url: avatar, role: 'partner', auth_provider: 'google' });
    }
    if (!user.is_active) return res.status(403).json({ error: 'Account deactivated. Contact admin.' });

    res.json({ token: issueToken(user), user: safeUser(user, company), company: { id: company._id, name: company.name, slug: company.slug } });
  } catch (e) { res.status(401).json({ error: 'Invalid Google token: ' + e.message }); }
});

// GET /api/auth/google  → redirect to Google
router.get('/google', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'Google OAuth not configured' });
  const slug = req.query.slug || '';
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_CALLBACK_URL,
    response_type: 'code',
    scope: 'openid email profile',
    state: slug,          // pass slug through OAuth flow
    access_type: 'offline',
    prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// GET /api/auth/google/callback
router.get('/google/callback', async (req, res) => {
  const { code, error, state: slug } = req.query;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  if (error) return res.redirect(`${frontendUrl}?auth_error=${encodeURIComponent(error)}&slug=${slug}`);
  if (!code) return res.redirect(`${frontendUrl}?auth_error=no_code&slug=${slug}`);

  try {
    const axios = require('axios');
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
      code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_CALLBACK_URL, grant_type: 'authorization_code',
    });
    const ticket = await gClient.verifyIdToken({ idToken: tokenRes.data.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const googleId = payload.sub;
    const email = payload.email.toLowerCase();
    const name = payload.name || email.split('@')[0];
    const avatar = payload.picture || null;

    const company = await Company.findOne({ slug: slug?.trim().toLowerCase(), is_active: true });
    if (!company) return res.redirect(`${frontendUrl}?auth_error=company_not_found&slug=${slug}`);

    let user = await User.findOne({ company_id: company._id, $or: [{ google_id: googleId }, { email }] });
    if (user) {
      user.google_id = googleId; user.avatar_url = avatar; user.last_login = new Date();
      await user.save();
    } else {
      user = await User.create({ company_id: company._id, name, email, google_id: googleId, avatar_url: avatar, role: 'partner', auth_provider: 'google' });
    }
    if (!user.is_active) return res.redirect(`${frontendUrl}?auth_error=deactivated&slug=${slug}`);

    const token = issueToken(user);
    res.redirect(`${frontendUrl}?auth_token=${token}&auth_user=${encodeURIComponent(JSON.stringify(safeUser(user, company)))}&slug=${slug}`);
  } catch (e) {
    res.redirect(`${frontendUrl}?auth_error=${encodeURIComponent(e.message)}&slug=${slug}`);
  }
});

// ══════════════════════════════════════════════════════════
// OTHER AUTH ROUTES
// ══════════════════════════════════════════════════════════

router.get('/me', auth, async (req, res) => {
  try {
    const company = await Company.findById(req.user.company_id);
    res.json({ user: safeUser(req.user, company) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/change-password', auth, async (req, res) => {
  try {
    const { current, newPassword } = req.body;
    const user = await User.findById(req.user._id);
    if (user.auth_provider !== 'local' && !user.password) {
      if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
      user.password = bcrypt.hashSync(newPassword, 10); user.auth_provider = 'local';
      await user.save();
      return res.json({ message: 'Password set successfully.' });
    }
    if (!bcrypt.compareSync(current, user.password || '')) return res.status(400).json({ error: 'Current password is incorrect' });
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
    user.password = bcrypt.hashSync(newPassword, 10); await user.save();
    res.json({ message: 'Password changed successfully' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
