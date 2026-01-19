const express = require('express');
const router = express.Router();

const userService = require('../services/userService');
const paymentService = require('../services/paymentService');
const settingsService = require('../services/settingsService');
const adminUserService = require('../services/adminUserService');
const { requireAdmin } = require('./admin');
const { validateId, validatePaymentAmount } = require('../utils/validation');
const logger = require('../utils/logger');

// ============================================
// USER ENDPOINTS
// ============================================

/**
 * GET /api/users
 * Get all users (only active by default)
 * Query params: includeDeleted=true to include soft-deleted users
 */
router.get('/users', (req, res) => {
  try {
    const includeDeleted = req.query.includeDeleted === 'true';
    const users = userService.getAllUsers(includeDeleted);
    res.json(users);
  } catch (err) {
    logger.error('Failed to get users', { error: err.message });
    res.status(500).json({ error: 'Failed to retrieve users' });
  }
});

/**
 * GET /api/users/:id
 * Get a single user by ID
 */
router.get('/users/:id', (req, res) => {
  try {
    if (!validateId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const user = userService.getUserById(parseInt(req.params.id, 10));
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (err) {
    logger.error('Failed to get user', { error: err.message });
    res.status(500).json({ error: 'Failed to retrieve user' });
  }
});

/**
 * POST /api/users
 * Create a new user
 */
router.post('/users', (req, res) => {
  try {
    const { firstName, lastName, email } = req.body;
    const result = userService.createUser(firstName, lastName, email);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.status(201).json(result.user);
  } catch (err) {
    logger.error('Failed to create user', { error: err.message });
    res.status(500).json({ error: 'Failed to create user' });
  }
});

/**
 * DELETE /api/users/:id
 * Soft delete a user (self-service)
 */
router.delete('/users/:id', (req, res) => {
  try {
    if (!validateId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const result = userService.softDeleteUser(parseInt(req.params.id, 10));
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      id: result.user.id,
      deletedByUser: result.user.deletedByUser,
      deletedAt: result.user.deletedAt,
      message: 'User soft-deleted successfully',
    });
  } catch (err) {
    logger.error('Failed to soft delete user', { error: err.message });
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

/**
 * POST /api/users/:id/restore
 * Restore a soft-deleted user (admin only)
 */
router.post('/users/:id/restore', requireAdmin, (req, res) => {
  try {
    if (!validateId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const result = userService.restoreUser(parseInt(req.params.id, 10));
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      id: result.user.id,
      deletedByUser: result.user.deletedByUser,
      deletedAt: result.user.deletedAt,
      message: 'User restored successfully',
    });
  } catch (err) {
    logger.error('Failed to restore user', { error: err.message });
    res.status(500).json({ error: 'Failed to restore user' });
  }
});

/**
 * DELETE /api/users/:id/permanent
 * Permanently delete a user (admin only)
 */
router.delete('/users/:id/permanent', requireAdmin, (req, res) => {
  try {
    if (!validateId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const result = userService.hardDeleteUser(parseInt(req.params.id, 10));
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ message: 'User permanently deleted' });
  } catch (err) {
    logger.error('Failed to hard delete user', { error: err.message });
    res.status(500).json({ error: 'Failed to permanently delete user' });
  }
});

// ============================================
// COFFEE TRACKING ENDPOINTS
// ============================================

/**
 * POST /api/users/:id/increment
 * Increment coffee count by 1
 */
router.post('/users/:id/increment', (req, res) => {
  try {
    if (!validateId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const result = userService.incrementCoffee(parseInt(req.params.id, 10));
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      id: result.user.id,
      coffeeCount: result.user.coffeeCount,
      accountBalance: result.user.accountBalance,
    });
  } catch (err) {
    logger.error('Failed to increment coffee', { error: err.message });
    res.status(500).json({ error: 'Failed to increment coffee count' });
  }
});

/**
 * POST /api/users/:id/decrement
 * Decrement coffee count by 1 (minimum 0)
 */
router.post('/users/:id/decrement', (req, res) => {
  try {
    if (!validateId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const result = userService.decrementCoffee(parseInt(req.params.id, 10));
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      id: result.user.id,
      coffeeCount: result.user.coffeeCount,
      accountBalance: result.user.accountBalance,
    });
  } catch (err) {
    logger.error('Failed to decrement coffee', { error: err.message });
    res.status(500).json({ error: 'Failed to decrement coffee count' });
  }
});

