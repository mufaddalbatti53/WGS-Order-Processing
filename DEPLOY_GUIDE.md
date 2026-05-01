# ⚡ WGS Order Processing — Render Deployment Guide

---

## 📁 Project Structure

```
wgs-order-processing/
  backend/                ← Node.js API (deploy to Render)
    server.js
    .env.example          ← Copy to .env and fill values
    routes/
      auth.js             ← Login, JWT, OTP, Google OAuth
      orders.js           ← Orders + workflow actions
      clients.js          ← Client management
      users.js            ← Team management
      notifications.js    ← Notification log
    services/
      notify.js           ← Email (Gmail) + SMS (MSG91)
    middleware/
      auth.js             ← JWT auth middleware
    db/
      index.js            ← MongoDB connection (Mongoose)
      models.js           ← All data models

  frontend/               ← Single HTML file (deploy to Netlify/GitHub Pages)
    index.html            ← Complete app UI
    WGS.png               ← App logo
```

---

## 🍃 STEP 1 — MongoDB Atlas (Free Database)

1. Go to **https://cloud.mongodb.com** → Sign up free
2. Create a new project → **Create a Cluster** (choose M0 Free tier)
3. Wait ~2 minutes for cluster creation
4. Click **"Connect"** → **"Drivers"** → Select **Node.js**
5. Copy the connection string — looks like:
   ```
   mongodb+srv://youruser:yourpassword@cluster0.abc123.mongodb.net/
   ```
6. Change `<password>` to your actual password
7. Add `/wgs_orders` before the `?` to set the database name:
   ```
   mongodb+srv://youruser:yourpassword@cluster0.abc123.mongodb.net/wgs_orders?retryWrites=true&w=majority
   ```
8. Go to **Network Access** → Add IP **0.0.0.0/0** (allow from anywhere — needed for Render)

---

## 🌐 STEP 2 — Deploy Backend to Render

### Push backend to GitHub first:
```bash
cd wgs-order-processing/backend
git init
git add .
git commit -m "WGS Order Processing backend"
# Create repo on github.com, then:
git remote add origin https://github.com/YOUR_NAME/wgs-backend.git
git push -u origin main
```

### Deploy on Render:
1. Go to **https://render.com** → Sign up (GitHub login recommended)
2. Click **New** → **Web Service**
3. Connect your GitHub repo
4. Configure:
   - **Name:** `wgs-order-processing`
   - **Region:** Singapore (closest to India)
   - **Branch:** `main`
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Plan:** Free

5. Click **Advanced** → **Add Environment Variables**:

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | `any_long_random_string_min_32_chars_abc123xyz` |
| `MONGODB_URI` | `mongodb+srv://user:pass@cluster.mongodb.net/wgs_orders?retryWrites=true&w=majority` |
| `FRONTEND_URL` | `https://your-frontend-url.netlify.app` (add after Step 3) |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | `your_gmail@gmail.com` |
| `SMTP_PASS` | `your_16_char_app_password` |
| `SMTP_FROM_NAME` | `WGS Order Processing` |
| `SMTP_FROM_EMAIL` | `your_gmail@gmail.com` |
| `SMS_ENABLED` | `false` |
| `OTP_EXPIRE_MINUTES` | `10` |

6. Click **Create Web Service** → Wait 3-5 minutes for first deploy
7. Your backend URL will be: `https://wgs-order-processing.onrender.com`
8. Test it: Open `https://wgs-order-processing.onrender.com/health` — should show `{"status":"ok"}`

⚠️ **Note:** Free Render services sleep after 15min of inactivity. First request after sleep takes ~30 seconds. Upgrade to $7/month Starter plan to keep it always active.

---

## 🌍 STEP 3 — Deploy Frontend

### Update API URL in index.html:
Open `frontend/index.html`, find this line (around line 1915):
```javascript
const API_BASE = 'https://your-wgs-backend.onrender.com/api';
```
Change it to your actual Render URL:
```javascript
const API_BASE = 'https://wgs-order-processing.onrender.com/api';
```

### Option A: Netlify Drop (Easiest — 30 seconds)
1. Go to **https://app.netlify.com/drop**
2. Drag and drop your `frontend/` folder (or just `index.html` + `WGS.png`)
3. Netlify gives a URL like `https://amazing-unicorn-123.netlify.app`
4. Copy this URL → Add as `FRONTEND_URL` in Render environment variables

### Option B: GitHub Pages
1. Create a repo, upload `index.html` and `WGS.png`
2. Settings → Pages → Deploy from main branch
3. URL: `https://yourname.github.io/wgs-orders`

---

## 🔑 STEP 4 — Create Your First Admin User

