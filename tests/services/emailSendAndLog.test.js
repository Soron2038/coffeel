/**
 * emailService.sendAndLog tests — verify every outgoing mail is recorded in
 * the `emails` table with a tracking-id, and that SMTP outcomes (success /
 * rejected / thrown) are reflected as the correct status.
 *
 * Nodemailer is fully mocked here — no real SMTP I/O.
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.SMTP_HOST = 'mock.smtp.local';
process.env.SMTP_FROM = 'coffee@example.com';

const { createTestDatabase, closeTestDatabase, createTestUser } = require('../helpers');

const mockState = { db: null };

jest.mock('../../src/db/database', () => ({
  get: (sql, params) => mockState.db.prepare(sql).get(...(params || [])),
  all: (sql, params) => mockState.db.prepare(sql).all(...(params || [])),
  run: (sql, params) => mockState.db.prepare(sql).run(...(params || [])),
  transaction: (fn) => mockState.db.transaction(fn)(),
  getDb: () => mockState.db,
}));

// Settings service: return blank for everything so getSmtpConfig falls back
// to process.env values.
jest.mock('../../src/services/settingsService', () => ({
  getSetting: () => null,
  getBankDetails: () => ({ iban: 'DE00', bic: 'X', owner: 'Y' }),
  getAdminEmail: () => 'admin@example.com',
  getCoffeePrice: () => 0.5,
}));

const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: () => ({
    sendMail: (...args) => mockSendMail(...args),
    close: () => {},
    verify: () => Promise.resolve(true),
  }),
}));

const emailService = require('../../src/services/emailService');

beforeEach(() => {
  mockState.db = createTestDatabase();
  mockSendMail.mockReset();
  // Force the transporter to be rebuilt on each test so a stale closed
  // instance from a previous test isn't reused.
  emailService.resetTransporter();
});

afterAll(() => {
  closeTestDatabase();
});

const lastEmailRow = () =>
  mockState.db.prepare('SELECT * FROM emails ORDER BY id DESC LIMIT 1').get();

describe('sendAndLog', () => {
  test('successful send inserts a row with status=sent and tracking header', async () => {
    mockSendMail.mockResolvedValue({
      messageId: '<abc@example.com>',
      response: '250 OK',
      accepted: ['x@example.com'],
      rejected: [],
    });

    const result = await emailService.sendAndLog({
      to: 'x@example.com',
      subject: 'Hello',
      text: 'plain',
      html: '<p>html</p>',
      userId: null,
      emailType: 'test',
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('<abc@example.com>');
    expect(typeof result.trackingId).toBe('string');

    // Verify nodemailer was called with the X-Coffee-Email-Id header
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const [opts] = mockSendMail.mock.calls[0];
    expect(opts.headers['X-Coffee-Email-Id']).toBe(result.trackingId);
    expect(opts.to).toBe('x@example.com');

    // Verify DB row
    const row = lastEmailRow();
    expect(row.tracking_id).toBe(result.trackingId);
    expect(row.recipient_email).toBe('x@example.com');
    expect(row.email_type).toBe('test');
    expect(row.status).toBe('sent');
    expect(row.message_id).toBe('<abc@example.com>');
    expect(row.smtp_response).toBe('250 OK');
  });

  test('rejected recipients result in status=rejected_smtp', async () => {
    mockSendMail.mockResolvedValue({
      messageId: '<rej@example.com>',
      response: '250 1 of 2 accepted',
      accepted: ['ok@example.com'],
      rejected: ['bad@example.com'],
    });

    const result = await emailService.sendAndLog({
      to: 'bad@example.com',
      subject: 'Hi',
      text: 't',
      html: '<p>h</p>',
      userId: null,
      emailType: 'test',
    });

    expect(result.success).toBe(false);

    const row = lastEmailRow();
    expect(row.status).toBe('rejected_smtp');
    expect(row.smtp_rejected).toContain('bad@example.com');
  });

  test('thrown error results in status=send_failed', async () => {
    mockSendMail.mockRejectedValue(new Error('Connection refused'));

    const result = await emailService.sendAndLog({
      to: 'unreachable@example.com',
      subject: 'Hi',
      text: 't',
      html: '<p>h</p>',
      userId: null,
      emailType: 'test',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Connection refused/);

    const row = lastEmailRow();
    expect(row.status).toBe('send_failed');
    expect(row.smtp_response).toMatch(/Connection refused/);
  });

  test('userId and broadcastId are persisted on broadcast mails', async () => {
    mockSendMail.mockResolvedValue({
      messageId: '<bc@example.com>',
      response: '250 OK',
      accepted: ['user@example.com'],
      rejected: [],
    });

    // Need a real user + broadcast row so the FK is satisfiable. The schema
    // FK is ON DELETE SET NULL so a missing user wouldn't fail the insert,
    // but real-world calls always pass a valid user id.
    const user = createTestUser(mockState.db, { email: 'user@example.com' });
    mockState.db.prepare(
      `INSERT INTO admin_users (username, password_hash) VALUES ('admin', 'x')`
    ).run();
    const adminId = mockState.db.prepare('SELECT id FROM admin_users').get().id;
    const bc = mockState.db.prepare(
      `INSERT INTO broadcasts (subject, body, status, total_count, sent_by_admin_id)
       VALUES ('S', 'B', 'completed', 1, ?)`
    ).run(adminId);

    await emailService.sendAndLog({
      to: 'user@example.com',
      subject: 'Test',
      text: 't',
      html: '<p>h</p>',
      userId: user.id,
      emailType: 'broadcast',
      broadcastId: bc.lastInsertRowid,
    });

    const row = lastEmailRow();
    expect(row.user_id).toBe(user.id);
    expect(row.broadcast_id).toBe(bc.lastInsertRowid);
    expect(row.email_type).toBe('broadcast');
  });

  test('returns "SMTP host not configured" when host is empty', async () => {
    const original = process.env.SMTP_HOST;
    process.env.SMTP_HOST = '';
    emailService.resetTransporter();

    const result = await emailService.sendAndLog({
      to: 'x@example.com',
      subject: 'Hi',
      text: 't',
      html: '<p>h</p>',
      userId: null,
      emailType: 'test',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/SMTP host not configured/);

    // No DB row inserted in this case
    const count = mockState.db.prepare('SELECT COUNT(*) AS n FROM emails').get().n;
    expect(count).toBe(0);

    process.env.SMTP_HOST = original;
  });
});
