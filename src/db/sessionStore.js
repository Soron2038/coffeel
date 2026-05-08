/**
 * SQLite-backed express-session Store.
 *
 * Stores sessions in the same database as the rest of the app (no extra
 * dependency). Survives restarts so admins stay logged in across deploys
 * and PM2 reloads.
 *
 * Schema: see migration M3 in src/db/migrations.js — table `sessions`
 * with columns (sid, expires_at, data).
 *
 * @see https://github.com/expressjs/session#session-store-implementation
 */

const session = require('express-session');

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h, matches the cookie maxAge in server.js
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // hourly sweep of expired rows

class SQLiteSessionStore extends session.Store {
  /**
   * @param {import('better-sqlite3').Database} db - raw better-sqlite3 handle
   * @param {Object} [opts]
   * @param {number} [opts.ttlMs] - fallback TTL when a session has no cookie expiry
   * @param {number} [opts.cleanupIntervalMs] - how often to sweep expired rows
   */
  constructor(db, opts = {}) {
    super();
    this.db = db;
    this.ttlMs = opts.ttlMs || DEFAULT_TTL_MS;

    this.stmts = {
      get: db.prepare('SELECT data, expires_at FROM sessions WHERE sid = ?'),
      set: db.prepare(
        'INSERT INTO sessions (sid, expires_at, data) VALUES (?, ?, ?) ' +
          'ON CONFLICT(sid) DO UPDATE SET expires_at = excluded.expires_at, data = excluded.data'
      ),
      destroy: db.prepare('DELETE FROM sessions WHERE sid = ?'),
      touch: db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?'),
      cleanup: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
    };

    const interval = opts.cleanupIntervalMs || CLEANUP_INTERVAL_MS;
    if (interval > 0) {
      this.cleanupTimer = setInterval(() => this.cleanup(), interval);
      // Don't keep the Node process alive just for the cleanup timer.
      this.cleanupTimer.unref();
    }
  }

  get(sid, callback) {
    try {
      const row = this.stmts.get.get(sid);
      if (!row) return callback(null, null);
      if (row.expires_at < Date.now()) {
        // Expired but not yet swept — drop it now so the next request gets a fresh session.
        this.stmts.destroy.run(sid);
        return callback(null, null);
      }
      callback(null, JSON.parse(row.data));
    } catch (err) {
      callback(err);
    }
  }

  set(sid, sessionData, callback) {
    try {
      const expiresAt = this._expiresAt(sessionData);
      this.stmts.set.run(sid, expiresAt, JSON.stringify(sessionData));
      if (callback) callback(null);
    } catch (err) {
      if (callback) callback(err);
    }
  }

  destroy(sid, callback) {
    try {
      this.stmts.destroy.run(sid);
      if (callback) callback(null);
    } catch (err) {
      if (callback) callback(err);
    }
  }

  touch(sid, sessionData, callback) {
    try {
      this.stmts.touch.run(this._expiresAt(sessionData), sid);
      if (callback) callback(null);
    } catch (err) {
      if (callback) callback(err);
    }
  }

  /**
   * Delete expired rows. Safe to call repeatedly; runs on a timer.
   * @returns {number} rows deleted
   */
  cleanup() {
    try {
      const result = this.stmts.cleanup.run(Date.now());
      return result.changes;
    } catch {
      // Cleanup failures are non-fatal — next sweep will retry.
      return 0;
    }
  }

  /**
   * Stop the cleanup timer. Useful in tests; production rarely needs this
   * because the timer is unref'd.
   */
  close() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  _expiresAt(sessionData) {
    const cookieExpires = sessionData && sessionData.cookie && sessionData.cookie.expires;
    if (cookieExpires) {
      const ts = new Date(cookieExpires).getTime();
      if (Number.isFinite(ts)) return ts;
    }
    return Date.now() + this.ttlMs;
  }
}

module.exports = SQLiteSessionStore;
