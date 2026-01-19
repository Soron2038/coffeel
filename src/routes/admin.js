const basicAuth = require('express-basic-auth');
const logger = require('../utils/logger');

/**
 * Admin authentication middleware using HTTP Basic Auth
 * Credentials are loaded from environment variables
 */
const adminAuth = basicAuth({
  users: {
    [process.env.ADMIN_USER || 'admin']: process.env.ADMIN_PASS || 'admin',
  },
  challenge: true,
  realm: 'CofFeEL Admin Panel',
  unauthorizedResponse: (req) => {
    logger.warn('Unauthorized admin access attempt', {
      ip: req.ip,
      path: req.path,
    });
    return { error: 'Unauthorized' };
  },
});

/**
 * Middleware to check if admin is authenticated
 * Returns 401 if not authenticated
 */
const requireAdmin = (req, res, next) => {
  adminAuth(req, res, (err) => {
    if (err) {
      logger.error('Admin auth error', { error: err.message });
      return res.status(500).json({ error: 'Authentication error' });
    }
    next();
  });
};

module.exports = {
  adminAuth,
  requireAdmin,
};
