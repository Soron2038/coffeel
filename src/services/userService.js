const db = require('../db/database');
const { validateUserInput, sanitizeInput } = require('../utils/validation');
const logger = require('../utils/logger');

// Lazy-loaded to avoid circular dependencies
let emailService = null;
let paymentService = null;

const getEmailService = () => {
  if (!emailService) {
    emailService = require('./emailService');
  }
  return emailService;
};

const getPaymentService = () => {
  if (!paymentService) {
    paymentService = require('./paymentService');
  }
  return paymentService;
};

/**
 * Get all users, optionally including deleted ones
 * @param {boolean} includeDeleted - Whether to include soft-deleted users
 * @returns {Array} Array of user objects
 */
const getAllUsers = (includeDeleted = false) => {
  let sql = `
    SELECT 
      id,
      first_name,
      last_name,
      email,
      current_tab,
      pending_payment,
      account_balance,
      last_payment_request,
      deleted_by_user,
      deleted_at,
      created_at,
      updated_at
    FROM users
  `;

  if (!includeDeleted) {
    sql += ' WHERE deleted_by_user = 0';
  }

  sql += ' ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE';

  const users = db.all(sql);
  return users.map(formatUser);
};

/**
 * Get a single user by ID
 * @param {number} id - User ID
 * @returns {Object|null} User object or null
 */
const getUserById = (id) => {
  const user = db.get('SELECT * FROM users WHERE id = ?', [id]);
  return user ? formatUser(user) : null;
};

/**
 * Get a user by email (case-insensitive)
 * @param {string} email - User email
 * @returns {Object|null} User object or null
 */
const getUserByEmail = (email) => {
  const user = db.get(
    'SELECT * FROM users WHERE LOWER(email) = LOWER(?)',
    [email]
  );
  return user ? formatUser(user) : null;
};

/**
 * Create a new user (or reactivate if soft-deleted)
 * @param {string} firstName - First name
 * @param {string} lastName - Last name
 * @param {string} email - Email address
 * @returns {Object} Result with user or error
 */
const createUser = async (firstName, lastName, email) => {
  // Sanitize inputs
  const cleanFirstName = sanitizeInput(firstName);
  const cleanLastName = sanitizeInput(lastName);
  const cleanEmail = sanitizeInput(email).toLowerCase();

  // Validate inputs
  const validation = validateUserInput(cleanFirstName, cleanLastName, cleanEmail);
  if (!validation.isValid) {
    return { success: false, error: validation.errors.join(', ') };
  }

  // Check for existing user with same email
  const existing = getUserByEmail(cleanEmail);
  
  // If user exists and is soft-deleted, reactivate them
  if (existing && existing.deletedByUser) {
    try {
      // Update name (might have changed) and reactivate
      db.run(
        `UPDATE users SET 
          first_name = ?, 
          last_name = ?, 
          deleted_by_user = 0, 
          deleted_at = NULL 
        WHERE id = ?`,
        [cleanFirstName, cleanLastName, existing.id]
      );

      logAudit(existing.id, 'restore', 1, 0, null, 'user');
      logger.info('User reactivated via registration', { userId: existing.id, email: cleanEmail });

      const reactivatedUser = getUserById(existing.id);
      
      // Send welcome back email (async, don't wait)
      getEmailService().sendWelcomeEmail(reactivatedUser, true).catch(err => {
        logger.warn('Failed to send welcome email on reactivation', { error: err.message, userId: existing.id });
      });

      return { success: true, user: reactivatedUser, reactivated: true };
    } catch (err) {
      logger.error('Failed to reactivate user', { error: err.message, userId: existing.id });
      return { success: false, error: 'Failed to reactivate user' };
    }
  }

  // If user exists and is active, reject
  if (existing) {
    return { success: false, error: 'Email already exists' };
  }

  // Create new user
  try {
    const result = db.run(
      'INSERT INTO users (first_name, last_name, email) VALUES (?, ?, ?)',
      [cleanFirstName, cleanLastName, cleanEmail]
    );

    logAudit(result.lastInsertRowid, 'user_created', null, null, null, 'user');

    const newUser = getUserById(result.lastInsertRowid);
    logger.info('User created', { userId: newUser.id, email: cleanEmail });

    // Send welcome email (async, don't wait)
    getEmailService().sendWelcomeEmail(newUser, false).catch(err => {
      logger.warn('Failed to send welcome email', { error: err.message, userId: newUser.id });
    });

    return { success: true, user: newUser };
  } catch (err) {
    logger.error('Failed to create user', { error: err.message });
    return { success: false, error: 'Failed to create user' };
  }
};

