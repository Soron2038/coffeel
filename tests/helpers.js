/**
 * Test Helpers
 * Utilities for test setup and teardown
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let testDb = null;

/**
 * Create a fresh in-memory database for testing
 * @returns {Database} SQLite database instance
 */
function createTestDatabase() {
  // Close existing connection if any
  if (testDb) {
    try {
      testDb.close();
    } catch (e) {
      // Ignore close errors
    }
  }

  // Create new in-memory database
  testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = ON');

  // Read and execute schema
  const schemaPath = path.join(__dirname, '..', 'src', 'db', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  testDb.exec(schema);

  // Read and execute defaults
  const defaultsPath = path.join(__dirname, '..', 'src', 'db', 'defaults.sql');
  const defaults = fs.readFileSync(defaultsPath, 'utf8');
  testDb.exec(defaults);

  return testDb;
}

/**
 * Get the current test database instance
 * @returns {Database} SQLite database instance
 */
function getTestDatabase() {
  if (!testDb) {
    return createTestDatabase();
  }
  return testDb;
}

/**
 * Close the test database
 */
function closeTestDatabase() {
  if (testDb) {
    try {
      testDb.close();
      testDb = null;
    } catch (e) {
      // Ignore close errors
    }
  }
}

/**
 * Create a test user
 * @param {Object} overrides - Override default values
 * @returns {Object} Created user
 */
function createTestUser(db, overrides = {}) {
  const defaults = {
    firstName: 'Test',
    lastName: 'User',
    email: `test${Date.now()}@example.com`,
    currentTab: 0,
    pendingPayment: 0,
    accountBalance: 0,
  };

  const user = { ...defaults, ...overrides };

  const result = db.prepare(`
    INSERT INTO users (first_name, last_name, email, current_tab, pending_payment, account_balance)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    user.firstName,
    user.lastName,
    user.email,
    user.currentTab,
    user.pendingPayment,
    user.accountBalance
  );

  return {
    id: result.lastInsertRowid,
    ...user,
  };
}

/**
 * Get a user by ID from test database
 * @param {Database} db - Database instance
 * @param {number} userId - User ID
 * @returns {Object|null} User or null
 */
function getUserById(db, userId) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

/**
 * Get coffee price from settings
 * @param {Database} db - Database instance
 * @returns {number} Coffee price
 */
function getCoffeePrice(db) {
  const setting = db.prepare("SELECT value FROM settings WHERE key = 'coffee_price'").get();
  return setting ? parseFloat(setting.value) : 0.5;
}

module.exports = {
  createTestDatabase,
  getTestDatabase,
  closeTestDatabase,
  createTestUser,
  getUserById,
  getCoffeePrice,
};
