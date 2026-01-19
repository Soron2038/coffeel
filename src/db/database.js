const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

// Database file path
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/coffeel.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Create database connection
let db = null;

/**
 * Get database connection (singleton pattern)
 * Creates connection on first call, reuses on subsequent calls
 */
const getDb = () => {
  if (!db) {
    db = new Database(DB_PATH);
    
    // Enable WAL mode for better performance and corruption resistance
    db.pragma('journal_mode = WAL');
    
    // Enable foreign keys
    db.pragma('foreign_keys = ON');
    
    logger.info('Database connection established', { path: DB_PATH });
  }
  return db;
};

/**
 * Initialize database schema
 * Creates all tables if they don't exist
 */
const initializeSchema = () => {
  const database = getDb();
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  
  database.exec(schema);
  logger.info('Database schema initialized');
};

/**
 * Load default settings into database
 */
const loadDefaults = () => {
  const database = getDb();
  const defaultsPath = path.join(__dirname, 'defaults.sql');
  const defaults = fs.readFileSync(defaultsPath, 'utf8');
  
  database.exec(defaults);
  logger.info('Default settings loaded');
};

/**
 * Execute a function within a transaction
 * Automatically commits on success, rolls back on error
 * @param {Function} fn - Function to execute within transaction
 * @returns {*} Result of the function
 */
const transaction = (fn) => {
  const database = getDb();
  return database.transaction(fn)();
};

/**
 * Get a prepared statement
 * @param {string} sql - SQL query
 * @returns {Statement} Prepared statement
 */
const prepare = (sql) => {
  return getDb().prepare(sql);
};

/**
 * Run a query and return changes info
 * @param {string} sql - SQL query
 * @param {Array} params - Query parameters
 * @returns {Object} { changes, lastInsertRowid }
 */
const run = (sql, params = []) => {
  const stmt = getDb().prepare(sql);
  return stmt.run(...params);
};

/**
 * Get a single row
 * @param {string} sql - SQL query
 * @param {Array} params - Query parameters
 * @returns {Object|undefined} Row or undefined
 */
const get = (sql, params = []) => {
  const stmt = getDb().prepare(sql);
  return stmt.get(...params);
};

/**
 * Get all rows
 * @param {string} sql - SQL query
 * @param {Array} params - Query parameters
 * @returns {Array} Array of rows
 */
const all = (sql, params = []) => {
  const stmt = getDb().prepare(sql);
  return stmt.all(...params);
};

/**
 * Close database connection
 */
const close = () => {
  if (db) {
    db.close();
    db = null;
    logger.info('Database connection closed');
  }
};

/**
 * Full initialization: schema + defaults
 */
const initialize = () => {
  initializeSchema();
  loadDefaults();
};

module.exports = {
  getDb,
  initialize,
  initializeSchema,
  loadDefaults,
  transaction,
  prepare,
  run,
  get,
  all,
  close,
  DB_PATH,
};
