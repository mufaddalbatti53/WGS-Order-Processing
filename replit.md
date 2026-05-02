# WGS Order Processing

## Overview
A multi-tenant SaaS order management system for tracking client orders through a workflow with role-based access control.

## Tech Stack
- **Frontend**: Vanilla HTML/JS/CSS (single `index.html`)
- **Backend**: Node.js + Express
- **Database**: MongoDB Atlas (Mongoose)
- **Auth**: JWT + OTP (email) + Google OAuth

## Project Structure
```
/
├── backend/          # Node.js API server
│   ├── server.js     # Main entry point (serves both API + frontend)
│   ├── db/           # MongoDB connection & Mongoose models
│   ├── routes/       # API route handlers (auth, orders, clients, users, notifications)
│   ├── services/     # notify.js (email/SMS)
│   ├── middleware/   # auth.js (JWT verification)
│   └── package.json
├── frontend/
│   ├── index.html    # Complete SPA (CSS + JS embedded)
│   └── WGS.png       # Logo
└── DEPLOY_GUIDE.md   # Deployment instructions
```

## Running
- **Single server** on port 5000 serves both frontend and API
- Frontend uses relative `/api` URLs — no CORS issues
- Workflow: `cd backend && node server.js`

## Environment Variables
- `PORT` — 5000 (default)
- `MONGODB_URI` — MongoDB Atlas connection string (required, user must set)
- `JWT_SECRET` — Secret for JWT signing
- `NODE_ENV` — development / production
- `OTP_EXPIRE_MINUTES` — OTP expiry (default: 10)
- `SMS_ENABLED` — Enable MSG91 SMS (default: false)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` — Email config (Gmail)

## Roles
- **admin** — Full access
- **partner** — Order submission/tracking
- **quality** — QC workflow actions
- **billing** — Billing actions

## Setup Notes
- The app requires a MongoDB Atlas URI to function fully
- First admin must be created via MongoDB Atlas or the `/api/auth/register-company` endpoint
- Email notifications require Gmail App Password setup