/**
 * Soft delete a user (self-service)
 * If user has outstanding debt, automatically sends payment request email
 * @param {number} id - User ID
 * @param {string} reason - Reason for deletion ('user' or 'inactivity')
 * @returns {Object} Result with user or error
 */
const softDeleteUser = async (id, reason = 'user') => {
  const user = getUserById(id);
  if (!user) {
    return { success: false, error: 'User not found' };
  }

  if (user.deletedByUser) {
    return { success: false, error: 'User already deleted' };
  }

  // Check for outstanding debt (currentTab + pendingPayment)
  const outstandingDebt = user.currentTab + user.pendingPayment;
  let paymentEmailSent = false;

  try {
    // If there's unpaid tab, trigger payment request first
    if (user.currentTab > 0) {
      const paymentResult = await getPaymentService().requestPayment(id);
      if (paymentResult.success) {
        paymentEmailSent = paymentResult.payment?.emailSent || false;
        logger.info('Auto-payment request on soft-delete', { 
          userId: id, 
          amount: user.currentTab,
          emailSent: paymentEmailSent 
        });
      }
    }

    // Now soft-delete the user
    db.run(
      'UPDATE users SET deleted_by_user = 1, deleted_at = CURRENT_TIMESTAMP WHERE id = ?',
      [id]
    );

    logAudit(id, 'soft_delete', 0, 1, null, reason);
    logger.info('User soft-deleted', { userId: id, reason, hadDebt: outstandingDebt > 0 });

    return { 
      success: true, 
      user: getUserById(id),
      paymentEmailSent,
      outstandingDebt,
    };
  } catch (err) {
    logger.error('Failed to soft delete user', { error: err.message, userId: id });
    return { success: false, error: 'Failed to delete user' };
  }
};

/**
 * Restore a soft-deleted user (admin only)
 * @param {number} id - User ID
 * @returns {Object} Result with user or error
 */
const restoreUser = (id) => {
  const user = getUserById(id);
  if (!user) {
    return { success: false, error: 'User not found' };
  }

  if (!user.deletedByUser) {
    return { success: false, error: 'User is not deleted' };
  }

  try {
    db.run(
      'UPDATE users SET deleted_by_user = 0, deleted_at = NULL WHERE id = ?',
      [id]
    );

    logAudit(id, 'restore', 1, 0, null, 'admin');
    logger.info('User restored', { userId: id });

    return { success: true, user: getUserById(id) };
  } catch (err) {
    logger.error('Failed to restore user', { error: err.message, userId: id });
    return { success: false, error: 'Failed to restore user' };
  }
};

/**
 * Permanently delete a user (admin only)
 * WARNING: This is irreversible and should only be used with caution
 * @param {number} id - User ID
 * @returns {Object} Result
 */
