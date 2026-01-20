const express = require('express');
const router = express.Router();

const userService = require('../services/userService');
const paymentService = require('../services/paymentService');
const settingsService = require('../services/settingsService');
const adminUserService = require('../services/adminUserService');
const { requireAdmin } = require('./admin');
const { validateIdParam, validatePaymentAmount, asyncHandler } = require('../utils/validation');

// ============================================
// USER ENDPOINTS
// ============================================

// GET /api/users - Get all users (query: includeDeleted=true)
router.get('/users', asyncHandler(async (req, res) => {
  const includeDeleted = req.query.includeDeleted === 'true';
  const users = userService.getAllUsers(includeDeleted);
  res.json(users);
}));

// GET /api/users/:id - Get single user
router.get('/users/:id', validateIdParam, asyncHandler(async (req, res) => {
  const user = userService.getUserById(req.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json(user);
}));

// POST /api/users - Create new user
router.post('/users', asyncHandler(async (req, res) => {
  const { firstName, lastName, email } = req.body;
  const result = userService.createUser(firstName, lastName, email);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  res.status(201).json(result.user);
}));

// DELETE /api/users/:id - Soft delete user (self-service)
router.delete('/users/:id', validateIdParam, asyncHandler(async (req, res) => {
  const result = userService.softDeleteUser(req.userId);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  res.json({
    id: result.user.id,
    deletedByUser: result.user.deletedByUser,
    deletedAt: result.user.deletedAt,
    message: 'User soft-deleted successfully',
  });
}));

// POST /api/users/:id/restore - Restore soft-deleted user (admin)
router.post('/users/:id/restore', requireAdmin, validateIdParam, asyncHandler(async (req, res) => {
  const result = userService.restoreUser(req.userId);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  res.json({
    id: result.user.id,
    deletedByUser: result.user.deletedByUser,
    deletedAt: result.user.deletedAt,
    message: 'User restored successfully',
  });
}));

// DELETE /api/users/:id/permanent - Hard delete user (admin)
router.delete('/users/:id/permanent', requireAdmin, validateIdParam, asyncHandler(async (req, res) => {
  const result = userService.hardDeleteUser(req.userId);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  res.json({ message: 'User permanently deleted' });
}));

// ============================================
// TAB TRACKING ENDPOINTS
// ============================================

// POST /api/users/:id/increment - Add coffee price to tab
router.post('/users/:id/increment', validateIdParam, asyncHandler(async (req, res) => {
  const coffeePrice = settingsService.getCoffeePrice();
  const result = userService.incrementTab(req.userId, coffeePrice);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  res.json({
    id: result.user.id,
    currentTab: result.user.currentTab,
    accountBalance: result.user.accountBalance,
  });
}));

// POST /api/users/:id/decrement - Subtract coffee price from tab
router.post('/users/:id/decrement', validateIdParam, asyncHandler(async (req, res) => {
  const coffeePrice = settingsService.getCoffeePrice();
  const result = userService.decrementTab(req.userId, coffeePrice);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  res.json({
    id: result.user.id,
    currentTab: result.user.currentTab,
    accountBalance: result.user.accountBalance,
  });
}));

// PUT /api/users/:id/current-tab - Set tab amount directly (admin)
router.put('/users/:id/current-tab', requireAdmin, validateIdParam, asyncHandler(async (req, res) => {
  const { amount } = req.body;
  const result = userService.setCurrentTab(req.userId, amount);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  res.json(result.user);
}));

// ============================================
// PAYMENT ENDPOINTS
// ============================================

// POST /api/users/:id/pay - Request payment (send email)
router.post('/users/:id/pay', validateIdParam, asyncHandler(async (req, res) => {
  const result = await paymentService.requestPayment(req.userId);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  res.json({
    id: result.user.id,
    currentTab: result.user.currentTab,
    pendingPayment: result.user.pendingPayment,
    accountBalance: result.user.accountBalance,
    emailSent: result.payment.emailSent,
    paymentId: result.payment.id,
    message: result.message,
  });
}));

// POST /api/users/:id/confirm-payment - Confirm payment received (admin)
router.post('/users/:id/confirm-payment', requireAdmin, validateIdParam, asyncHandler(async (req, res) => {
  const { amount, notes } = req.body;
  const validation = validatePaymentAmount(amount);
  if (!validation.isValid) {
    return res.status(400).json({ error: validation.error });
  }
  const result = paymentService.confirmPayment(req.userId, validation.amount, notes);
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
}));

// PUT /api/users/:id/balance - Adjust user balance (admin)
router.put('/users/:id/balance', requireAdmin, validateIdParam, asyncHandler(async (req, res) => {
  const { amount, notes } = req.body;
  const result = userService.adjustBalance(req.userId, amount, notes);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  res.json(result.user);
}));

// GET /api/payments - Get payment history (admin)
router.get('/payments', requireAdmin, asyncHandler(async (req, res) => {
  const filters = {
    userId: req.query.userId ? parseInt(req.query.userId, 10) : undefined,
    type: req.query.type,
    startDate: req.query.startDate,
    endDate: req.query.endDate,
    limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
  };
  const payments = paymentService.getPaymentHistory(filters);
  res.json(payments);
}));

// GET /api/payments/summary - Get payment summary (admin)
router.get('/payments/summary', requireAdmin, asyncHandler(async (req, res) => {
  const summary = paymentService.getPaymentSummary();
  res.json(summary);
}));

// ============================================
// SETTINGS ENDPOINTS
// ============================================

// GET /api/settings/coffee_price - Public endpoint for kiosk
router.get('/settings/coffee_price', asyncHandler(async (req, res) => {
  const price = settingsService.getSetting('coffee_price');
  res.json({ coffeePrice: parseFloat(price) || 0.50 });
}));

// GET /api/settings - Get all settings (admin)
router.get('/settings', requireAdmin, asyncHandler(async (req, res) => {
  const settings = settingsService.getAllSettings();
  res.json(settings);
}));

// PUT /api/settings/:key - Update setting (admin)
router.put('/settings/:key', requireAdmin, asyncHandler(async (req, res) => {
  const { value } = req.body;
  const result = settingsService.updateSetting(req.params.key, value);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  res.json({ key: result.key, value: result.value });
}));

// POST /api/settings/test-smtp - Test SMTP configuration (admin)
router.post('/settings/test-smtp', requireAdmin, asyncHandler(async (req, res) => {
  const emailService = require('../services/emailService');
  const adminEmail = settingsService.getSetting('admin_email');
  if (!adminEmail) {
    return res.status(400).json({ success: false, error: 'Admin email not configured' });
  }
  const result = await emailService.sendTestEmail(adminEmail);
  res.json(result.success 
    ? { success: true, message: 'Test email sent successfully' }
    : { success: false, error: result.error }
  );
}));

// ============================================
// EXPORT ENDPOINTS (Admin only)
// ============================================

// GET /api/export/csv - Export data as CSV
router.get('/export/csv', requireAdmin, asyncHandler(async (req, res) => {
  const includeDeleted = req.query.includeDeleted !== 'false';
  const data = paymentService.exportData(includeDeleted);

  const userHeaders = ['ID', 'First Name', 'Last Name', 'Email', 'Current Tab', 'Pending Payment', 'Account Balance', 'Last Payment Request', 'Deleted', 'Deleted At', 'Created At'];
  const userRows = data.users.map(u => [u.id, u.firstName, u.lastName, u.email, u.currentTab, u.pendingPayment, u.accountBalance, u.lastPaymentRequest || '', u.deleted, u.deletedAt || '', u.createdAt]);
  const usersCSV = [userHeaders.join(','), ...userRows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');

  const paymentHeaders = ['ID', 'User ID', 'User Name', 'Email', 'Amount', 'Type', 'Confirmed', 'Notes', 'Created At'];
  const paymentRows = data.payments.map(p => [p.id, p.userId, p.userName, p.userEmail, p.amount, p.type, p.confirmedByAdmin ? 'Yes' : 'No', p.adminNotes || '', p.createdAt]);
  const paymentsCSV = [paymentHeaders.join(','), ...paymentRows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="coffeel-export-${new Date().toISOString().slice(0,10)}.csv"`);
  res.send(`USERS\n${usersCSV}\n\nPAYMENTS\n${paymentsCSV}`);
}));

// GET /api/export/json - Export data as JSON
router.get('/export/json', requireAdmin, asyncHandler(async (req, res) => {
  const includeDeleted = req.query.includeDeleted !== 'false';
  const data = paymentService.exportData(includeDeleted);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="coffeel-export-${new Date().toISOString().slice(0,10)}.json"`);
  res.json(data);
}));

// ============================================
// ADMIN AUTHENTICATION ENDPOINTS
// ============================================

// POST /api/admin/login - Admin login
router.post('/admin/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  const result = adminUserService.verifyCredentials(username, password);
  if (!result.success) {
    return res.status(401).json({ error: result.error });
  }
  req.session.adminUser = result.user;
  res.json({ success: true, user: result.user });
}));

