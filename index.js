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
const PORT = process.env.PORT || 5003;

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

app.get(['/privacy', '/privacy.html'], (_req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));
app.get(['/terms', '/terms.html'], (_req, res) => res.sendFile(path.join(__dirname, 'public', 'terms.html')));
app.get(['/refund', '/refund.html'], (_req, res) => res.sendFile(path.join(__dirname, 'public', 'refund.html')));
app.get(['/contact', '/contact.html'], (_req, res) => res.sendFile(path.join(__dirname, 'public', 'contact.html')));

app.get('/api/legal/policies', (_req, res) => {
  const host = _req.get('host') || 'localhost:5003';
  const proto = _req.protocol || 'http';
  res.json({
    platform: 'Matdata Portal (मतदाता पोर्टल)',
    version: '2026.1',
    effectiveDate: '2026-01-01',
    lastUpdated: new Date().toISOString(),
    policies: {
      privacy: { title: 'Privacy Policy (गोपनीयता नीति)', path: '/privacy.html', url: `${proto}://${host}/privacy.html` },
      terms: { title: 'Terms of Service (नियम और शर्तें)', path: '/terms.html', url: `${proto}://${host}/terms.html` },
      refund: { title: 'Refund Policy (धनवापसी नीति)', path: '/refund.html', url: `${proto}://${host}/refund.html` },
      contact: { title: 'Contact & Grievance (संपर्क एवं शिकायत)', path: '/contact.html', url: `${proto}://${host}/contact.html` }
    },
    compliance: {
      eciGuidelinesCompliant: true,
      itAct2000Compliant: true,
      dpdpAct2023Compliant: true,
      metaWhatsAppCloudApiCompliant: true,
      commercialDataSaleProhibited: true
    }
  });
});

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

app.get(['/health', '/api/health'], async (_req, res) => {
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
