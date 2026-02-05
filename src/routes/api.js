const express = require('express');
const router = express.Router();

const userService = require('../services/userService');
const paymentService = require('../services/paymentService');
const settingsService = require('../services/settingsService');
const adminUserService = require('../services/adminUserService');
const db = require('../db/database');
const logger = require('../utils/logger');
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

// POST /api/users - Create new user (or reactivate soft-deleted)
router.post('/users', asyncHandler(async (req, res) => {
  const { firstName, lastName, email } = req.body;
  const result = await userService.createUser(firstName, lastName, email);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  res.status(201).json({
    ...result.user,
    reactivated: result.reactivated || false,
  });
}));

// DELETE /api/users/:id - Soft delete user (self-service)
// Automatically sends payment request if user has outstanding tab
router.delete('/users/:id', validateIdParam, asyncHandler(async (req, res) => {
  const result = await userService.softDeleteUser(req.userId);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  res.json({
    id: result.user.id,
    deletedByUser: result.user.deletedByUser,
    deletedAt: result.user.deletedAt,
    paymentEmailSent: result.paymentEmailSent || false,
    outstandingDebt: result.outstandingDebt || 0,
    message: result.paymentEmailSent 
      ? 'User deleted. Payment request sent for outstanding balance.'
      : 'User soft-deleted successfully',
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

// PUT /api/users/:id - Update user profile (admin)
router.put('/users/:id', requireAdmin, validateIdParam, asyncHandler(async (req, res) => {
  const { firstName, lastName, email, currentTab } = req.body;
  const result = userService.updateUser(req.userId, { firstName, lastName, email, currentTab });
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  res.json(result.user);
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

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="coffeel-export-${new Date().toISOString().slice(0,10)}.csv"`);
  // UTF-8 BOM for encoding detection (works in most programs, Excel Mac may still need manual import)
  const csvContent = `USERS\n${usersCSV}\n\nPAYMENTS\n${paymentsCSV}`;
  const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);
  const content = Buffer.from(csvContent, 'utf8');
  res.send(Buffer.concat([BOM, content]));
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
// MAINTENANCE ENDPOINTS (Admin only)
// ============================================

// POST /api/admin/cleanup-inactive - Soft-delete users inactive for 1+ year
router.post('/admin/cleanup-inactive', requireAdmin, asyncHandler(async (req, res) => {
  const result = await userService.cleanupInactiveUsers();
  res.json(result);
}));

// GET /api/admin/inactive-users - Preview users that would be cleaned up
router.get('/admin/inactive-users', requireAdmin, asyncHandler(async (req, res) => {
  const days = parseInt(req.query.days, 10) || 365;
  const users = userService.getInactiveUsers(days);
  res.json({ count: users.length, users });
}));

// ============================================
// BACKUP ENDPOINTS (Admin only)
// ============================================

const fs = require('fs');
const pathModule = require('path');
const BACKUP_DIR = process.env.BACKUP_DIR || pathModule.join(__dirname, '../../data/backups');

// Ensure backup directory exists
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// Helper function to generate backup timestamp
const generateBackupTimestamp = () => {
  return new Date().toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);
};

// Helper function to validate backup path (prevents path traversal)
const validateBackupPath = (filename) => {
  if (!filename || !filename.endsWith('.db')) {
    return { valid: false, error: 'Invalid backup filename' };
  }
  const fullPath = pathModule.join(BACKUP_DIR, filename);
  if (!fullPath.startsWith(BACKUP_DIR)) {
    return { valid: false, error: 'Invalid backup path' };
  }
  return { valid: true, path: fullPath };
};

// GET /api/admin/backups - List all backups
router.get('/admin/backups', requireAdmin, asyncHandler(async (req, res) => {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.db'))
    .map(filename => {
      const filePath = pathModule.join(BACKUP_DIR, filename);
      const stats = fs.statSync(filePath);
      return {
        filename,
        size: stats.size,
        sizeMB: (stats.size / 1024 / 1024).toFixed(2),
        createdAt: stats.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(files);
}));

// POST /api/admin/backup - Create a new backup
router.post('/admin/backup', requireAdmin, asyncHandler(async (req, res) => {
  const timestamp = generateBackupTimestamp();
  const backupFilename = `coffeel_${timestamp}.db`;
  const backupPath = pathModule.join(BACKUP_DIR, backupFilename);
  
  const database = db.getDb();
  await database.backup(backupPath);
  
  const stats = fs.statSync(backupPath);
  logger.info('Manual backup created', { filename: backupFilename, size: stats.size });
  
  res.json({
    success: true,
    filename: backupFilename,
    size: stats.size,
    sizeMB: (stats.size / 1024 / 1024).toFixed(2),
  });
}));

// POST /api/admin/restore - Restore from a backup
router.post('/admin/restore', requireAdmin, asyncHandler(async (req, res) => {
  const { filename } = req.body;

  const validation = validateBackupPath(filename);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }
  const backupPath = validation.path;

  if (!fs.existsSync(backupPath)) {
    return res.status(404).json({ error: 'Backup file not found' });
  }

  // Create a safety backup before restore
  const safetyTimestamp = generateBackupTimestamp();
  const safetyBackupFilename = `coffeel_${safetyTimestamp}_pre-restore.db`;
  const safetyBackupPath = pathModule.join(BACKUP_DIR, safetyBackupFilename);
  
  const database = db.getDb();
  await database.backup(safetyBackupPath);
  logger.info('Safety backup created before restore', { filename: safetyBackupFilename });
  
  // Close current connection
  db.close();
  
  // Copy backup over main database
  fs.copyFileSync(backupPath, db.DB_PATH);
  
  // Reopen connection (will happen automatically on next getDb() call)
  logger.info('Database restored from backup', { filename });
  
  res.json({
    success: true,
    message: `Restored from ${filename}`,
    safetyBackup: safetyBackupFilename,
  });
}));

// POST /api/admin/backups/upload - Upload a backup file
router.post('/admin/backups/upload', requireAdmin, asyncHandler(async (req, res) => {
  // Check content type
  if (!req.is('application/octet-stream')) {
    return res.status(400).json({ error: 'Invalid content type. Expected application/octet-stream' });
  }
  
  // Get filename from header
  const originalFilename = req.get('X-Filename');
  if (!originalFilename || !originalFilename.endsWith('.db')) {
    return res.status(400).json({ error: 'Invalid or missing filename. Must end with .db' });
  }
  
  // Sanitize filename and add upload timestamp
  const sanitized = originalFilename.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const timestamp = generateBackupTimestamp();
  const filename = `uploaded_${timestamp}_${sanitized}`;
  const filePath = pathModule.join(BACKUP_DIR, filename);
  
  // Collect the raw body data
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  
  // Basic SQLite validation (check magic header)
  const SQLITE_MAGIC = 'SQLite format 3';
  if (buffer.length < 16 || buffer.slice(0, 15).toString() !== SQLITE_MAGIC) {
    return res.status(400).json({ error: 'Invalid file. Not a valid SQLite database.' });
  }
  
  // Write file
  fs.writeFileSync(filePath, buffer);
  
  const stats = fs.statSync(filePath);
  logger.info('Backup uploaded', { filename, size: stats.size });
  
  res.json({
    success: true,
    filename,
    size: stats.size,
    sizeMB: (stats.size / 1024 / 1024).toFixed(2),
  });
}));

// GET /api/admin/backups/:filename/download - Download a backup
router.get('/admin/backups/:filename/download', requireAdmin, asyncHandler(async (req, res) => {
  const { filename } = req.params;

  const validation = validateBackupPath(filename);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }
  const backupPath = validation.path;

  if (!fs.existsSync(backupPath)) {
    return res.status(404).json({ error: 'Backup file not found' });
  }
  
  const stats = fs.statSync(backupPath);
  
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', stats.size);
  
  // Use callback to ensure response completes properly
  return new Promise((resolve, reject) => {
    res.sendFile(backupPath, (err) => {
      if (err) {
        logger.error('Error sending backup file', { filename, error: err.message });
        reject(err);
      } else {
        resolve();
      }
    });
  });
}));

// DELETE /api/admin/backups/:filename - Delete a backup
router.delete('/admin/backups/:filename', requireAdmin, asyncHandler(async (req, res) => {
  const { filename } = req.params;

  const validation = validateBackupPath(filename);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }
  const backupPath = validation.path;

  if (!fs.existsSync(backupPath)) {
    return res.status(404).json({ error: 'Backup file not found' });
  }
  
  fs.unlinkSync(backupPath);
  logger.info('Backup deleted', { filename });
  
  res.json({ success: true });
}));

// ============================================
// HEALTH CHECK
// ============================================

router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = router;