// POST /api/admin/logout - Admin logout
router.post('/admin/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ success: true });
  });
});

// GET /api/admin/session - Check login status
router.get('/admin/session', (req, res) => {
  res.json(req.session?.adminUser 
    ? { loggedIn: true, user: req.session.adminUser }
    : { loggedIn: false }
  );
});

// ============================================
// ADMIN USER MANAGEMENT (Admin only)
// ============================================

// GET /api/admin/users - Get all admin users
router.get('/admin/users', requireAdmin, asyncHandler(async (req, res) => {
  const users = adminUserService.getAllAdminUsers();
  res.json(users);
}));

// POST /api/admin/users - Create admin user
router.post('/admin/users', requireAdmin, asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  const result = adminUserService.createAdminUser(username, password);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  res.status(201).json(result.user);
}));

// PUT /api/admin/users/:id/password - Change admin password
router.put('/admin/users/:id/password', requireAdmin, asyncHandler(async (req, res) => {
  const { password } = req.body;
  const result = adminUserService.changePassword(parseInt(req.params.id, 10), password);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  res.json({ success: true });
}));

// DELETE /api/admin/users/:id - Delete admin user
router.delete('/admin/users/:id', requireAdmin, asyncHandler(async (req, res) => {
  const result = adminUserService.deleteAdminUser(parseInt(req.params.id, 10));
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  res.json({ success: true });
}));

// ============================================
// HEALTH CHECK
// ============================================

router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = router;
