const logger = require('../utils/logger');

/**
 * Middleware to check if admin is authenticated via session
 * Returns 401 if not authenticated
 */
const requireAdmin = (req, res, next) => {
  if (req.session && req.session.adminUser) {
    return next();
  }
  
  logger.warn('Unauthorized admin access attempt', {
    ip: req.ip,
    path: req.path,
  });
  
  // For API requests, return JSON error
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  // For page requests, redirect to login
  return res.redirect('/login.html');
};

/**
 * Middleware to check if user is logged in (for HTML pages)
 * Redirects to login if not authenticated
 */
const requireAdminPage = (req, res, next) => {
  if (req.session && req.session.adminUser) {
    return next();
  }
  return res.redirect('/login.html');
};

module.exports = {
  requireAdmin,
  requireAdminPage,
};
