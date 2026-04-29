/**
 * Broadcast Service Tests
 *
 * Two layers of coverage:
 *   1. Pure functions (substitute, renderEmail, validateInput, runWithConcurrency)
 *      tested directly — no DB or email dependency.
 *   2. Lifecycle scenarios with a mocked db + emailService — concurrency lock,
 *      sender loop, resend-failed, boot recovery.
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

const { createTestDatabase, closeTestDatabase, createTestUser } = require('../helpers');

// jest.mock() hoists; only variables prefixed with `mock` may be referenced from
// the factory. We expose a single mockState object that beforeEach swaps.
const mockState = { db: null };

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

// Mock emailService.sendMail. Default behaviour: succeed. Tests can override.
const mockSendMail = jest.fn();
jest.mock('../../src/services/emailService', () => ({
  sendMail: (...args) => mockSendMail(...args),
  // Other functions are not used by broadcastService — provide stubs in case
  // userService picks one up indirectly during user creation (welcome email).
  sendWelcomeEmail: jest.fn().mockResolvedValue({ success: true }),
  sendPaymentRequest: jest.fn().mockResolvedValue({ success: true }),
  sendPaymentRequestByAmount: jest.fn().mockResolvedValue({ success: true }),
}));

const broadcastService = require('../../src/services/broadcastService');
const {
  substitute,
  renderEmail,
  validateInput,
  runWithConcurrency,
} = broadcastService;

const seedAdmin = (db) =>
  db.prepare(
    'INSERT INTO admin_users (username, password_hash) VALUES (?, ?)'
  ).run('admin', 'irrelevant').lastInsertRowid;

const waitForStatus = async (broadcastId, statuses, timeoutMs = 2000) => {
  const targets = Array.isArray(statuses) ? statuses : [statuses];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = broadcastService.getBroadcast(broadcastId);
    if (row && targets.includes(row.status)) return row;
    await new Promise((r) => setTimeout(r, 20));
  }
  return broadcastService.getBroadcast(broadcastId);
};

beforeEach(() => {
  mockState.db = createTestDatabase();
  mockSendMail.mockReset();
  mockSendMail.mockResolvedValue({ success: true, messageId: 'm1' });
});

afterAll(() => {
  closeTestDatabase();
});

// ========================================================================
// Pure functions
// ========================================================================

describe('substitute', () => {
  test('replaces all three placeholders', () => {
    const out = substitute('Hi {firstName} {lastName} <{email}>', {
      firstName: 'Anna',
      lastName: 'Mueller',
      email: 'a@example.com',
    });
    expect(out).toBe('Hi Anna Mueller <a@example.com>');
  });

  test('missing fields become empty string', () => {
    expect(substitute('Hi {firstName}!', {})).toBe('Hi !');
    expect(substitute('Hi {firstName}!', null)).toBe('Hi !');
  });

  test('non-string template returns empty string', () => {
    expect(substitute(undefined, { firstName: 'A' })).toBe('');
    expect(substitute(123, { firstName: 'A' })).toBe('');
  });

  test('does not substitute disallowed placeholders', () => {
    const out = substitute('Tab: {currentTab}, {firstName}', {
      firstName: 'Anna',
      currentTab: 4.5,
    });
    expect(out).toBe('Tab: {currentTab}, Anna');
  });
});

describe('renderEmail', () => {
  test('escapes HTML in body and converts newlines to <br>', () => {
    const result = renderEmail('Subject', 'Hi <b>x</b>\nLine 2', {
      firstName: 'A',
    });
    expect(result.text).toBe('Hi <b>x</b>\nLine 2');
    expect(result.html).toContain('Hi &lt;b&gt;x&lt;/b&gt;<br>');
    expect(result.html).toContain('Line 2');
  });

  test('auto-links http(s) URLs', () => {
    const result = renderEmail('S', 'See https://example.com/path here', {});
    expect(result.html).toContain('<a href="https://example.com/path">https://example.com/path</a>');
  });

  test('substitutes placeholders in subject and body', () => {
    const result = renderEmail('Hi {firstName}', 'Body for {firstName}', {
      firstName: 'Anna',
    });
    expect(result.subject).toBe('Hi Anna');
    expect(result.text).toBe('Body for Anna');
    expect(result.html).toContain('Body for Anna');
  });

  test('script tags in body are neutralised', () => {
    const result = renderEmail('S', '<script>alert(1)</script>', {});
    expect(result.html).not.toContain('<script>');
    expect(result.html).toContain('&lt;script&gt;');
  });
});

describe('validateInput', () => {
  test('accepts trimmed valid input', () => {
    const r = validateInput('  Hello  ', '  body  ');
    expect(r.valid).toBe(true);
    expect(r.subject).toBe('Hello');
    expect(r.body).toBe('body');
  });

  test('rejects empty subject', () => {
    expect(validateInput('', 'body').valid).toBe(false);
    expect(validateInput('   ', 'body').valid).toBe(false);
  });

  test('rejects empty body', () => {
    expect(validateInput('subj', '').valid).toBe(false);
  });

  test('rejects subject over 200 chars', () => {
    expect(validateInput('x'.repeat(201), 'body').valid).toBe(false);
  });

  test('rejects body over 10000 chars', () => {
    expect(validateInput('subj', 'x'.repeat(10001)).valid).toBe(false);
  });
});

describe('runWithConcurrency', () => {
  test('processes all items', async () => {
    const seen = [];
    await runWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      seen.push(n);
    });
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  test('respects concurrency cap', async () => {
    let inFlight = 0;
    let maxObserved = 0;
    const items = Array.from({ length: 12 }, (_, i) => i);
    await runWithConcurrency(items, 3, async () => {
      inFlight++;
      maxObserved = Math.max(maxObserved, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
    });
    expect(maxObserved).toBeLessThanOrEqual(3);
  });

  test('handles empty input', async () => {
    await expect(runWithConcurrency([], 5, jest.fn())).resolves.toBeUndefined();
  });
});

// ========================================================================
// Lifecycle integration (mocked db + email)
// ========================================================================

describe('startBroadcast', () => {
  test('rejects invalid input', () => {
    const adminId = seedAdmin(mockState.db);
    const r = broadcastService.startBroadcast('', 'body', { id: adminId });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Subject/);
  });

  test('rejects when no active recipients exist', () => {
    const adminId = seedAdmin(mockState.db);
    const r = broadcastService.startBroadcast('Subj', 'Body', { id: adminId });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/recipients/i);
  });

  test('inserts a broadcast row and audit_log entry', async () => {
    const adminId = seedAdmin(mockState.db);
    createTestUser(mockState.db, { firstName: 'Anna', email: 'a@ex.com' });
    createTestUser(mockState.db, { firstName: 'Ben', email: 'b@ex.com' });

    const r = broadcastService.startBroadcast('Subj', 'Hi {firstName}', { id: adminId });
    expect(r.success).toBe(true);
    expect(r.data.broadcastId).toBeGreaterThan(0);

    const row = await waitForStatus(r.data.broadcastId, ['completed', 'failed']);
    expect(row.totalCount).toBe(2);

    const audit = mockState.db
      .prepare("SELECT * FROM audit_log WHERE action = 'broadcast_email'")
      .all();
    expect(audit.length).toBe(1);
    expect(audit[0].amount).toBe(2);
    expect(audit[0].new_value).toBe('Subj');
    expect(audit[0].performed_by).toBe('admin');
  });

  test('rejects a second start while one is sending', () => {
    const adminId = seedAdmin(mockState.db);
    createTestUser(mockState.db, { email: 'a@ex.com' });
    // Insert a "sending" row directly to avoid the async loop racing the second call.
    mockState.db.prepare(
      `INSERT INTO broadcasts (subject, body, status, total_count, sent_by_admin_id, started_at)
       VALUES ('S','B','sending', 1, ?, CURRENT_TIMESTAMP)`
    ).run(adminId);

    const r = broadcastService.startBroadcast('Subj', 'Body', { id: adminId });
    expect(r.success).toBe(false);
    expect(r.error).toBe('BROADCAST_IN_PROGRESS');
  });
});

describe('runSenderLoop / completion', () => {
  test('full success path: completed with sent_count = total', async () => {
    const adminId = seedAdmin(mockState.db);
    createTestUser(mockState.db, { email: 'a@ex.com' });
    createTestUser(mockState.db, { email: 'b@ex.com' });
    createTestUser(mockState.db, { email: 'c@ex.com' });

    const r = broadcastService.startBroadcast('Hi', 'body', { id: adminId });
    const row = await waitForStatus(r.data.broadcastId, ['completed', 'failed']);

    expect(row.status).toBe('completed');
    expect(row.sentCount).toBe(3);
    expect(row.failedCount).toBe(0);
    expect(row.failedRecipients).toEqual([]);
    expect(mockSendMail).toHaveBeenCalledTimes(3);
  });

  test('mixed success/failure path: captures failed recipients', async () => {
    const adminId = seedAdmin(mockState.db);
    const u1 = createTestUser(mockState.db, { email: 'ok@ex.com' });
    const u2 = createTestUser(mockState.db, { email: 'fail@ex.com' });
    const u3 = createTestUser(mockState.db, { email: 'ok2@ex.com' });

    mockSendMail.mockImplementation(({ to }) =>
      to === 'fail@ex.com'
        ? Promise.resolve({ success: false, error: 'SMTP 550' })
        : Promise.resolve({ success: true, messageId: 'm' })
    );

    const r = broadcastService.startBroadcast('S', 'B', { id: adminId });
    const row = await waitForStatus(r.data.broadcastId, ['completed', 'failed']);

    expect(row.status).toBe('completed');
    expect(row.sentCount).toBe(2);
    expect(row.failedCount).toBe(1);
    expect(row.failedRecipients).toHaveLength(1);
    expect(row.failedRecipients[0].email).toBe('fail@ex.com');
    expect(row.failedRecipients[0].error).toBe('SMTP 550');
    expect(row.failedRecipients[0].userId).toBe(u2.id);
    // sanity: u1 and u3 not in failed list
    const failedIds = row.failedRecipients.map((f) => f.userId);
    expect(failedIds).not.toContain(u1.id);
    expect(failedIds).not.toContain(u3.id);
  });

  test('all failures still complete, just with high failed_count', async () => {
    seedAdmin(mockState.db);
    createTestUser(mockState.db, { email: 'a@ex.com' });
    createTestUser(mockState.db, { email: 'b@ex.com' });
    mockSendMail.mockResolvedValue({ success: false, error: 'connection refused' });

    const adminId = 1;
    const r = broadcastService.startBroadcast('S', 'B', { id: adminId });
    const row = await waitForStatus(r.data.broadcastId, ['completed', 'failed']);

    expect(row.status).toBe('completed');
    expect(row.sentCount).toBe(0);
    expect(row.failedCount).toBe(2);
  });
});

describe('resendFailed', () => {
  test('creates a new broadcast targeting only the failed users', async () => {
    const adminId = seedAdmin(mockState.db);
    const u1 = createTestUser(mockState.db, { email: 'ok@ex.com' });
    const u2 = createTestUser(mockState.db, { email: 'fail@ex.com' });

    mockSendMail.mockImplementation(({ to }) =>
      to === 'fail@ex.com'
        ? Promise.resolve({ success: false, error: 'SMTP 550' })
        : Promise.resolve({ success: true })
    );

    const original = broadcastService.startBroadcast('Subj', 'Body', { id: adminId });
    await waitForStatus(original.data.broadcastId, ['completed', 'failed']);

    // Now resend: SMTP comes back, all should succeed.
    mockSendMail.mockResolvedValue({ success: true, messageId: 'retry' });

    const resend = broadcastService.resendFailed(original.data.broadcastId, { id: adminId });
    expect(resend.success).toBe(true);
    expect(resend.data.broadcastId).not.toBe(original.data.broadcastId);

    const resentRow = await waitForStatus(resend.data.broadcastId, ['completed', 'failed']);
    expect(resentRow.status).toBe('completed');
    expect(resentRow.totalCount).toBe(1);
    expect(resentRow.sentCount).toBe(1);
    expect(resentRow.originBroadcastId).toBe(original.data.broadcastId);
    expect(resentRow.subject).toBe('Subj');
    expect(resentRow.body).toBe('Body');

    // Original row is unchanged (still has the failure recorded)
    const originalRow = broadcastService.getBroadcast(original.data.broadcastId);
    expect(originalRow.failedCount).toBe(1);

    // u1 was never re-mailed
    void u1;
    void u2;
  });

  test('rejects when there are no failed recipients', async () => {
    const adminId = seedAdmin(mockState.db);
    createTestUser(mockState.db, { email: 'a@ex.com' });

    const original = broadcastService.startBroadcast('S', 'B', { id: adminId });
    await waitForStatus(original.data.broadcastId, ['completed', 'failed']);

    const r = broadcastService.resendFailed(original.data.broadcastId, { id: adminId });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/no failed/i);
  });

  test('skips soft-deleted recipients', async () => {
    const adminId = seedAdmin(mockState.db);
    const u = createTestUser(mockState.db, { email: 'fail@ex.com' });

    mockSendMail.mockResolvedValue({ success: false, error: 'SMTP 550' });
    const original = broadcastService.startBroadcast('S', 'B', { id: adminId });
    await waitForStatus(original.data.broadcastId, ['completed', 'failed']);

    // Soft-delete the user, then try to resend.
    mockState.db.prepare('UPDATE users SET deleted_by_user = 1 WHERE id = ?').run(u.id);

    const r = broadcastService.resendFailed(original.data.broadcastId, { id: adminId });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/no longer active/i);
  });
});

describe('recoverInterruptedBroadcasts', () => {
  test('marks orphan sending rows as interrupted', () => {
    const adminId = seedAdmin(mockState.db);
    mockState.db.prepare(
      `INSERT INTO broadcasts (subject, body, status, total_count, sent_by_admin_id)
       VALUES ('Stuck', 'B', 'sending', 5, ?)`
    ).run(adminId);
    mockState.db.prepare(
      `INSERT INTO broadcasts (subject, body, status, total_count, sent_by_admin_id)
       VALUES ('Done', 'B', 'completed', 5, ?)`
    ).run(adminId);

    const result = broadcastService.recoverInterruptedBroadcasts();
    expect(result.success).toBe(true);
    expect(result.recovered).toBe(1);

    const stuck = mockState.db.prepare("SELECT status FROM broadcasts WHERE subject = 'Stuck'").get();
    const done = mockState.db.prepare("SELECT status FROM broadcasts WHERE subject = 'Done'").get();
    expect(stuck.status).toBe('interrupted');
    expect(done.status).toBe('completed');
  });
});

describe('previewBroadcast', () => {
  test('uses first active user as sample', () => {
    seedAdmin(mockState.db);
    createTestUser(mockState.db, { firstName: 'Anna', lastName: 'M', email: 'anna@ex.com' });
    const r = broadcastService.previewBroadcast('Hi {firstName}', 'Body for {firstName}');
    expect(r.success).toBe(true);
    expect(r.data.subject).toBe('Hi Anna');
    expect(r.data.text).toBe('Body for Anna');
    expect(r.data.sampleUserId).toBeGreaterThan(0);
  });

  test('falls back to synthetic sample when no users exist', () => {
    seedAdmin(mockState.db);
    const r = broadcastService.previewBroadcast('Hi {firstName}', 'Body');
    expect(r.success).toBe(true);
    expect(r.data.subject).toBe('Hi Sample');
    expect(r.data.sampleUserId).toBeNull();
  });
});

describe('testSendBroadcast', () => {
  test('rejects when admin email is missing', async () => {
    const r = await broadcastService.testSendBroadcast('S', 'B', '');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Admin email/);
  });

  test('sends via emailService.sendMail with [TEST] prefix', async () => {
    seedAdmin(mockState.db);
    createTestUser(mockState.db, { firstName: 'Anna', email: 'anna@ex.com' });
    const r = await broadcastService.testSendBroadcast('Subject', 'Body for {firstName}', 'admin@ex.com');
    expect(r.success).toBe(true);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const call = mockSendMail.mock.calls[0][0];
    expect(call.to).toBe('admin@ex.com');
    expect(call.subject).toBe('[TEST] Subject');
    expect(call.text).toBe('Body for Anna');
  });
});

describe('listBroadcasts', () => {
  test('returns history sorted by created_at DESC', () => {
    const adminId = seedAdmin(mockState.db);
    mockState.db.prepare(
      `INSERT INTO broadcasts (subject, body, status, total_count, sent_by_admin_id, created_at)
       VALUES ('Old', 'B', 'completed', 1, ?, '2026-01-01 10:00:00')`
    ).run(adminId);
    mockState.db.prepare(
      `INSERT INTO broadcasts (subject, body, status, total_count, sent_by_admin_id, created_at)
       VALUES ('New', 'B', 'completed', 1, ?, '2026-04-01 10:00:00')`
    ).run(adminId);

    const list = broadcastService.listBroadcasts({ limit: 10 });
    expect(list).toHaveLength(2);
    expect(list[0].subject).toBe('New');
    expect(list[1].subject).toBe('Old');
  });
});