/**
 * PUT /api/users/:id/coffee-count
 * Set coffee count directly (admin only)
 */
router.put('/users/:id/coffee-count', requireAdmin, (req, res) => {
  try {
    if (!validateId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const { count } = req.body;
    const result = userService.setCoffeeCount(parseInt(req.params.id, 10), count);
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result.user);
  } catch (err) {
    logger.error('Failed to set coffee count', { error: err.message });
    res.status(500).json({ error: 'Failed to update coffee count' });
  }
});

// ============================================
// PAYMENT ENDPOINTS
// ============================================

/**
 * POST /api/users/:id/pay
 * Request payment (send email, update balances)
 */
router.post('/users/:id/pay', async (req, res) => {
  try {
    if (!validateId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const result = await paymentService.requestPayment(parseInt(req.params.id, 10));
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      id: result.user.id,
      coffeeCount: result.user.coffeeCount,
      pendingPayment: result.user.pendingPayment,
      accountBalance: result.user.accountBalance,
      emailSent: result.payment.emailSent,
      paymentId: result.payment.id,
      message: result.message,
    });
  } catch (err) {
    logger.error('Failed to request payment', { error: err.message });
    res.status(500).json({ error: 'Failed to process payment request' });
  }
});

/**
 * POST /api/users/:id/confirm-payment
 * Confirm payment received (admin only)
 */
router.post('/users/:id/confirm-payment', requireAdmin, (req, res) => {
  try {
    if (!validateId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const { amount, notes } = req.body;
    const validation = validatePaymentAmount(amount);
    
    if (!validation.isValid) {
      return res.status(400).json({ error: validation.error });
    }

    const result = paymentService.confirmPayment(
      parseInt(req.params.id, 10),
      validation.amount,
      notes
    );
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      id: result.user.id,
      pendingPayment: result.user.pendingPayment,
      accountBalance: result.user.accountBalance,
      paymentId: result.payment.id,
      message: result.message,
    });
  } catch (err) {
    logger.error('Failed to confirm payment', { error: err.message });
    res.status(500).json({ error: 'Failed to confirm payment' });
  }
});

/**
 * PUT /api/users/:id/balance
 * Adjust user balance (admin only)
 */
router.put('/users/:id/balance', requireAdmin, (req, res) => {
  try {
    if (!validateId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const { amount, notes } = req.body;
    const result = userService.adjustBalance(
      parseInt(req.params.id, 10),
      amount,
      notes
    );
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result.user);
  } catch (err) {
    logger.error('Failed to adjust balance', { error: err.message });
    res.status(500).json({ error: 'Failed to adjust balance' });
  }
});

/**
 * GET /api/payments
 * Get payment history (admin only)
 * Query params: userId, type, startDate, endDate, limit
 */
router.get('/payments', requireAdmin, (req, res) => {
  try {
    const filters = {
      userId: req.query.userId ? parseInt(req.query.userId, 10) : undefined,
      type: req.query.type,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
    };

    const payments = paymentService.getPaymentHistory(filters);
    res.json(payments);
  } catch (err) {
    logger.error('Failed to get payment history', { error: err.message });
    res.status(500).json({ error: 'Failed to retrieve payment history' });
  }
});

/**
 * GET /api/payments/summary
 * Get payment summary statistics (admin only)
 */
