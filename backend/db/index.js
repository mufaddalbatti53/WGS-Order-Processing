// db/index.js — MongoDB connection via Mongoose
'use strict';
const mongoose = require('mongoose');

let isConnected = false;

async function connectDB() {
  if (isConnected) return;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set in environment variables');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  isConnected = true;
  console.log('✅ MongoDB connected:', mongoose.connection.host);
}

mongoose.connection.on('disconnected', () => {
  isConnected = false;
  console.warn('⚠️  MongoDB disconnected. Will reconnect on next request.');
});

module.exports = { connectDB, mongoose };
