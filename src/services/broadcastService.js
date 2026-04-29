const db = require('../db/database');
const logger = require('../utils/logger');

// Lazy-loaded to avoid circular dependencies
let userService = null;
let emailService = null;

const getUserService = () => {
  if (!userService) userService = require('./userService');
  return userService;
};

const getEmailService = () => {
  if (!emailService) emailService = require('./emailService');
  return emailService;
};

const SEND_CONCURRENCY = 5;
const PROGRESS_FLUSH_INTERVAL = 10;
const SUBJECT_MAX = 200;
const BODY_MAX = 10000;
const URL_REGEX = /(https?:\/\/[^\s<]+)/g;

const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const substitute = (template, user) => {
  if (typeof template !== 'string') return '';
  const u = user || {};
  return template
    .replace(/\{firstName\}/g, u.firstName ?? '')
    .replace(/\{lastName\}/g, u.lastName ?? '')
    .replace(/\{email\}/g, u.email ?? '');
};

const renderEmail = (subject, body, user) => {
  const resolvedSubject = substitute(subject, user);
  const resolvedText = substitute(body, user);
  const escaped = escapeHtml(resolvedText);
  const linked = escaped.replace(URL_REGEX, (url) => `<a href="${url}">${url}</a>`);
  const htmlBody = linked.replace(/\n/g, '<br>\n');
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
<div>${htmlBody}</div>
<hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
<p style="color: #6b7280; font-size: 12px;">CofFeEL - Coffee Tracking System<br>This is an automated message.</p>
</body>
</html>`;
  return { subject: resolvedSubject, text: resolvedText, html };
};

const validateInput = (subject, body) => {
  const s = typeof subject === 'string' ? subject.trim() : '';
  const b = typeof body === 'string' ? body.trim() : '';
  if (s.length === 0) return { valid: false, error: 'Subject is required' };
  if (s.length > SUBJECT_MAX) return { valid: false, error: `Subject exceeds ${SUBJECT_MAX} characters` };
  if (b.length === 0) return { valid: false, error: 'Body is required' };
  if (b.length > BODY_MAX) return { valid: false, error: `Body exceeds ${BODY_MAX} characters` };
  return { valid: true, subject: s, body: b };
};

const formatBroadcast = (row) => {
  if (!row) return null;
  let failedRecipients = [];
  if (row.failed_recipients) {
    try {
      failedRecipients = JSON.parse(row.failed_recipients);
    } catch (err) {
      logger.warn('Failed to parse failed_recipients JSON', { broadcastId: row.id, error: err.message });
    }
  }
  return {
    id: row.id,
    subject: row.subject,
    body: row.body,
    status: row.status,
    totalCount: row.total_count,
    sentCount: row.sent_count,
    failedCount: row.failed_count,
    failedRecipients,
    originBroadcastId: row.origin_broadcast_id,
    sentByAdminId: row.sent_by_admin_id,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
};

const getActiveRecipients = () => getUserService().getAllUsers(false);

const previewBroadcast = (subject, body) => {
  const validation = validateInput(subject, body);
  if (!validation.valid) return { success: false, error: validation.error };

  const recipients = getActiveRecipients();
  const sample = recipients[0] || { firstName: 'Sample', lastName: 'User', email: 'sample@example.com' };
  const rendered = renderEmail(validation.subject, validation.body, sample);
  return { success: true, data: { ...rendered, sampleUserId: recipients[0]?.id ?? null } };
};

const testSendBroadcast = async (subject, body, adminEmail) => {
  const validation = validateInput(subject, body);
  if (!validation.valid) return { success: false, error: validation.error };
  if (!adminEmail) return { success: false, error: 'Admin email not configured (Settings → Admin Email)' };

  const sampleUser = getActiveRecipients()[0] || { firstName: 'Admin', lastName: '', email: adminEmail };
  const rendered = renderEmail(validation.subject, validation.body, sampleUser);

  const result = await getEmailService().sendMail({
    to: adminEmail,
    subject: `[TEST] ${rendered.subject}`,
    text: rendered.text,
    html: rendered.html,
  });

  if (!result.success) {
    logger.warn('Broadcast test-send failed', { adminEmail, error: result.error });
    return { success: false, error: result.error };
  }
  return { success: true, data: { sentTo: adminEmail } };
};

const getActiveBroadcast = () =>
  db.get('SELECT * FROM broadcasts WHERE status = \'sending\' LIMIT 1');

const getBroadcast = (id) => formatBroadcast(db.get('SELECT * FROM broadcasts WHERE id = ?', [id]));

const listBroadcasts = ({ limit = 20, offset = 0 } = {}) => {
  const rows = db.all(
    'SELECT * FROM broadcasts ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [Math.min(limit, 200), Math.max(offset, 0)]
  );
  return rows.map(formatBroadcast);
};

/**
 * Concurrency-limited async iteration. Calls fn(item) for every item with at
 * most `concurrency` parallel in-flight calls.
 */
const runWithConcurrency = async (items, concurrency, fn) => {
  let nextIndex = 0;
  const total = items.length;
  const worker = async () => {
    while (nextIndex < total) {
      const i = nextIndex++;
      await fn(items[i], i);
    }
  };
  const n = Math.min(concurrency, total);
  const workers = [];
  for (let i = 0; i < n; i++) workers.push(worker());
  await Promise.all(workers);
};

/**
 * Async fanout. Mutates the broadcast row as it progresses, transitions to
 * 'completed' at the end. Per-recipient errors are captured — never abort the loop.
 */
const runSenderLoop = async (broadcastId, subject, body, recipients) => {
  const failedRecipients = [];
  let sentCount = 0;
  let processed = 0;

  const flushProgress = () => {
    db.run(
      'UPDATE broadcasts SET sent_count = ?, failed_count = ?, failed_recipients = ? WHERE id = ?',
      [sentCount, failedRecipients.length, JSON.stringify(failedRecipients), broadcastId]
    );
  };

  try {
    await runWithConcurrency(recipients, SEND_CONCURRENCY, async (user) => {
      const rendered = renderEmail(subject, body, user);
      try {
        const result = await getEmailService().sendMail({
          to: user.email,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
        });
        if (result.success) {
          sentCount++;
        } else {
          failedRecipients.push({ userId: user.id, email: user.email, error: result.error });
        }
      } catch (err) {
        failedRecipients.push({ userId: user.id, email: user.email, error: err.message });
      }

      processed++;
      if (processed % PROGRESS_FLUSH_INTERVAL === 0) {
        flushProgress();
      }
    });
  } catch (err) {
    // Should never happen — runWithConcurrency itself doesn't throw because we catch
    // per-recipient. But defensively mark the broadcast as failed if it does.
    logger.error('Broadcast sender loop crashed', { broadcastId, error: err.message });
    db.run(
      `UPDATE broadcasts
         SET sent_count = ?, failed_count = ?, failed_recipients = ?,
             status = 'failed', finished_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [sentCount, failedRecipients.length, JSON.stringify(failedRecipients), broadcastId]
    );
    return;
  }

  db.run(
    `UPDATE broadcasts
       SET sent_count = ?,
           failed_count = ?,
           failed_recipients = ?,
           status = 'completed',
           finished_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [sentCount, failedRecipients.length, JSON.stringify(failedRecipients), broadcastId]
  );

  logger.info('Broadcast completed', {
    broadcastId,
    total: recipients.length,
    sent: sentCount,
    failed: failedRecipients.length,
  });
};

/**
 * Insert broadcast row and kick off async send loop. Returns 'BROADCAST_IN_PROGRESS'
 * if another broadcast is already running.
 *
 * @param {string} subject
 * @param {string} body
 * @param {Object} adminUser - { id, username }
 * @param {Object} [opts]
 * @param {number|null} [opts.originBroadcastId]
 * @param {Array}       [opts.recipientsOverride]
 */
const startBroadcast = (subject, body, adminUser, opts = {}) => {
  const validation = validateInput(subject, body);
  if (!validation.valid) return { success: false, error: validation.error };
  if (!adminUser || !adminUser.id) {
    return { success: false, error: 'Admin user required' };
  }

  const recipients = opts.recipientsOverride ?? getActiveRecipients();
  if (recipients.length === 0) {
    return { success: false, error: 'No active recipients' };
  }

  let broadcastId;
  try {
    db.transaction(() => {
      const inFlight = getActiveBroadcast();
      if (inFlight) throw new Error('BROADCAST_IN_PROGRESS');

      const insert = db.run(
        `INSERT INTO broadcasts
           (subject, body, status, total_count, origin_broadcast_id, sent_by_admin_id, started_at)
         VALUES (?, ?, 'sending', ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          validation.subject,
          validation.body,
          recipients.length,
          opts.originBroadcastId ?? null,
          adminUser.id,
        ]
      );
      broadcastId = insert.lastInsertRowid;

      const oldValue = opts.originBroadcastId ? String(opts.originBroadcastId) : null;
      db.run(
        `INSERT INTO audit_log (user_id, action, old_value, new_value, amount, performed_by)
         VALUES (NULL, 'broadcast_email', ?, ?, ?, 'admin')`,
        [oldValue, validation.subject, recipients.length]
      );
    });
  } catch (err) {
    if (err.message === 'BROADCAST_IN_PROGRESS') {
      return { success: false, error: 'BROADCAST_IN_PROGRESS' };
    }
    logger.error('Failed to create broadcast', { error: err.message });
    return { success: false, error: 'Failed to create broadcast' };
  }

  setImmediate(() => {
    runSenderLoop(broadcastId, validation.subject, validation.body, recipients).catch((err) => {
      logger.error('Unhandled broadcast loop error', { broadcastId, error: err.message });
    });
  });

  return { success: true, data: { broadcastId } };
};

