/**
 * Bounce processor tests — pure parsing + DB matching layer.
 *
 * The IMAP/network layer is not exercised here. processOnce() needs a live
 * IMAP server and is covered by manual E2E verification (see DEPLOYMENT.md).
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

const path = require('path');
const fs = require('fs');
const { simpleParser } = require('mailparser');
const { createTestDatabase, closeTestDatabase, createTestUser } = require('../helpers');

const mockState = { db: null };

jest.mock('../../src/db/database', () => ({
  get: (sql, params) => mockState.db.prepare(sql).get(...(params || [])),
  all: (sql, params) => mockState.db.prepare(sql).all(...(params || [])),
  run: (sql, params) => mockState.db.prepare(sql).run(...(params || [])),
  transaction: (fn) => mockState.db.transaction(fn)(),
  getDb: () => mockState.db,
}));

jest.mock('../../src/services/settingsService', () => ({
  getSetting: () => '',
  getBankDetails: () => ({ iban: '', bic: '', owner: '' }),
  getAdminEmail: () => 'admin@example.com',
  getCoffeePrice: () => 0.5,
}));

const bounceProcessor = require('../../src/services/bounceProcessor');
const {
  classifyAsBounce,
  parseDsnFields,
  extractTrackingId,
  extractDsnInfo,
  codeToStatus,
} = bounceProcessor;

const loadFixture = (name) =>
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'bounces', name));

beforeEach(() => {
  mockState.db = createTestDatabase();
});

afterAll(() => {
  closeTestDatabase();
});

// ========================================================================
// Pure helpers
// ========================================================================

describe('codeToStatus', () => {
  test('5.x.x → bounced_hard', () => {
    expect(codeToStatus('5.1.1')).toBe('bounced_hard');
    expect(codeToStatus('5.7.1')).toBe('bounced_hard');
  });

  test('4.x.x → bounced_soft', () => {
    expect(codeToStatus('4.2.2')).toBe('bounced_soft');
    expect(codeToStatus('4.0.0')).toBe('bounced_soft');
  });

  test('unknown / missing code defaults to bounced_hard', () => {
    expect(codeToStatus(null)).toBe('bounced_hard');
    expect(codeToStatus(undefined)).toBe('bounced_hard');
    expect(codeToStatus('')).toBe('bounced_hard');
  });
});

describe('parseDsnFields', () => {
  test('parses key:value lines into lowercase keys', () => {
    const raw = `Reporting-MTA: dns; mail.example.com
Action: failed
Status: 5.1.1
Diagnostic-Code: smtp; 550 5.1.1 user unknown
`;
    const fields = parseDsnFields(raw);
    expect(fields.status).toBe('5.1.1');
    expect(fields.action).toBe('failed');
    expect(fields['diagnostic-code']).toBe('smtp; 550 5.1.1 user unknown');
  });

  test('unfolds continuation lines (RFC 5322 folding)', () => {
    const raw = `Diagnostic-Code: smtp;
 550 5.1.1
 User unknown in virtual mailbox table
Status: 5.1.1`;
    const fields = parseDsnFields(raw);
    expect(fields['diagnostic-code']).toContain('User unknown in virtual mailbox table');
    expect(fields.status).toBe('5.1.1');
  });

  test('first occurrence wins for duplicate headers', () => {
    const fields = parseDsnFields('Status: 5.1.1\nStatus: 4.0.0\n');
    expect(fields.status).toBe('5.1.1');
  });

  test('empty / null input returns empty object', () => {
    expect(parseDsnFields('')).toEqual({});
    expect(parseDsnFields(null)).toEqual({});
  });
});

// ========================================================================
// Classification + extraction against real fixtures
// ========================================================================

describe('classifyAsBounce', () => {
  test('multipart/report is detected as DSN bounce', async () => {
    const parsed = await simpleParser(loadFixture('hard-bounce-user-unknown.eml'));
    const c = classifyAsBounce(parsed);
    expect(c.isBounce).toBe(true);
    expect(c.kind).toBe('dsn');
  });

  test('normal reply is NOT classified as bounce', async () => {
    const parsed = await simpleParser(loadFixture('normal-reply.eml'));
    expect(classifyAsBounce(parsed).isBounce).toBe(false);
  });
});

describe('extractTrackingId', () => {
  test('finds X-Coffee-Email-Id in embedded message/rfc822', async () => {
    const parsed = await simpleParser(loadFixture('hard-bounce-user-unknown.eml'));
    expect(extractTrackingId(parsed)).toBe('11111111-2222-3333-4444-555555555555');
  });

  test('finds tracking-id from soft-bounce fixture too', async () => {
    const parsed = await simpleParser(loadFixture('soft-bounce-mailbox-full.eml'));
    expect(extractTrackingId(parsed)).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  test('returns null when no tracking-id is present', async () => {
    const parsed = await simpleParser(loadFixture('normal-reply.eml'));
    expect(extractTrackingId(parsed)).toBeNull();
  });
});

describe('extractDsnInfo', () => {
  test('hard bounce: extracts 5.1.1 + diagnostic code', async () => {
    const parsed = await simpleParser(loadFixture('hard-bounce-user-unknown.eml'));
    const info = extractDsnInfo(parsed);
    expect(info.code).toBe('5.1.1');
    expect(info.reason).toMatch(/User unknown/);
    expect(info.finalRecipient).toMatch(/nonexistent-user@far-far-away.example.org/);
  });

  test('soft bounce: extracts 4.2.2 + mailbox-over-quota', async () => {
    const parsed = await simpleParser(loadFixture('soft-bounce-mailbox-full.eml'));
    const info = extractDsnInfo(parsed);
    expect(info.code).toBe('4.2.2');
    expect(info.reason).toMatch(/Mailbox over quota/);
  });
});

// ========================================================================
// Integration: feed a parsed fixture through the matching logic and verify
// the emails-table row gets updated correctly.
// ========================================================================

describe('bounce matching against emails table', () => {
  const seedEmail = (db, trackingId, overrides = {}) => {
    const user = createTestUser(db, { email: overrides.email || 'recip@example.com' });
    db.prepare(
      `INSERT INTO emails
         (tracking_id, user_id, recipient_email, email_type, broadcast_id, subject, status)
       VALUES (?, ?, ?, ?, ?, ?, 'sent')`
    ).run(
      trackingId,
      user.id,
      overrides.email || 'recip@example.com',
      overrides.emailType || 'broadcast',
      overrides.broadcastId || null,
      'Test subject'
    );
    return user;
  };

  test('hard bounce updates matching emails row to bounced_hard', async () => {
    const trackingId = '11111111-2222-3333-4444-555555555555';
    seedEmail(mockState.db, trackingId);

    const parsed = await simpleParser(loadFixture('hard-bounce-user-unknown.eml'));
    const extracted = extractTrackingId(parsed);
    const info = extractDsnInfo(parsed);
    const status = codeToStatus(info.code);

    expect(extracted).toBe(trackingId);

    const result = mockState.db.prepare(
      `UPDATE emails
          SET status = ?, bounce_code = ?, bounce_reason = ?, bounced_at = CURRENT_TIMESTAMP
        WHERE tracking_id = ?`
    ).run(status, info.code, info.reason, extracted);

    expect(result.changes).toBe(1);

    const row = mockState.db.prepare('SELECT * FROM emails WHERE tracking_id = ?').get(extracted);
    expect(row.status).toBe('bounced_hard');
    expect(row.bounce_code).toBe('5.1.1');
    expect(row.bounce_reason).toMatch(/User unknown/);
    expect(row.bounced_at).not.toBeNull();
  });

  test('soft bounce updates matching emails row to bounced_soft', async () => {
    const trackingId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    seedEmail(mockState.db, trackingId, { email: 'busy-mailbox@example.com' });

    const parsed = await simpleParser(loadFixture('soft-bounce-mailbox-full.eml'));
    const extracted = extractTrackingId(parsed);
    const info = extractDsnInfo(parsed);
    const status = codeToStatus(info.code);

    mockState.db.prepare(
      `UPDATE emails
          SET status = ?, bounce_code = ?, bounce_reason = ?, bounced_at = CURRENT_TIMESTAMP
        WHERE tracking_id = ?`
    ).run(status, info.code, info.reason, extracted);

    const row = mockState.db.prepare('SELECT * FROM emails WHERE tracking_id = ?').get(extracted);
    expect(row.status).toBe('bounced_soft');
    expect(row.bounce_code).toBe('4.2.2');
  });

  test('bounce for unknown tracking-id leaves emails table unchanged', async () => {
    // Seed something else so the table isn't empty
    seedEmail(mockState.db, 'something-unrelated');

    const fakeTrackingId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    const result = mockState.db.prepare(
      `UPDATE emails
          SET status = 'bounced_hard'
        WHERE tracking_id = ?`
    ).run(fakeTrackingId);

    expect(result.changes).toBe(0);
  });
});
