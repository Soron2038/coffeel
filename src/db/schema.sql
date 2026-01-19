-- CofFeEL Database Schema
-- SQLite3 Database for coffee tracking system

-- Enable WAL mode for better concurrency and corruption resistance
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Users table: stores coffee drinkers
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL CHECK(length(first_name) >= 2),
  last_name TEXT NOT NULL CHECK(length(last_name) >= 2),
  email TEXT UNIQUE NOT NULL CHECK(email LIKE '%_@_%._%'),
  coffee_count INTEGER DEFAULT 0 CHECK(coffee_count >= 0),
  pending_payment REAL DEFAULT 0 CHECK(pending_payment >= 0),
  account_balance REAL DEFAULT 0,
  last_payment_request DATETIME DEFAULT NULL,
  deleted_by_user BOOLEAN DEFAULT 0,
  deleted_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_last_name ON users(last_name);
CREATE INDEX IF NOT EXISTS idx_users_deleted ON users(deleted_by_user);
CREATE INDEX IF NOT EXISTS idx_users_pending ON users(pending_payment);

-- Trigger to update updated_at on users
CREATE TRIGGER IF NOT EXISTS users_updated_at
AFTER UPDATE ON users
FOR EACH ROW
BEGIN
  UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- Payments table: tracks payment requests and confirmations
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount REAL NOT NULL CHECK(amount > 0),
  type TEXT NOT NULL CHECK(type IN ('request', 'received')),
  coffee_count INTEGER DEFAULT NULL,
  confirmed_by_admin BOOLEAN DEFAULT 0,
  admin_notes TEXT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_type ON payments(type);
CREATE INDEX IF NOT EXISTS idx_payments_confirmed ON payments(confirmed_by_admin);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at);

-- Settings table: key-value store for runtime configuration
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Trigger to update updated_at on settings
CREATE TRIGGER IF NOT EXISTS settings_updated_at
AFTER UPDATE ON settings
FOR EACH ROW
BEGIN
  UPDATE settings SET updated_at = CURRENT_TIMESTAMP WHERE key = NEW.key;
END;

-- Audit log table: tracks all user and admin actions
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER DEFAULT NULL,
  action TEXT NOT NULL CHECK(action IN (
    'increment', 'decrement', 'payment_request', 'payment_received',
    'soft_delete', 'restore', 'hard_delete', 'setting_change'
  )),
  old_value INTEGER DEFAULT NULL,
  new_value INTEGER DEFAULT NULL,
  amount REAL DEFAULT NULL,
  performed_by TEXT DEFAULT 'user' CHECK(performed_by IN ('user', 'admin')),
  ip_address TEXT DEFAULT NULL,
  user_agent TEXT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

-- Default settings
INSERT OR IGNORE INTO settings (key, value) VALUES 
  ('coffee_price', '0.50'),
  ('admin_email', 'admin@example.com'),
  ('bank_iban', 'DE89370400440532013000'),
  ('bank_bic', 'COBADEFFXXX'),
  ('bank_owner', 'CFEL Coffee Fund'),
  ('smtp_host', 'smtp.example.com'),
  ('smtp_port', '587'),
  ('smtp_user', 'coffee@example.com'),
  ('smtp_pass', ''),
  ('smtp_from', 'CofFeEL System <coffee@example.com>'),
  ('admin_user', 'admin'),
  ('admin_pass_hash', '');
