require('dotenv').config();

const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');

const db = require('./db/database');
const apiRouter = require('./routes/api');
const { adminAuth } = require('./routes/admin');
const logger = require('./utils/logger');

// Initialize Express app
const app = express();

// Configuration
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';

// ============================================
// MIDDLEWARE
// ============================================

// Trust proxy (for rate limiting behind nginx)
app.set('trust proxy', 1);

// JSON body parser
app.use(express.json());

// URL-encoded body parser
app.use(express.urlencoded({ extended: true }));

// Rate limiting (60 requests per minute per IP)
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000, // 1 minute
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 60,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// Request logging (development only)
if (NODE_ENV === 'development') {
  app.use((req, res, next) => {
    logger.debug(`${req.method} ${req.path}`, {
      query: req.query,
      body: req.method === 'POST' || req.method === 'PUT' ? req.body : undefined,
    });
    next();
  });
}

// ============================================
// STATIC FILES
// ============================================

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// Admin panel with Basic Auth
app.use('/admin.html', adminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

// ============================================
// API ROUTES
// ============================================

app.use('/api', apiRouter);

// ============================================
// ERROR HANDLING
// ============================================

// 404 handler for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: NODE_ENV === 'development' ? err.stack : undefined,
    path: req.path,
    method: req.method,
  });

  res.status(500).json({
    error: NODE_ENV === 'development' ? err.message : 'Internal server error',
  });
});

// ============================================
// SERVER STARTUP
// ============================================

// Initialize database
try {
  db.initialize();
  logger.info('Database initialized successfully');
} catch (err) {
  logger.error('Failed to initialize database', { error: err.message });
  process.exit(1);
}

// Start server
const server = app.listen(PORT, HOST, () => {
  logger.info(`CofFeEL server running`, {
    host: HOST,
    port: PORT,
    env: NODE_ENV,
    url: `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`,
  });

  console.log(`
╔═══════════════════════════════════════════════════╗
║                                                   ║
║   ☕ CofFeEL - Coffee Tracking System             ║
║                                                   ║
║   Kiosk:  http://localhost:${PORT}                  ║
║   Admin:  http://localhost:${PORT}/admin.html       ║
║   API:    http://localhost:${PORT}/api              ║
║                                                   ║
║   Environment: ${NODE_ENV.padEnd(33)}║
║                                                   ║
╚═══════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
const shutdown = (signal) => {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  
  server.close(() => {
    logger.info('HTTP server closed');
    db.close();
    logger.info('Database connection closed');
    process.exit(0);
  });

  // Force close after 10 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app; // For testing