router.get('/payments/summary', requireAdmin, (req, res) => {
  try {
    const summary = paymentService.getPaymentSummary();
    res.json(summary);
  } catch (err) {
    logger.error('Failed to get payment summary', { error: err.message });
    res.status(500).json({ error: 'Failed to retrieve payment summary' });
  }
});

// ============================================
// PUBLIC SETTINGS ENDPOINTS
// ============================================

/**
 * GET /api/settings/coffee_price
 * Get coffee price (public, needed for kiosk display)
 */
router.get('/settings/coffee_price', (req, res) => {
  try {
    const price = settingsService.getSetting('coffee_price');
    res.json({ coffeePrice: parseFloat(price) || 0.50 });
  } catch (err) {
    logger.error('Failed to get coffee price', { error: err.message });
    res.status(500).json({ error: 'Failed to retrieve coffee price' });
  }
});

// ============================================
// SETTINGS ENDPOINTS (Admin only)
// ============================================

/**
 * GET /api/settings
 * Get all settings
 */
router.get('/settings', requireAdmin, (req, res) => {
  try {
    const settings = settingsService.getAllSettings();
    res.json(settings);
  } catch (err) {
    logger.error('Failed to get settings', { error: err.message });
    res.status(500).json({ error: 'Failed to retrieve settings' });
  }
});

/**
 * PUT /api/settings/:key
 * Update a setting
 */
router.put('/settings/:key', requireAdmin, (req, res) => {
  try {
    const { value } = req.body;
    const result = settingsService.updateSetting(req.params.key, value);
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ key: result.key, value: result.value });
  } catch (err) {
    logger.error('Failed to update setting', { error: err.message });
    res.status(500).json({ error: 'Failed to update setting' });
  }
});

/**
 * POST /api/settings/test-smtp
 * Send a test email to verify SMTP configuration
 */
router.post('/settings/test-smtp', requireAdmin, async (req, res) => {
  try {
    const emailService = require('../services/emailService');
    const adminEmail = settingsService.getSetting('admin_email');
    
    if (!adminEmail) {
      return res.status(400).json({ success: false, error: 'Admin email not configured' });
    }

    const result = await emailService.sendTestEmail(adminEmail);
    
    if (result.success) {
      res.json({ success: true, message: 'Test email sent successfully' });
    } else {
      res.json({ success: false, error: result.error });
    }
  } catch (err) {
    logger.error('SMTP test failed', { error: err.message });
    res.json({ success: false, error: err.message });
  }
});

// ============================================
// EXPORT ENDPOINTS (Admin only)
// ============================================

/**
 * GET /api/export/csv
 * Export all data as CSV
 */
router.get('/export/csv', requireAdmin, (req, res) => {
  try {
    const includeDeleted = req.query.includeDeleted !== 'false';
    const data = paymentService.exportData(includeDeleted);

    // Convert users to CSV
    const userHeaders = [
      'ID', 'First Name', 'Last Name', 'Email', 'Coffee Count',
      'Pending Payment', 'Account Balance', 'Last Payment Request',
      'Deleted', 'Deleted At', 'Created At'
    ];
    
    const userRows = data.users.map(u => [
      u.id, u.firstName, u.lastName, u.email, u.coffeeCount,
      u.pendingPayment, u.accountBalance, u.lastPaymentRequest || '',
      u.deleted, u.deletedAt || '', u.createdAt
    ]);

    const usersCSV = [
      userHeaders.join(','),
      ...userRows.map(r => r.map(v => `"${v}"`).join(','))
    ].join('\n');

    // Convert payments to CSV
    const paymentHeaders = [
      'ID', 'User ID', 'User Name', 'Email', 'Amount', 'Type',
      'Coffee Count', 'Confirmed', 'Notes', 'Created At'
    ];

    const paymentRows = data.payments.map(p => [
      p.id, p.userId, p.userName, p.userEmail, p.amount, p.type,
      p.coffeeCount || '', p.confirmedByAdmin ? 'Yes' : 'No',
      p.adminNotes || '', p.createdAt
    ]);

    const paymentsCSV = [
      paymentHeaders.join(','),
      ...paymentRows.map(r => r.map(v => `"${v}"`).join(','))
    ].join('\n');

    // Combine both
    const fullCSV = `USERS\n${usersCSV}\n\nPAYMENTS\n${paymentsCSV}`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="coffeel-export-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(fullCSV);
  } catch (err) {
    logger.error('Failed to export data', { error: err.message });
    res.status(500).json({ error: 'Failed to export data' });
  }
});

