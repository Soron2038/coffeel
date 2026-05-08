/**
 * SQLite Session Store Tests
 *
 * Verifies the express-session adapter: get/set/destroy/touch and expiry
 * behavior. The store is exercised against the real schema (sessions table
 * created by migration M3).
 */

const Database = require('better-sqlite3');
const SQLiteSessionStore = require('../../src/db/sessionStore');
const { runMigrations } = require('../../src/db/migrations');

const SID = 'test-session-id';
const SILENT_LOGGER = { info: () => {}, warn: () => {}, error: () => {} };

const makeSession = (extra = {}) => ({
  cookie: {
    originalMaxAge: 60_000,
    expires: new Date(Date.now() + 60_000).toISOString(),
    httpOnly: true,
    path: '/',
  },
  ...extra,
});

describe('SQLiteSessionStore', () => {
  let db;
  let store;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db, { logger: SILENT_LOGGER });
    // Disable the cleanup timer in tests — we'll trigger cleanup manually.
    store = new SQLiteSessionStore(db, { cleanupIntervalMs: 0 });
  });

  afterEach(() => {
    store.close();
    db.close();
  });

  test('get on missing sid returns null', (done) => {
    store.get('nope', (err, session) => {
      expect(err).toBeNull();
      expect(session).toBeNull();
      done();
    });
  });

  test('set then get round-trips the session payload', (done) => {
    const data = makeSession({ admin: { username: 'witt' } });
    store.set(SID, data, (setErr) => {
      expect(setErr).toBeNull();
      store.get(SID, (getErr, session) => {
        expect(getErr).toBeNull();
        expect(session.admin).toEqual({ username: 'witt' });
        done();
      });
    });
  });

  test('set is upsert — second set overwrites the first', (done) => {
    store.set(SID, makeSession({ count: 1 }), () => {
      store.set(SID, makeSession({ count: 2 }), () => {
        store.get(SID, (_err, session) => {
          expect(session.count).toBe(2);
          done();
        });
      });
    });
  });

  test('destroy removes the session', (done) => {
    store.set(SID, makeSession(), () => {
      store.destroy(SID, (destroyErr) => {
        expect(destroyErr).toBeNull();
        store.get(SID, (_err, session) => {
          expect(session).toBeNull();
          done();
        });
      });
    });
  });

  test('expired session returns null on get and is deleted', (done) => {
    const expired = makeSession();
    expired.cookie.expires = new Date(Date.now() - 1000).toISOString();
    store.set(SID, expired, () => {
      store.get(SID, (_err, session) => {
        expect(session).toBeNull();
        // Verify the row was actually removed, not just hidden
        const row = db.prepare('SELECT sid FROM sessions WHERE sid = ?').get(SID);
        expect(row).toBeUndefined();
        done();
      });
    });
  });

  test('touch updates expiry without rewriting data', (done) => {
    const data = makeSession({ tag: 'v1' });
    store.set(SID, data, () => {
      const before = db.prepare('SELECT expires_at FROM sessions WHERE sid = ?').get(SID);
      // Bump expiry to a clearly later timestamp
      const refreshed = makeSession({ tag: 'v1' });
      refreshed.cookie.expires = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      store.touch(SID, refreshed, (err) => {
        expect(err).toBeNull();
        const after = db.prepare('SELECT expires_at FROM sessions WHERE sid = ?').get(SID);
        expect(after.expires_at).toBeGreaterThan(before.expires_at);
        done();
      });
    });
  });

  test('cleanup() deletes only expired rows', () => {
    const live = makeSession();
    const expired = makeSession();
    expired.cookie.expires = new Date(Date.now() - 1000).toISOString();
    store.set('live-sid', live);
    store.set('expired-sid', expired);

    const removed = store.cleanup();
    expect(removed).toBe(1);

    const liveRow = db.prepare('SELECT sid FROM sessions WHERE sid = ?').get('live-sid');
    const expiredRow = db.prepare('SELECT sid FROM sessions WHERE sid = ?').get('expired-sid');
    expect(liveRow).toBeDefined();
    expect(expiredRow).toBeUndefined();
  });

  test('falls back to ttlMs when session has no cookie expiry', () => {
    const ttlMs = 10_000;
    const customStore = new SQLiteSessionStore(db, { ttlMs, cleanupIntervalMs: 0 });
    const before = Date.now();
    customStore.set(SID, { cookie: {} });
    const row = db.prepare('SELECT expires_at FROM sessions WHERE sid = ?').get(SID);
    expect(row.expires_at).toBeGreaterThanOrEqual(before + ttlMs - 100);
    expect(row.expires_at).toBeLessThanOrEqual(Date.now() + ttlMs + 100);
    customStore.close();
  });
});
