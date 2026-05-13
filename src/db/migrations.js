/**
 * Schema migrations.
 *
 * Each migration is idempotent: it inspects the current schema before doing
 * anything destructive, and skips work that is already applied. This lets the
 * function run safely on every server boot and after every backup restore.
 *
 * SQLite cannot ALTER a CHECK constraint, so the standard pattern is:
 *   create new table → INSERT-SELECT data → DROP old → RENAME → re-create indexes,
 * inside a single BEGIN/COMMIT transaction. Atomicity is guaranteed: a crash in
 * the middle rolls everything back, the original table stays intact.
 *
 * @param {import('better-sqlite3').Database} rawDb - raw sqlite handle
 * @param {Object} [opts]
 * @param {Object} [opts.logger] - object with info()/warn() methods (default: console)
 * @returns {{ applied: string[], skipped: string[] }}
 */
const runMigrations = (rawDb, opts = {}) => {
  const log = opts.logger || console;
  const applied = [];
  const skipped = [];

  // ====================================================================
  // M1: Add 'name_change' and 'email_change' to audit_log action constraint
  // ====================================================================
  (function migration1() {
    const id = 'M1';
    const desc = 'Add \'name_change\'/\'email_change\' to audit_log action constraint';

    const tableInfo = rawDb
      .prepare('SELECT sql FROM sqlite_master WHERE type=\'table\' AND name=\'audit_log\'')
      .get();

    if (!tableInfo) {
      // audit_log doesn't exist yet — schema.sql hasn't run. Skip; this isn't
      // a "real" boot, probably a fresh db init in flight.
      skipped.push(`${id}: audit_log not present yet`);
      return;
    }

    if (tableInfo.sql.includes('\'name_change\'')) {
      skipped.push(`${id}: already applied`);
      return;
    }

    log.info(`Applying migration ${id}: ${desc}`);

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

    applied.push(`${id}: ${desc}`);
  })();

  // ====================================================================
  // M2a: Add 'broadcast_email' to audit_log action constraint
  // ====================================================================
  (function migration2a() {
    const id = 'M2a';
    const desc = 'Add \'broadcast_email\' to audit_log action constraint';

    const tableInfo = rawDb
      .prepare('SELECT sql FROM sqlite_master WHERE type=\'table\' AND name=\'audit_log\'')
      .get();

    if (!tableInfo) {
      skipped.push(`${id}: audit_log not present yet`);
      return;
    }

    if (tableInfo.sql.includes('\'broadcast_email\'')) {
      skipped.push(`${id}: already applied`);
      return;
    }

    log.info(`Applying migration ${id}: ${desc}`);

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
          'email_change',
          'broadcast_email'
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

    applied.push(`${id}: ${desc}`);
  })();

  // ====================================================================
  // M2b: Create broadcasts table (idempotent via IF NOT EXISTS)
  // ====================================================================
  (function migration2b() {
    const id = 'M2b';
    const desc = 'Create broadcasts table';

    const exists = rawDb
      .prepare('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'broadcasts\'')
      .get();

    if (exists) {
      skipped.push(`${id}: already applied`);
      return;
    }

    log.info(`Applying migration ${id}: ${desc}`);

    rawDb.exec(`
      CREATE TABLE broadcasts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('sending', 'completed', 'interrupted', 'failed')),
        total_count INTEGER NOT NULL,
        sent_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        failed_recipients TEXT,
        origin_broadcast_id INTEGER REFERENCES broadcasts(id),
        sent_by_admin_id INTEGER NOT NULL REFERENCES admin_users(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        started_at DATETIME,
        finished_at DATETIME
      );

      CREATE INDEX IF NOT EXISTS idx_broadcasts_status ON broadcasts(status);
      CREATE INDEX IF NOT EXISTS idx_broadcasts_created ON broadcasts(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_broadcasts_origin ON broadcasts(origin_broadcast_id);
    `);

    applied.push(`${id}: ${desc}`);
  })();

  // ====================================================================
  // M3: Create sessions table (for SQLite-backed express-session store)
  // ====================================================================
  (function migration3() {
    const id = 'M3';
    const desc = 'Create sessions table';

    const exists = rawDb
      .prepare('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'sessions\'')
      .get();

    if (exists) {
      skipped.push(`${id}: already applied`);
      return;
    }

    log.info(`Applying migration ${id}: ${desc}`);

    rawDb.exec(`
      CREATE TABLE sessions (
        sid TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL,
        data TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    `);

    applied.push(`${id}: ${desc}`);
  })();

  // ====================================================================
  // M4: Create emails table (per-message tracking for bounce detection)
  // ====================================================================
  (function migration4() {
    const id = 'M4';
    const desc = 'Create emails table';

    const exists = rawDb
      .prepare('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'emails\'')
      .get();

    if (exists) {
      skipped.push(`${id}: already applied`);
      return;
    }

    log.info(`Applying migration ${id}: ${desc}`);

    rawDb.exec(`
      CREATE TABLE emails (
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
        smtp_accepted TEXT,
        smtp_rejected TEXT,
        bounce_reason TEXT,
        bounce_code TEXT,
        bounced_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (broadcast_id) REFERENCES broadcasts(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_emails_tracking_id ON emails(tracking_id);
      CREATE INDEX IF NOT EXISTS idx_emails_user_id ON emails(user_id);
      CREATE INDEX IF NOT EXISTS idx_emails_broadcast_id ON emails(broadcast_id);
      CREATE INDEX IF NOT EXISTS idx_emails_status ON emails(status);
    `);

    applied.push(`${id}: ${desc}`);
  })();

  return { applied, skipped };
};

module.exports = { runMigrations };
