// db/models.js — All Mongoose schemas/models (multi-company)
'use strict';
const mongoose = require('mongoose');
const { Schema } = mongoose;

// ── Company ───────────────────────────────────────────────
const CompanySchema = new Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  plan: { type: String, default: 'free' },
  is_active: { type: Boolean, default: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// ── User ───────────────────────────────────────────────────
const UserSchema = new Schema({
  company_id: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  password: { type: String },
  role: { type: String, enum: ['admin', 'partner', 'quality', 'billing'], default: 'partner' },
  phone: { type: String, default: '' },
  is_active: { type: Boolean, default: true },
  google_id: { type: String },
  avatar_url: { type: String },
  auth_provider: { type: String, default: 'local' },
  last_login: { type: Date },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

UserSchema.index({ company_id: 1, email: 1 }, { unique: true });
UserSchema.index({ company_id: 1, google_id: 1 }, { unique: true, partialFilterExpression: { google_id: { $type: 'string' } } });

// ── OTP ───────────────────────────────────────────────────
const OtpSchema = new Schema({
  company_id: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
  email: { type: String, required: true, lowercase: true },
  code: { type: String, required: true },
  expires_at: { type: Date, required: true },
  used: { type: Boolean, default: false },
}, { timestamps: { createdAt: 'created_at', updatedAt: false } });

// ── Client ────────────────────────────────────────────────
const ClientSchema = new Schema({
  company_id: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
  name: { type: String, required: true, trim: true },
  company: { type: String, default: '' },
  email: { type: String, default: '' },
  phone: { type: String, default: '' },
  address: { type: String, default: '' },
  credit_status: { type: String, enum: ['good', 'hold', 'blocked'], default: 'good' },
  pending_amount: { type: Number, default: 0 },
  notes: { type: String, default: '' },
  created_by: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// ── Order Timeline Entry ───────────────────────────────────
const TimelineEntrySchema = new Schema({
  status: { type: String },
  action: { type: String, required: true },
  performed_by: { type: Schema.Types.ObjectId, ref: 'User' },
  actor_name: { type: String },
  notes: { type: String },
  is_fail: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now },
});

// ── Order ─────────────────────────────────────────────────
const OrderSchema = new Schema({
  company_id: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
  order_number: { type: String, required: true },
  client_id: { type: Schema.Types.ObjectId, ref: 'Client' },
  client_name: { type: String, required: true },
  client_email: { type: String, default: '' },
  client_phone: { type: String, default: '' },
  source: { type: String, default: 'direct' },
  description: { type: String, default: '' },
  status: { type: String, default: 'received' },
  priority: { type: String, enum: ['low', 'normal', 'critical', 'urgent'], default: 'normal' },
  partner_id: { type: Schema.Types.ObjectId, ref: 'User' },
  amount: { type: Number, default: 0 },
  rej_reason: { type: String },
  quality_notes: { type: String },
  billing_notes: { type: String },
  dispatch_info: { type: String },
  created_by: { type: Schema.Types.ObjectId, ref: 'User' },
  timeline: [TimelineEntrySchema],
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

OrderSchema.index({ company_id: 1, order_number: 1 }, { unique: true });

// ── Notification ──────────────────────────────────────────
const NotificationSchema = new Schema({
  company_id: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
  order_id: { type: Schema.Types.ObjectId, ref: 'Order' },
  type: { type: String, required: true },
  recipient: { type: String, default: '' },
  subject: { type: String, default: '' },
  message: { type: String, default: '' },
  status: { type: String, default: 'pending' },
  error_msg: { type: String },
  sent_at: { type: Date },
}, { timestamps: { createdAt: 'created_at', updatedAt: false } });

module.exports = {
  Company: mongoose.model('Company', CompanySchema),
  User: mongoose.model('User', UserSchema),
  Otp: mongoose.model('Otp', OtpSchema),
  Client: mongoose.model('Client', ClientSchema),
  Order: mongoose.model('Order', OrderSchema),
  Notification: mongoose.model('Notification', NotificationSchema),
};
