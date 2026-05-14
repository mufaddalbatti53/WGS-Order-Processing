require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { connectDB } = require('./db/index');

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));   // 50 mb for restore uploads

// Connect to MongoDB before handling API requests
app.use('/api', async (req, res, next) => {
  try { await connectDB(); next(); }
  catch (e) { res.status(503).json({ error: 'Database connection failed: ' + e.message }); }
});

app.get('/health', (req, res) =>
  res.json({ status: 'ok', app: 'WGS Order Processing API', time: new Date().toISOString(), db: 'MongoDB' })
);

app.use('/api/auth',          require('./routes/auth'));
app.use('/api/orders',        require('./routes/orders'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/products', require('./routes/products')); 
app.use('/api/users', require('./routes/users'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/backup',        require('./routes/backup'));   // ← NEW

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Catch-all: serve frontend for non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n⚡ WGS Order Processing running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   DB: MongoDB Atlas\n`);
});
