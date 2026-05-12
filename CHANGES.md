# WGS Order Processing — Changes Summary

## Files Changed / Added

| File | Status | What changed |
|------|--------|-------------|
| `routes/orders.js` | ✅ Updated | WhatsApp notification at every order stage |
| `routes/clients.js` | ✅ Updated | Duplicate check by email AND phone on create & update |
| `routes/notifications.js` | ✅ Updated | WhatsApp stats + `/test-whatsapp` endpoint |
| `routes/backup.js` | 🆕 New | Backup download, Google Drive upload, restore |
| `services/whatsapp.js` | 🆕 New | WhatsApp via Meta Cloud API + admin alert on every send |
| `server.js` | ✅ Updated | Register `/api/backup` route; body limit 50 mb for restore |
| `.env.example` | ✅ Updated | All new env vars documented with setup instructions |
| `package.json` | ✅ Updated | Added `googleapis` dependency |

---

## 1. Google OTP Not Sending — Root Cause & Fix

**Problem:** Your `.env` had:
```
SMTP_PORT=587
SMTP_SECURE=TRUE   ← WRONG
```
Port 587 uses **STARTTLS** (starts plain, upgrades). `SMTP_SECURE=true` tells Nodemailer to open an **SSL** connection immediately (port 465 behaviour). The handshake fails silently.

**Fix:** Change your `.env`:
```
SMTP_PORT=587
SMTP_SECURE=false   ← correct for port 587
```
Or if you prefer SSL:
```
SMTP_PORT=465
SMTP_SECURE=true
```
Both work — just don't mix them.

---

## 2. WhatsApp Notifications

Uses **Meta Cloud API** (free, no per-message cost for outbound in sandbox; production needs approval).

### Setup (5 minutes)
1. Go to [developers.facebook.com](https://developers.facebook.com) → Create App → Business type
2. Add **WhatsApp** product → "Getting Started"
3. Copy your **Phone Number ID** → `WA_PHONE_NUMBER_ID`
4. Generate a **System User token** (permanent) → `WA_ACCESS_TOKEN`
5. The sender number is the one Meta assigns (or your registered business number)

### What gets sent (to client's phone)
| Stage | Message |
|-------|---------|
| Order received | Order logged, under credit review |
| Credit approved | Credit OK, assigning partner |
| Credit rejected | On hold due to pending dues |
| Partner assigned | Production partner assigned |
| Production started | Work has begun |
| Goods received | Production done, entering QC |
| QC passed | Passed QC, going to billing |
| QC failed | Failed QC, reason included |
| Dispatched | Order on its way! |

### Admin Alert
Every WhatsApp (sent or failed) triggers an alert WA to **all admin numbers** showing:
- ✅/❌ status
- Which order
- Which number was contacted
- The exact message text

---

## 3. Backup & Restore

### API Endpoints (admin only)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/backup/download` | Download JSON to device |
| POST | `/api/backup/drive` | Upload to Google Drive |
| GET | `/api/backup/status` | Drive config + record counts |
| POST | `/api/backup/restore` | Restore from JSON (skips duplicates) |

### What's backed up
- Company info
- All staff (passwords excluded)
- All clients
- All orders + timelines
- All notification logs

### Google Drive Setup
1. [console.cloud.google.com](https://console.cloud.google.com) → IAM → Service Accounts → Create
2. Download JSON key → save as `service-account.json`
3. In Google Drive, create a folder → Share it with the service account's email
4. Copy folder ID from URL → `GOOGLE_DRIVE_BACKUP_FOLDER_ID`
5. Set `GOOGLE_SERVICE_ACCOUNT_KEY_FILE=./service-account.json` in `.env`

For Render/cloud deployments, paste the JSON contents into `GOOGLE_SERVICE_ACCOUNT_KEY_JSON`.

---

## 4. Client Duplicate Check

`POST /api/clients` and `PUT /api/clients/:id` now check for existing clients with the same **email** or **phone number** within the same company.

Response on duplicate (HTTP 409):
```json
{ "error": "A client already exists with the same email and phone number: \"John Doe\"" }
```
The error message tells you exactly which field(s) matched and which existing client.

---

## New .env Variables to Add

```env
# Fix OTP email
SMTP_SECURE=false

# WhatsApp
WA_PHONE_NUMBER_ID=your_meta_phone_number_id
WA_ACCESS_TOKEN=your_meta_permanent_access_token

# Google Drive Backup
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=./service-account.json
GOOGLE_DRIVE_BACKUP_FOLDER_ID=your_drive_folder_id
```
