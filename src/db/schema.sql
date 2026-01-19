-- CofFeEL Database Schema
-- SQLite3 schema for coffee tracking system

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  coffee_count INTEGER DEFAULT 0,
  pending_payment REAL DEFAULT 0,      -- Amount after Pay-Request (not yet confirmed)
  account_balance REAL DEFAULT 0,      -- Credit (+) / Debt (-) balance
  last_payment_request DATETIME,       -- Timestamp of last Pay click
  deleted_by_user BOOLEAN DEFAULT 0,   -- Soft delete flag
  deleted_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for users table
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_last_name ON users(last_name);
CREATE INDEX IF NOT EXISTS idx_users_deleted ON users(deleted_by_user);
CREATE INDEX IF NOT EXISTS idx_users_pending ON users(pending_payment);

-- Payments table
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('request', 'received')),
  coffee_count INTEGER,                -- Number of coffees at payment request time
  confirmed_by_admin BOOLEAN DEFAULT 0,
  admin_notes TEXT,                    -- Optional: Admin notes for the payment
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Indexes for payments table
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_type ON payments(type);
CREATE INDEX IF NOT EXISTS idx_payments_confirmed ON payments(confirmed_by_admin);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at);

-- Settings table (key-value store)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Audit log table (optional but recommended)
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL CHECK(action IN (
    'increment', 
    'decrement', 
    'payment_request', 
    'payment_received', 
    'soft_delete', 
    'restore', 
    'hard_delete',
    'user_created',
    'balance_adjustment'
  )),
  old_value INTEGER,
  new_value INTEGER,
  amount REAL,                         -- For payment actions
  performed_by TEXT DEFAULT 'user',   -- 'user' or 'admin'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Indexes for audit_log table
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

-- Trigger to update updated_at timestamp on users table
CREATE TRIGGER IF NOT EXISTS update_users_timestamp 
AFTER UPDATE ON users
FOR EACH ROW
BEGIN
  UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- Trigger to update updated_at timestamp on settings table
CREATE TRIGGER IF NOT EXISTS update_settings_timestamp 
AFTER UPDATE ON settings
FOR EACH ROW
BEGIN
  UPDATE settings SET updated_at = CURRENT_TIMESTAMP WHERE key = NEW.key;
END;

-- Admin users table (separate from coffee users)
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login DATETIME
);

CREATE INDEX IF NOT EXISTS idx_admin_users_username ON admin_users(username);