const hardDeleteUser = (id) => {
  const user = getUserById(id);
  if (!user) {
    return { success: false, error: 'User not found' };
  }

  try {
    // Delete in transaction to ensure consistency
    db.transaction(() => {
      // Log before deletion
      logAudit(id, 'hard_delete', null, null, null, 'admin');

      // Delete audit logs for this user
      db.run('DELETE FROM audit_log WHERE user_id = ?', [id]);

      // Delete payments for this user
      db.run('DELETE FROM payments WHERE user_id = ?', [id]);

      // Delete the user
      db.run('DELETE FROM users WHERE id = ?', [id]);
    });

    logger.info('User permanently deleted', { userId: id });
    return { success: true, message: 'User permanently deleted' };
  } catch (err) {
    logger.error('Failed to hard delete user', { error: err.message, userId: id });
    return { success: false, error: 'Failed to permanently delete user' };
  }
};

/**
 * Increment tab by coffee price (user clicked +)
 * @param {number} id - User ID
 * @param {number} coffeePrice - Price per coffee in EUR
 * @returns {Object} Result with user or error
 */
const incrementTab = (id, coffeePrice) => {
  const user = getUserById(id);
  if (!user) {
    return { success: false, error: 'User not found' };
  }

  const price = Math.round(coffeePrice * 100) / 100;

  try {
    const oldTab = user.currentTab;
    db.run(
      'UPDATE users SET current_tab = ROUND(current_tab + ?, 2) WHERE id = ?',
      [price, id]
    );

    logAudit(id, 'increment', null, null, price, 'user');

    return { success: true, user: getUserById(id) };
  } catch (err) {
    logger.error('Failed to increment tab', { error: err.message, userId: id });
    return { success: false, error: 'Failed to add to tab' };
  }
};

/**
 * Decrement tab by coffee price (user clicked -, minimum 0)
 * @param {number} id - User ID
 * @param {number} coffeePrice - Price per coffee in EUR
 * @returns {Object} Result with user or error
 */
const decrementTab = (id, coffeePrice) => {
  const user = getUserById(id);
  if (!user) {
    return { success: false, error: 'User not found' };
  }

  if (user.currentTab <= 0) {
    return { success: true, user }; // Already at 0, no change
  }

  const price = Math.round(coffeePrice * 100) / 100;
  const amountToDeduct = Math.min(price, user.currentTab); // Don't go below 0

  try {
    db.run(
      'UPDATE users SET current_tab = ROUND(MAX(0, current_tab - ?), 2) WHERE id = ?',
      [price, id]
    );

    logAudit(id, 'decrement', null, null, -amountToDeduct, 'user');

    return { success: true, user: getUserById(id) };
  } catch (err) {
    logger.error('Failed to decrement tab', { error: err.message, userId: id });
    return { success: false, error: 'Failed to subtract from tab' };
  }
};

/**
 * Set user's current tab directly (admin only)
 * @param {number} id - User ID
 * @param {number} amount - New tab amount in EUR
 * @returns {Object} Result with user or error
 */
const setCurrentTab = (id, amount) => {
  const user = getUserById(id);
  if (!user) {
    return { success: false, error: 'User not found' };
  }

  const newAmount = Math.max(0, Math.round(parseFloat(amount) * 100) / 100);
  if (isNaN(newAmount)) {
    return { success: false, error: 'Invalid amount' };
  }

  try {
    const oldAmount = user.currentTab;
    db.run(
      'UPDATE users SET current_tab = ? WHERE id = ?',
      [newAmount, id]
    );

    logAudit(id, oldAmount < newAmount ? 'increment' : 'decrement', null, null, newAmount - oldAmount, 'admin');
    logger.info('Tab updated by admin', { userId: id, oldAmount, newAmount });

    return { success: true, user: getUserById(id) };
  } catch (err) {
    logger.error('Failed to set tab', { error: err.message, userId: id });
    return { success: false, error: 'Failed to update tab' };
  }
};

/**
 * Adjust user's account balance (admin only)
 * @param {number} id - User ID
 * @param {number} amount - Amount to adjust (positive or negative)
 * @param {string} notes - Admin notes
 * @returns {Object} Result with user or error
 */
