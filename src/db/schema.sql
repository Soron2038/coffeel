-- CofFeEL Database Schema
-- SQLite3 schema for coffee tracking system

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  current_tab REAL DEFAULT 0,          -- Current unpaid amount in EUR (before Pay-Request)
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
    'balance_adjustment',
    'name_change',
    'email_change',
    'broadcast_email'
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

-- Broadcasts table: tracks bulk announcement emails sent by admins
CREATE TABLE IF NOT EXISTS broadcasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('sending', 'completed', 'interrupted', 'failed')),
  total_count INTEGER NOT NULL,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  failed_recipients TEXT,                                  -- JSON: [{userId, email, error}]
  origin_broadcast_id INTEGER REFERENCES broadcasts(id),   -- NULL on original; set on resend
  sent_by_admin_id INTEGER NOT NULL REFERENCES admin_users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME,
  finished_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_broadcasts_status ON broadcasts(status);
CREATE INDEX IF NOT EXISTS idx_broadcasts_created ON broadcasts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_broadcasts_origin ON broadcasts(origin_broadcast_id);

-- Emails table: per-message tracking for every outgoing mail.
-- tracking_id is sent as the X-Coffee-Email-Id header so DSN bounces
-- can be matched back to the originating record.
CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tracking_id TEXT NOT NULL UNIQUE,
  message_id TEXT,
  user_id INTEGER,
  recipient_email TEXT NOT NULL,
  email_type TEXT NOT NULL CHECK(email_type IN (
    'payment_request',
    'welcome',
    'broadcast',
    'test'
  )),
  broadcast_id INTEGER,
  subject TEXT,
  sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN (
    'sent',
    'rejected_smtp',
    'bounced_hard',
    'bounced_soft',
    'send_failed'
  )),
  smtp_response TEXT,
  smtp_accepted TEXT,                                      -- JSON array
  smtp_rejected TEXT,                                      -- JSON array
  bounce_reason TEXT,                                      -- DSN Diagnostic-Code text
  bounce_code TEXT,                                        -- DSN status code e.g. '5.1.1'
  bounced_at DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (broadcast_id) REFERENCES broadcasts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_emails_tracking_id ON emails(tracking_id);
CREATE INDEX IF NOT EXISTS idx_emails_user_id ON emails(user_id);
CREATE INDEX IF NOT EXISTS idx_emails_broadcast_id ON emails(broadcast_id);
CREATE INDEX IF NOT EXISTS idx_emails_status ON emails(status);

-- Sessions table: SQLite-backed express-session store.
-- expires_at is a unix timestamp (ms); the store prunes rows past expiry.
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  data TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