/**
 * Resend an existing broadcast to its currently-failed recipients. Creates a
 * NEW broadcast row referencing the original via origin_broadcast_id.
 */
const resendFailed = (originalId, adminUser) => {
  const original = getBroadcast(originalId);
  if (!original) return { success: false, error: 'Broadcast not found' };
  if (original.failedCount === 0) return { success: false, error: 'No failed recipients to resend to' };
  if (original.status === 'sending') return { success: false, error: 'Original broadcast still in progress' };

  // Re-fetch active users for the failed list. Soft-deleted users are skipped;
  // email may have changed, so we use the current address.
  const failedIds = original.failedRecipients
    .map((f) => f.userId)
    .filter((id) => id != null);

  if (failedIds.length === 0) {
    return { success: false, error: 'No resolvable failed user IDs' };
  }

  const allActive = getActiveRecipients();
  const activeById = new Map(allActive.map((u) => [u.id, u]));
  const recipients = failedIds.map((id) => activeById.get(id)).filter(Boolean);

  if (recipients.length === 0) {
    return { success: false, error: 'All failed recipients are no longer active' };
  }

  return startBroadcast(original.subject, original.body, adminUser, {
    originBroadcastId: original.id,
    recipientsOverride: recipients,
  });
};

/**
 * Boot-time recovery: any broadcast still flagged 'sending' when the server
 * starts didn't survive a restart. Mark it 'interrupted' so the admin can
 * decide whether to resend.
 */
const recoverInterruptedBroadcasts = () => {
  try {
    const result = db.run(
      `UPDATE broadcasts
         SET status = 'interrupted', finished_at = CURRENT_TIMESTAMP
       WHERE status = 'sending'`
    );
    if (result.changes > 0) {
      logger.warn('Marked interrupted broadcasts on boot', { count: result.changes });
    }
    return { success: true, recovered: result.changes };
  } catch (err) {
    logger.error('Boot recovery failed', { error: err.message });
    return { success: false, error: err.message };
  }
};

module.exports = {
  // Public service API
  previewBroadcast,
  testSendBroadcast,
  startBroadcast,
  resendFailed,
  getBroadcast,
  listBroadcasts,
  getActiveBroadcast,
  getActiveRecipients,
  recoverInterruptedBroadcasts,

  // Exposed for testing
  substitute,
  renderEmail,
  validateInput,
  runWithConcurrency,
  runSenderLoop,
};
