const bcrypt = require('bcryptjs');
const db = require('../db/database');
const logger = require('../utils/logger');

const SALT_ROUNDS = 10;

/**
 * Create a new admin user
 * @param {string} username - Unique username
 * @param {string} password - Plain text password
 * @returns {Object} Result with success flag and user/error
 */
const createAdminUser = (username, password) => {
  if (!username || username.length < 3) {
    return { success: false, error: 'Username must be at least 3 characters' };
  }

  if (!password || password.length < 4) {
    return { success: false, error: 'Password must be at least 4 characters' };
  }

  // Check if username already exists
  const existing = db.get('SELECT id FROM admin_users WHERE username = ?', [username.toLowerCase()]);
  if (existing) {
    return { success: false, error: 'Username already exists' };
  }

  try {
    const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);
    
    const result = db.run(
      'INSERT INTO admin_users (username, password_hash) VALUES (?, ?)',
      [username.toLowerCase(), passwordHash]
    );

    logger.info('Admin user created', { username: username.toLowerCase() });

    return {
      success: true,
      user: {
        id: result.lastInsertRowid,
        username: username.toLowerCase(),
      },
    };
  } catch (err) {
    logger.error('Failed to create admin user', { error: err.message });
    return { success: false, error: 'Failed to create admin user' };
  }
};

/**
 * Verify admin credentials
 * @param {string} username - Username
 * @param {string} password - Plain text password
 * @returns {Object} Result with success flag and user/error
 */
const verifyCredentials = (username, password) => {
  if (!username || !password) {
    return { success: false, error: 'Username and password required' };
  }

  const user = db.get(
    'SELECT id, username, password_hash FROM admin_users WHERE username = ?',
    [username.toLowerCase()]
  );

  if (!user) {
    return { success: false, error: 'Invalid credentials' };
  }

  const passwordMatch = bcrypt.compareSync(password, user.password_hash);
  if (!passwordMatch) {
    return { success: false, error: 'Invalid credentials' };
  }

  // Update last login
  db.run('UPDATE admin_users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);

  logger.info('Admin login successful', { username: user.username });

  return {
    success: true,
    user: {
      id: user.id,
      username: user.username,
    },
  };
};

/**
 * Get all admin users (without password hashes)
 * @returns {Array} List of admin users
 */
const getAllAdminUsers = () => {
  const rows = db.all('SELECT id, username, created_at, last_login FROM admin_users ORDER BY username');
  return rows.map(row => ({
    id: row.id,
    username: row.username,
    createdAt: row.created_at,
    lastLogin: row.last_login,
  }));
};

/**
 * Change admin user password
 * @param {number} userId - Admin user ID
 * @param {string} newPassword - New plain text password
 * @returns {Object} Result with success flag
 */
const changePassword = (userId, newPassword) => {
  if (!newPassword || newPassword.length < 4) {
    return { success: false, error: 'Password must be at least 4 characters' };
  }

  const user = db.get('SELECT id FROM admin_users WHERE id = ?', [userId]);
  if (!user) {
    return { success: false, error: 'Admin user not found' };
  }

  try {
    const passwordHash = bcrypt.hashSync(newPassword, SALT_ROUNDS);
    db.run('UPDATE admin_users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);

    logger.info('Admin password changed', { userId });

    return { success: true };
  } catch (err) {
    logger.error('Failed to change admin password', { error: err.message });
    return { success: false, error: 'Failed to change password' };
  }
};

/**
 * Delete an admin user
 * @param {number} userId - Admin user ID
 * @returns {Object} Result with success flag
 */
const deleteAdminUser = (userId) => {
  // Prevent deleting last admin
  const count = db.get('SELECT COUNT(*) as count FROM admin_users');
  if (count.count <= 1) {
    return { success: false, error: 'Cannot delete the last admin user' };
  }

  const user = db.get('SELECT id, username FROM admin_users WHERE id = ?', [userId]);
  if (!user) {
    return { success: false, error: 'Admin user not found' };
  }

  try {
    db.run('DELETE FROM admin_users WHERE id = ?', [userId]);
    logger.info('Admin user deleted', { userId, username: user.username });
    return { success: true };
  } catch (err) {
    logger.error('Failed to delete admin user', { error: err.message });
    return { success: false, error: 'Failed to delete admin user' };
  }
};

/**
 * Check if any admin users exist
 * @returns {boolean} True if at least one admin exists
 */
const hasAdminUsers = () => {
  const count = db.get('SELECT COUNT(*) as count FROM admin_users');
  return count.count > 0;
};

/**
 * Create default admin user if none exist
 * @param {string} username - Default username
 * @param {string} password - Default password
 */
const ensureDefaultAdmin = (username = 'admin', password = 'admin') => {
  if (!hasAdminUsers()) {
    const result = createAdminUser(username, password);
    if (result.success) {
      logger.info('Default admin user created', { username });
    }
    return result;
  }
  return { success: true, message: 'Admin users already exist' };
};

module.exports = {
  createAdminUser,
  verifyCredentials,
  getAllAdminUsers,
  changePassword,
  deleteAdminUser,
  hasAdminUsers,
  ensureDefaultAdmin,
};
