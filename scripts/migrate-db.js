#!/usr/bin/env node
/**
 * Database Migration Script
 * Applies schema changes to an existing database without data loss.
 *
 * Usage: npm run db:migrate
 */

require('dotenv').config();
const db = require('../src/db/database');

console.log('=== CofFeEL Database Migration ===\n');

const rawDb = db.getDb();

// ============================================================
// Migration 1: Add 'name_change' and 'email_change' to
//              audit_log action CHECK constraint
// ============================================================
// SQLite does not support ALTER TABLE to modify CHECK constraints.
// The standard workaround is: create new table → copy → drop → rename.
// ============================================================

(function migration1() {
  const desc = "Add 'name_change'/'email_change' to audit_log action constraint";

  // Idempotency check: inspect the stored CREATE statement
  const tableInfo = rawDb
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='audit_log'")
    .get();

  if (!tableInfo) {
    console.log(`⏭  [M1] audit_log table not found — run 'npm run db:init' first.`);
    return;
  }

  if (tableInfo.sql.includes("'name_change'")) {
    console.log(`✅ [M1] Already applied: ${desc}`);
    return;
  }

  console.log(`⏳ [M1] Applying: ${desc}`);

  // PRAGMA foreign_keys must be set OUTSIDE any transaction
  rawDb.pragma('foreign_keys = OFF');

  rawDb.exec(`
    BEGIN;

    CREATE TABLE audit_log_new (
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
        'email_change'
      )),
      old_value INTEGER,
      new_value INTEGER,
      amount REAL,
      performed_by TEXT DEFAULT 'user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    INSERT INTO audit_log_new SELECT * FROM audit_log;

    DROP TABLE audit_log;

    ALTER TABLE audit_log_new RENAME TO audit_log;

    CREATE INDEX IF NOT EXISTS idx_audit_user    ON audit_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_action  ON audit_log(action);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

    COMMIT;
  `);

  rawDb.pragma('foreign_keys = ON');

  console.log(`✅ [M1] Done: ${desc}`);
})();

db.close();
console.log('\n✅ Migration complete.');