/**
 * GET /api/export/json
 * Export all data as JSON
 */
router.get('/export/json', requireAdmin, (req, res) => {
  try {
    const includeDeleted = req.query.includeDeleted !== 'false';
    const data = paymentService.exportData(includeDeleted);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="coffeel-export-${new Date().toISOString().slice(0,10)}.json"`);
    res.json(data);
  } catch (err) {
    logger.error('Failed to export data', { error: err.message });
    res.status(500).json({ error: 'Failed to export data' });
  }
});

// ============================================
// ADMIN AUTHENTICATION ENDPOINTS
// ============================================

/**
 * POST /api/admin/login
 * Admin login (creates session)
 */
router.post('/admin/login', (req, res) => {
  try {
    const { username, password } = req.body;
    const result = adminUserService.verifyCredentials(username, password);

    if (!result.success) {
      return res.status(401).json({ error: result.error });
    }

    // Store admin user in session
    req.session.adminUser = result.user;

    res.json({
      success: true,
      user: result.user,
    });
  } catch (err) {
    logger.error('Login error', { error: err.message });
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * POST /api/admin/logout
 * Admin logout (destroys session)
 */
router.post('/admin/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      logger.error('Logout error', { error: err.message });
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ success: true });
  });
});

/**
 * GET /api/admin/session
 * Check if admin is logged in
 */
router.get('/admin/session', (req, res) => {
  if (req.session && req.session.adminUser) {
    res.json({ loggedIn: true, user: req.session.adminUser });
  } else {
    res.json({ loggedIn: false });
  }
});

// ============================================
// ADMIN USER MANAGEMENT ENDPOINTS (Admin only)
// ============================================

/**
 * GET /api/admin/users
 * Get all admin users
 */
router.get('/admin/users', requireAdmin, (req, res) => {
  try {
    const users = adminUserService.getAllAdminUsers();
    res.json(users);
  } catch (err) {
    logger.error('Failed to get admin users', { error: err.message });
    res.status(500).json({ error: 'Failed to retrieve admin users' });
  }
});

/**
 * POST /api/admin/users
 * Create a new admin user
 */
router.post('/admin/users', requireAdmin, (req, res) => {
  try {
    const { username, password } = req.body;
    const result = adminUserService.createAdminUser(username, password);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.status(201).json(result.user);
  } catch (err) {
    logger.error('Failed to create admin user', { error: err.message });
    res.status(500).json({ error: 'Failed to create admin user' });
  }
});

/**
 * PUT /api/admin/users/:id/password
 * Change admin user password
 */
router.put('/admin/users/:id/password', requireAdmin, (req, res) => {
  try {
    const { password } = req.body;
    const result = adminUserService.changePassword(
      parseInt(req.params.id, 10),
      password
    );

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ success: true });
  } catch (err) {
    logger.error('Failed to change admin password', { error: err.message });
    res.status(500).json({ error: 'Failed to change password' });
  }
});

/**
 * DELETE /api/admin/users/:id
 * Delete an admin user
 */
router.delete('/admin/users/:id', requireAdmin, (req, res) => {
  try {
    const result = adminUserService.deleteAdminUser(parseInt(req.params.id, 10));

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ success: true });
  } catch (err) {
    logger.error('Failed to delete admin user', { error: err.message });
    res.status(500).json({ error: 'Failed to delete admin user' });
  }
});

// ============================================
// HEALTH CHECK
// ============================================

/**
 * GET /api/health
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = router;
