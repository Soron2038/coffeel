/**
 * Broadcast API Integration Tests
 *
 * Wires the api router up with a stub session middleware so requireAdmin
 * sees a logged-in admin user. The db is a mocked in-memory SQLite.
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

const request = require('supertest');
const express = require('express');

const { createTestDatabase, closeTestDatabase, createTestUser } = require('../helpers');

const mockState = { db: null, adminUser: null };

jest.mock('../../src/db/database', () => ({
  get: (sql, params) => mockState.db.prepare(sql).get(...(params || [])),
  all: (sql, params) => mockState.db.prepare(sql).all(...(params || [])),
  run: (sql, params) => mockState.db.prepare(sql).run(...(params || [])),
  transaction: (fn) => {
    const tx = mockState.db.transaction(fn);
    return tx();
  },
  getDb: () => mockState.db,
  initialize: () => {},
  close: () => {},
}));

const mockSendMail = jest.fn();
jest.mock('../../src/services/emailService', () => ({
  sendMail: (...args) => mockSendMail(...args),
  sendWelcomeEmail: jest.fn().mockResolvedValue({ success: true }),
  sendPaymentRequest: jest.fn().mockResolvedValue({ success: true }),
  sendPaymentRequestByAmount: jest.fn().mockResolvedValue({ success: true }),
  sendTestEmail: jest.fn().mockResolvedValue({ success: true }),
}));

const app = express();
app.use(express.json());
// Stub session: each request gets a session object whose adminUser is whatever
// mockState.adminUser is set to.
app.use((req, res, next) => {
  req.session = mockState.adminUser ? { adminUser: mockState.adminUser } : {};
  next();
});
app.use('/api', require('../../src/routes/api'));

const seedAdmin = (db, username = 'admin') =>
  db.prepare(
    'INSERT INTO admin_users (username, password_hash) VALUES (?, ?)'
  ).run(username, 'irrelevant').lastInsertRowid;

const waitForCompletion = async (broadcastId, timeoutMs = 2000) => {
  const broadcastService = require('../../src/services/broadcastService');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = broadcastService.getBroadcast(broadcastId);
    if (row && (row.status === 'completed' || row.status === 'failed')) return row;
    await new Promise((r) => setTimeout(r, 20));
  }
  return broadcastService.getBroadcast(broadcastId);
};

beforeEach(() => {
  mockState.db = createTestDatabase();
  mockState.adminUser = null;
  mockSendMail.mockReset();
  mockSendMail.mockResolvedValue({ success: true, messageId: 'm' });
});

afterAll(() => {
  closeTestDatabase();
});

// -------------------------------------------------------------------------
// Auth gating: every endpoint should reject unauthenticated requests
// -------------------------------------------------------------------------

describe('Broadcast endpoints require admin auth', () => {
  test.each([
    ['POST', '/api/broadcasts/preview'],
    ['POST', '/api/broadcasts/test-send'],
    ['POST', '/api/broadcasts'],
    ['GET', '/api/broadcasts'],
    ['GET', '/api/broadcasts/active'],
    ['GET', '/api/broadcasts/1'],
    ['POST', '/api/broadcasts/1/resend-failed'],
  ])('%s %s rejects without session', async (method, url) => {
    const m = method.toLowerCase();
    const res = method === 'GET'
      ? await request(app)[m](url)
      : await request(app)[m](url).send({ subject: 'x', body: 'y' });
    expect(res.status).toBe(401);
  });
});

// -------------------------------------------------------------------------
// Authenticated flows
// -------------------------------------------------------------------------

describe('POST /api/broadcasts/preview', () => {
  beforeEach(() => {
    const adminId = seedAdmin(mockState.db);
    mockState.adminUser = { id: adminId, username: 'admin' };
  });

  test('renders preview with sample user', async () => {
    createTestUser(mockState.db, { firstName: 'Anna', lastName: 'M', email: 'anna@ex.com' });
    const res = await request(app)
      .post('/api/broadcasts/preview')
      .send({ subject: 'Hi {firstName}', body: 'Hello {firstName} {lastName}' });
    expect(res.status).toBe(200);
    expect(res.body.subject).toBe('Hi Anna');
    expect(res.body.text).toBe('Hello Anna M');
    expect(res.body.html).toContain('Hello Anna M');
  });

  test('rejects empty subject with 400', async () => {
    const res = await request(app)
      .post('/api/broadcasts/preview')
      .send({ subject: '', body: 'b' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Subject/);
  });
});

describe('POST /api/broadcasts/test-send', () => {
  beforeEach(() => {
    const adminId = seedAdmin(mockState.db);
    mockState.adminUser = { id: adminId, username: 'admin' };
    // Provide an admin_email setting
    mockState.db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('admin_email', 'admin@example.com')"
    ).run();
  });

  test('sends [TEST] prefixed mail and returns sentTo', async () => {
    const res = await request(app)
      .post('/api/broadcasts/test-send')
      .send({ subject: 'Subj', body: 'Body' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, sentTo: 'admin@example.com' });
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail.mock.calls[0][0].subject).toBe('[TEST] Subj');
  });

  test('rejects when admin_email missing', async () => {
    mockState.db.prepare("DELETE FROM settings WHERE key = 'admin_email'").run();
    const res = await request(app)
      .post('/api/broadcasts/test-send')
      .send({ subject: 'S', body: 'B' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Admin email/);
  });
});

describe('POST /api/broadcasts (start)', () => {
  let adminId;

  beforeEach(() => {
    adminId = seedAdmin(mockState.db);
    mockState.adminUser = { id: adminId, username: 'admin' };
  });

  test('returns 202 + broadcastId, then completes', async () => {
    createTestUser(mockState.db, { email: 'a@ex.com' });
    createTestUser(mockState.db, { email: 'b@ex.com' });
    const res = await request(app)
      .post('/api/broadcasts')
      .send({ subject: 'S', body: 'B' });
    expect(res.status).toBe(202);
    expect(res.body.broadcastId).toBeGreaterThan(0);

    const row = await waitForCompletion(res.body.broadcastId);
    expect(row.status).toBe('completed');
    expect(row.sentCount).toBe(2);
  });

  test('rejects invalid input with 400', async () => {
    createTestUser(mockState.db, { email: 'a@ex.com' });
    const res = await request(app)
      .post('/api/broadcasts')
      .send({ subject: '', body: 'B' });
    expect(res.status).toBe(400);
  });

  test('returns 409 when another broadcast is active', async () => {
    createTestUser(mockState.db, { email: 'a@ex.com' });
    mockState.db.prepare(
      `INSERT INTO broadcasts (subject, body, status, total_count, sent_by_admin_id, started_at)
       VALUES ('Other', 'B', 'sending', 1, ?, CURRENT_TIMESTAMP)`
    ).run(adminId);

    const res = await request(app)
      .post('/api/broadcasts')
      .send({ subject: 'S', body: 'B' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('BROADCAST_IN_PROGRESS');
  });
});

describe('GET /api/broadcasts/:id', () => {
  beforeEach(() => {
    const adminId = seedAdmin(mockState.db);
    mockState.adminUser = { id: adminId, username: 'admin' };
  });

  test('returns broadcast for valid id', async () => {
    const adminId = mockState.adminUser.id;
    const insert = mockState.db.prepare(
      `INSERT INTO broadcasts (subject, body, status, total_count, sent_by_admin_id)
       VALUES ('S','B','completed', 5, ?)`
    ).run(adminId);

    const res = await request(app).get(`/api/broadcasts/${insert.lastInsertRowid}`);
    expect(res.status).toBe(200);
    expect(res.body.subject).toBe('S');
    expect(res.body.totalCount).toBe(5);
    expect(res.body.failedRecipients).toEqual([]);
  });

  test('404 for non-existent id', async () => {
    const res = await request(app).get('/api/broadcasts/9999');
    expect(res.status).toBe(404);
  });

  test('400 for non-numeric id', async () => {
    const res = await request(app).get('/api/broadcasts/abc');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/broadcasts (list)', () => {
  beforeEach(() => {
    const adminId = seedAdmin(mockState.db);
    mockState.adminUser = { id: adminId, username: 'admin' };
    mockState.db.prepare(
      `INSERT INTO broadcasts (subject, body, status, total_count, sent_by_admin_id, created_at)
       VALUES ('Old','B','completed',1, ?, '2026-01-01')`
    ).run(adminId);
    mockState.db.prepare(
      `INSERT INTO broadcasts (subject, body, status, total_count, sent_by_admin_id, created_at)
       VALUES ('New','B','completed',1, ?, '2026-04-01')`
    ).run(adminId);
  });

  test('returns history newest-first', async () => {
    const res = await request(app).get('/api/broadcasts');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].subject).toBe('New');
  });

  test('respects limit param', async () => {
    const res = await request(app).get('/api/broadcasts?limit=1');
    expect(res.body).toHaveLength(1);
    expect(res.body[0].subject).toBe('New');
  });
});

describe('GET /api/broadcasts/active', () => {
  beforeEach(() => {
    const adminId = seedAdmin(mockState.db);
    mockState.adminUser = { id: adminId, username: 'admin' };
  });

  test('returns null when nothing is sending', async () => {
    const res = await request(app).get('/api/broadcasts/active');
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  test('returns active broadcast row when one exists', async () => {
    const adminId = mockState.adminUser.id;
    mockState.db.prepare(
      `INSERT INTO broadcasts (subject, body, status, total_count, sent_by_admin_id, started_at)
       VALUES ('Active','B','sending', 3, ?, CURRENT_TIMESTAMP)`
    ).run(adminId);

    const res = await request(app).get('/api/broadcasts/active');
    expect(res.status).toBe(200);
    expect(res.body.subject).toBe('Active');
    expect(res.body.status).toBe('sending');
  });
});

describe('POST /api/broadcasts/:id/resend-failed', () => {
  let adminId;

  beforeEach(() => {
    adminId = seedAdmin(mockState.db);
    mockState.adminUser = { id: adminId, username: 'admin' };
  });

  test('creates a new broadcast targeting failed users', async () => {
    const u = createTestUser(mockState.db, { email: 'fail@ex.com' });
    createTestUser(mockState.db, { email: 'ok@ex.com' });

    mockSendMail.mockImplementation(({ to }) =>
      to === 'fail@ex.com'
        ? Promise.resolve({ success: false, error: 'SMTP 550' })
        : Promise.resolve({ success: true })
    );

    const start = await request(app).post('/api/broadcasts').send({ subject: 'S', body: 'B' });
    await waitForCompletion(start.body.broadcastId);

    mockSendMail.mockResolvedValue({ success: true });
    const resend = await request(app).post(`/api/broadcasts/${start.body.broadcastId}/resend-failed`);
    expect(resend.status).toBe(202);
    const newId = resend.body.broadcastId;
    expect(newId).not.toBe(start.body.broadcastId);

    const newRow = await waitForCompletion(newId);
    expect(newRow.status).toBe('completed');
    expect(newRow.sentCount).toBe(1);
    expect(newRow.totalCount).toBe(1);
    expect(newRow.originBroadcastId).toBe(start.body.broadcastId);
    void u;
  });

  test('400 when broadcast had no failures', async () => {
    const insert = mockState.db.prepare(
      `INSERT INTO broadcasts (subject, body, status, total_count, sent_by_admin_id)
       VALUES ('S','B','completed',1, ?)`
    ).run(adminId);
    const res = await request(app).post(`/api/broadcasts/${insert.lastInsertRowid}/resend-failed`);
    expect(res.status).toBe(400);
  });
});