const adjustBalance = (id, amount, notes = '') => {
  const user = getUserById(id);
  if (!user) {
    return { success: false, error: 'User not found' };
  }

  const adjustAmount = parseFloat(amount);
  if (isNaN(adjustAmount)) {
    return { success: false, error: 'Invalid amount' };
  }

  try {
    const oldBalance = user.accountBalance;
    const newBalance = Math.round((oldBalance + adjustAmount) * 100) / 100;

    db.run(
      'UPDATE users SET account_balance = ? WHERE id = ?',
      [newBalance, id]
    );

    logAudit(id, 'balance_adjustment', null, null, adjustAmount, 'admin');
    logger.info('Balance adjusted by admin', { 
      userId: id, 
      oldBalance, 
      newBalance, 
      adjustment: adjustAmount,
      notes 
    });

    return { success: true, user: getUserById(id) };
  } catch (err) {
    logger.error('Failed to adjust balance', { error: err.message, userId: id });
    return { success: false, error: 'Failed to adjust balance' };
  }
};

/**
 * Get users inactive for more than specified days
 * Inactivity = no updated_at change (no coffee increment, payment, etc.)
 * @param {number} days - Number of days of inactivity
 * @returns {Array} Array of inactive users
 */
const getInactiveUsers = (days = 365) => {
  const users = db.all(
    `SELECT * FROM users 
     WHERE deleted_by_user = 0 
     AND updated_at < datetime('now', '-' || ? || ' days')`,
    [days]
  );
  return users.map(formatUser);
};

/**
 * Soft-delete all users inactive for more than 1 year
 * Sends payment request email if they have outstanding debt
 * @returns {Object} Result with count of deleted users
 */
const cleanupInactiveUsers = async () => {
  const inactiveUsers = getInactiveUsers(365);
  
  if (inactiveUsers.length === 0) {
    logger.info('No inactive users to cleanup');
    return { success: true, deletedCount: 0, users: [] };
  }

  const results = [];
  
  for (const user of inactiveUsers) {
    try {
      const result = await softDeleteUser(user.id, 'inactivity');
      results.push({
        userId: user.id,
        email: user.email,
        success: result.success,
        paymentEmailSent: result.paymentEmailSent || false,
        outstandingDebt: result.outstandingDebt || 0,
      });
    } catch (err) {
      logger.error('Failed to cleanup inactive user', { userId: user.id, error: err.message });
      results.push({
        userId: user.id,
        email: user.email,
        success: false,
        error: err.message,
      });
    }
  }

  const deletedCount = results.filter(r => r.success).length;
  logger.info('Inactive users cleanup completed', { 
    total: inactiveUsers.length, 
    deleted: deletedCount 
  });

  return { 
    success: true, 
    deletedCount, 
    total: inactiveUsers.length,
    users: results 
  };
};

// Helper function to format user object from database row
const formatUser = (row) => ({
  id: row.id,
  firstName: row.first_name,
  lastName: row.last_name,
  email: row.email,
  currentTab: row.current_tab,
  pendingPayment: row.pending_payment,
  accountBalance: row.account_balance,
  lastPaymentRequest: row.last_payment_request,
  deletedByUser: Boolean(row.deleted_by_user),
  deletedAt: row.deleted_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// Helper function to log audit entries
const logAudit = (userId, action, oldValue, newValue, amount, performedBy) => {
  try {
    db.run(
      `INSERT INTO audit_log (user_id, action, old_value, new_value, amount, performed_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, action, oldValue, newValue, amount, performedBy]
    );
  } catch (err) {
    logger.error('Failed to log audit', { error: err.message, userId, action });
  }
};

module.exports = {
  getAllUsers,
  getUserById,
  getUserByEmail,
  createUser,
  softDeleteUser,
  restoreUser,
  hardDeleteUser,
  incrementTab,
  decrementTab,
  setCurrentTab,
  adjustBalance,
  getInactiveUsers,
  cleanupInactiveUsers,
};
