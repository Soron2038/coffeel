const db = require('../db/database');
const { validateUserInput, sanitizeInput } = require('../utils/validation');
const logger = require('../utils/logger');

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
      coffee_count,
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
 * Create a new user
 * @param {string} firstName - First name
 * @param {string} lastName - Last name
 * @param {string} email - Email address
 * @returns {Object} Result with user or error
 */
const createUser = (firstName, lastName, email) => {
  // Sanitize inputs
  const cleanFirstName = sanitizeInput(firstName);
  const cleanLastName = sanitizeInput(lastName);
  const cleanEmail = sanitizeInput(email).toLowerCase();

  // Validate inputs
  const validation = validateUserInput(cleanFirstName, cleanLastName, cleanEmail);
  if (!validation.isValid) {
    return { success: false, error: validation.errors.join(', ') };
  }

  // Check for duplicate email (case-insensitive)
  const existing = getUserByEmail(cleanEmail);
  if (existing) {
    return { success: false, error: 'Email already exists' };
  }

  try {
    const result = db.run(
      'INSERT INTO users (first_name, last_name, email) VALUES (?, ?, ?)',
      [cleanFirstName, cleanLastName, cleanEmail]
    );

    // Log to audit
    logAudit(result.lastInsertRowid, 'user_created', null, null, null, 'user');

    const newUser = getUserById(result.lastInsertRowid);
    logger.info('User created', { userId: newUser.id, email: cleanEmail });

    return { success: true, user: newUser };
  } catch (err) {
    logger.error('Failed to create user', { error: err.message });
    return { success: false, error: 'Failed to create user' };
  }
};

/**
 * Soft delete a user (self-service)
 * @param {number} id - User ID
 * @returns {Object} Result with user or error
 */
const softDeleteUser = (id) => {
  const user = getUserById(id);
  if (!user) {
    return { success: false, error: 'User not found' };
  }

  if (user.deletedByUser) {
    return { success: false, error: 'User already deleted' };
  }

  try {
    db.run(
      'UPDATE users SET deleted_by_user = 1, deleted_at = CURRENT_TIMESTAMP WHERE id = ?',
      [id]
    );

    logAudit(id, 'soft_delete', 0, 1, null, 'user');
    logger.info('User soft-deleted', { userId: id });

    return { success: true, user: getUserById(id) };
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
 * Increment coffee count for a user
 * @param {number} id - User ID
 * @returns {Object} Result with user or error
 */
const incrementCoffee = (id) => {
  const user = getUserById(id);
  if (!user) {
    return { success: false, error: 'User not found' };
  }

  try {
    const oldCount = user.coffeeCount;
    db.run(
      'UPDATE users SET coffee_count = coffee_count + 1 WHERE id = ?',
      [id]
    );

    logAudit(id, 'increment', oldCount, oldCount + 1, null, 'user');

    return { success: true, user: getUserById(id) };
  } catch (err) {
    logger.error('Failed to increment coffee', { error: err.message, userId: id });
    return { success: false, error: 'Failed to increment coffee count' };
  }
};

/**
 * Decrement coffee count for a user (minimum 0)
 * @param {number} id - User ID
 * @returns {Object} Result with user or error
 */
const decrementCoffee = (id) => {
  const user = getUserById(id);
  if (!user) {
    return { success: false, error: 'User not found' };
  }

  if (user.coffeeCount <= 0) {
    return { success: true, user }; // Already at 0, no change
  }

  try {
    const oldCount = user.coffeeCount;
    db.run(
      'UPDATE users SET coffee_count = coffee_count - 1 WHERE id = ? AND coffee_count > 0',
      [id]
    );

    logAudit(id, 'decrement', oldCount, oldCount - 1, null, 'user');

    return { success: true, user: getUserById(id) };
  } catch (err) {
    logger.error('Failed to decrement coffee', { error: err.message, userId: id });
    return { success: false, error: 'Failed to decrement coffee count' };
  }
};

/**
 * Update user's coffee count directly (admin only)
 * @param {number} id - User ID
 * @param {number} count - New coffee count
 * @returns {Object} Result with user or error
 */
const setCoffeeCount = (id, count) => {
  const user = getUserById(id);
  if (!user) {
    return { success: false, error: 'User not found' };
  }

  const newCount = Math.max(0, parseInt(count, 10));
  if (isNaN(newCount)) {
    return { success: false, error: 'Invalid coffee count' };
  }

  try {
    const oldCount = user.coffeeCount;
    db.run(
      'UPDATE users SET coffee_count = ? WHERE id = ?',
      [newCount, id]
    );

    logAudit(id, oldCount < newCount ? 'increment' : 'decrement', oldCount, newCount, null, 'admin');
    logger.info('Coffee count updated by admin', { userId: id, oldCount, newCount });

    return { success: true, user: getUserById(id) };
  } catch (err) {
    logger.error('Failed to set coffee count', { error: err.message, userId: id });
    return { success: false, error: 'Failed to update coffee count' };
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

// Helper function to format user object from database row
const formatUser = (row) => ({
  id: row.id,
  firstName: row.first_name,
  lastName: row.last_name,
  email: row.email,
  coffeeCount: row.coffee_count,
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
  incrementCoffee,
  decrementCoffee,
  setCoffeeCount,
  adjustBalance,
};
