const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const helmet = require('helmet'); // Security Headers & CSP
const logger = require('./lib/logger'); // Structured Logging

dotenv.config();

const db = require('./db');
// Route imports
const authRoutes = require('./routes/auth');
const voterRoutes = require('./routes/voters');
const whatsappRoutes = require('./routes/whatsapp');
const adminRoutes = require('./routes/admin');
const userRoutes = require('./routes/users');
const featureRoutes = require('./routes/features');

const app = express();
app.set('trust proxy', true);
const PORT = process.env.PORT || 5002;

// Rate Limiting (Token Bucket / Throttling)
const rateLimit = require('express-rate-limit');
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 300, // Limit each IP to 300 requests per `window`
  message: 'Too many requests from this IP, please try again after a minute',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  validate: { trustProxy: false },
});

const path = require('path');

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
})); // Secure HTTP headers with cross-origin resource access for slips
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/privacy.html', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));
app.get('/privacy', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));
app.get('/terms.html', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'terms.html')));
app.get('/terms', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'terms.html')));

app.use('/api', apiLimiter); // Apply rate limiter to all API routes

// Request Logging Middleware
app.use((req, res, next) => {
  logger.info(`Incoming Request: ${req.method} ${req.url}`, { ip: req.ip });
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/voters', voterRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/users', userRoutes);
app.use('/api/features', featureRoutes.router);
app.use('/api/admin/pdf', require('./routes/admin_pdf'));

app.get('/api/health', async (_req, res) => {
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      res.json({ status: 'ok', database: 'connected' });
    } else {
      res.status(503).json({ status: 'degraded', database: 'unavailable' });
    }
  } catch (err) {
    console.error('Health check failed:', err.message);
    res.status(503).json({ status: 'degraded', database: 'error' });
  }
});

app.get('/', (req, res) => {
  res.send('Matdata Portal Backend API is running.');
});

// Graceful Error Handling & Circuit Breakers Fallback
app.use((err, req, res, next) => {
  logger.error(`Unhandled Exception: ${err.message}`, { stack: err.stack, url: req.url });
  res.status(500).json({
    message: 'System is currently experiencing heavy load. Circuit breaker engaged. Please try again in a few moments.',
    errorId: Date.now()
  });
});

const startServer = () => {
  app.listen(PORT, () => {
    logger.info(`Server is running on port ${PORT}`);
  });
};

if (require.main === module) {
  db.connectDB()
    .then(() => startServer())
    .catch((err) => {
      logger.error('Database startup failed', { message: err.message });
      process.exitCode = 1;
    });
}

module.exports = { app, startServer };