Since demo data has been removed, you need to create your first admin via MongoDB Atlas:

1. Go to MongoDB Atlas → Browse Collections → `wgs_orders` database → `users` collection
2. Click **Insert Document** and paste:
```json
{
  "name": "Your Name",
  "email": "your@email.com",
  "password": "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lHHi",
  "role": "admin",
  "phone": "+91 XXXXX XXXXX",
  "is_active": true,
  "auth_provider": "local",
  "created_at": { "$date": "2025-01-01T00:00:00.000Z" }
}
```
The password hash above is for `password123` — **change it after first login!**

Or use the API directly (once backend is live):
```bash
# Using curl to create first admin (temporarily allow in server.js if needed)
curl -X POST https://your-backend.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"your_password"}'
```

**Better option — add this one-time setup route to server.js before deploying:**
Add to `server.js` before `app.use('/api/auth', ...)`:
```javascript
// ONE-TIME SETUP — remove after creating first admin!
app.post('/setup', async (req, res) => {
  const { User } = require('./db/models');
  const bcrypt = require('bcryptjs');
  const { connectDB } = require('./db/index');
  await connectDB();
  const count = await User.countDocuments();
  if (count > 0) return res.json({ message: 'Setup already done' });
  const admin = await User.create({
    name: req.body.name || 'Admin',
    email: req.body.email || 'admin@wgs.com',
    password: bcrypt.hashSync(req.body.password || 'changeme123', 10),
    role: 'admin',
    is_active: true,
    auth_provider: 'local',
  });
  res.json({ message: 'Admin created!', email: admin.email });
});
```
Then call it once:
```bash
curl -X POST https://your-backend.onrender.com/setup \
  -H "Content-Type: application/json" \
  -d '{"name":"Your Name","email":"your@email.com","password":"yourSecurePassword123"}'
```
**Then remove the /setup route and redeploy!**

---

## 📧 STEP 5 — Gmail Setup for Email Notifications

1. Go to **myaccount.google.com**
2. Security → **2-Step Verification** → Turn ON
3. Security → **App Passwords** → Select "Mail" → Generate
4. Copy the 16-character password (e.g. `abcd efgh ijkl mnop`)
5. In Render environment variables:
   - `SMTP_USER` = your Gmail address
   - `SMTP_PASS` = `abcdefghijklmnop` (no spaces, no quotes)

---

## 📱 STEP 6 — Convert to Android APK (Optional)

```bash
npm install -g @capacitor/cli
mkdir wgs-app && cd wgs-app
npm init -y
npm install @capacitor/core @capacitor/android
npx cap init "WGS Order Processing" com.wgs.orderprocessing --web-dir www
mkdir www
cp path/to/index.html www/index.html
cp path/to/WGS.png www/WGS.png
npx cap add android
npx cap sync android
npx cap open android
# In Android Studio: Build → Generate Signed Bundle/APK → APK
```

---

## 📡 API Reference

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| POST | `/api/auth/login` | All | Password login |
| POST | `/api/auth/otp/send` | All | Send OTP to email |
| POST | `/api/auth/otp/verify` | All | Verify OTP & login |
| GET | `/api/auth/me` | Auth | Get current user |
| GET | `/api/orders` | Auth | List orders (role-filtered) |
| POST | `/api/orders` | Admin | Create new order |
| GET | `/api/orders/:id` | Auth | Order detail + timeline |
| POST | `/api/orders/:id/action` | Role-based | Order workflow actions |
| GET | `/api/clients` | Auth | List clients |
| POST | `/api/clients` | Admin | Add client |
| PUT | `/api/clients/:id` | Admin | Edit client |
| GET | `/api/users` | Admin | List team members |
| POST | `/api/users` | Admin | Add team member |
| PATCH | `/api/users/:id/toggle` | Admin | Activate/deactivate user |
| GET | `/api/notifications` | Admin | Notification log |
| POST | `/api/notifications/test-email` | Admin | Test email config |

---

## 🆘 Troubleshooting

| Problem | Fix |
|---------|-----|
| Backend not starting | Check `MONGODB_URI` is correct in Render env vars |
| MongoDB connection fails | Add `0.0.0.0/0` to MongoDB Atlas Network Access |
| Email not sending | Verify Gmail App Password (16 chars, 2FA must be ON) |
| CORS error | Add your Netlify URL to `FRONTEND_URL` in Render env vars |
| App loads but shows "Cannot reach server" | Check that API_BASE in index.html matches your Render URL |
| First request slow (30s) | Upgrade Render to $7/month Starter plan |
| APK not installing | Enable "Install Unknown Apps" in Android phone settings |
