require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const { connectDB } = require('./db/index');

const app = express();

const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3000','http://localhost:5500','http://127.0.0.1:5500',
  'capacitor://localhost','https://localhost',
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => (!origin || allowedOrigins.includes(origin)) ? cb(null, true) : cb(new Error('CORS blocked')),
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));

// Connect to MongoDB before handling requests
app.use(async (req, res, next) => {
  try { await connectDB(); next(); }
  catch(e) { res.status(503).json({ error: 'Database connection failed: ' + e.message }); }
});

app.get('/health', (req, res) => res.json({ status: 'ok', app: 'WGS Order Processing API', time: new Date().toISOString(), db: 'MongoDB' }));

app.use('/api/auth',          require('./routes/auth'));
app.use('/api/orders',        require('./routes/orders'));
app.use('/api/clients',       require('./routes/clients'));
app.use('/api/users',         require('./routes/users'));
app.use('/api/notifications', require('./routes/notifications'));

app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
app.use((err, req, res, next) => { console.error(err.message); res.status(500).json({ error: err.message }); });

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n⚡ WGS Order Processing API running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   DB: MongoDB Atlas\n`);
});
