/**
 * Bounce processor: connects to a configured IMAP mailbox, scans for
 * Delivery Status Notifications (DSN), and matches them back to outgoing
 * `emails` rows via the X-Coffee-Email-Id header we set on send.
 *
 * Bounced messages are moved into a separate folder after processing so they
 * are never deleted, and normal (non-bounce) mail in the inbox is left
 * completely untouched.
 *
 * The worker stays idle whenever imap_host is unset, which is the default —
 * so this feature is opt-in via the Settings UI / .env without breaking
 * deployments that haven't configured it yet.
 */

const db = require('../db/database');
const logger = require('../utils/logger');
const settingsService = require('./settingsService');

// Lazy-loaded so module load doesn't fail when imapflow/mailparser aren't
// installed in the test environment (they aren't pulled by the test helpers).
let ImapFlow = null;
let simpleParser = null;

const loadDeps = () => {
  if (!ImapFlow) ImapFlow = require('imapflow').ImapFlow;
  if (!simpleParser) simpleParser = require('mailparser').simpleParser;
};

// Heuristic match for non-RFC-3464 bounces (postmaster replies, etc.).
const BOUNCE_FROM_REGEX = /(mailer-daemon|postmaster|mail delivery|mail-daemon)/i;
const BOUNCE_SUBJECT_REGEX = /(failed|undelivered|undeliverable|returned|bounce|rejected|delivery status|not delivered)/i;

let pollTimer = null;
let inFlight = false;

/**
 * Read IMAP settings from the DB. Returns null when polling is disabled
 * (i.e. imap_host is empty).
 */
const getImapConfig = () => {
  const host = (settingsService.getSetting('imap_host') || '').trim();
  if (!host) return null;

  const port = parseInt(settingsService.getSetting('imap_port') || '993', 10) || 993;
  const secure = (settingsService.getSetting('imap_secure') || 'true') === 'true';
  // Fall back to SMTP credentials when IMAP-specific ones are blank — most
  // setups use the same mailbox account for sending and receiving bounces.
  const user = settingsService.getSetting('imap_user') || settingsService.getSetting('smtp_user') || '';
  const pass = settingsService.getSetting('imap_pass') || settingsService.getSetting('smtp_pass') || '';
  const inboxFolder = settingsService.getSetting('imap_inbox_folder') || 'INBOX';
  const processedFolder = settingsService.getSetting('imap_processed_folder') || 'Processed-Bounces';
  const intervalMin = parseInt(settingsService.getSetting('imap_poll_interval_minutes') || '5', 10) || 5;

  return { host, port, secure, user, pass, inboxFolder, processedFolder, intervalMin };
};

/**
 * Decide whether a parsed message looks like a delivery-failure report.
 */
const classifyAsBounce = (parsed) => {
  const contentTypeHeader = parsed.headers?.get('content-type');
  const contentType = typeof contentTypeHeader === 'string'
    ? contentTypeHeader.toLowerCase()
    : (contentTypeHeader?.value || '').toLowerCase();

  if (contentType.includes('multipart/report')) {
    return { isBounce: true, kind: 'dsn' };
  }

  const fromText = parsed.from?.text || '';
  const subject = parsed.subject || '';
  if (BOUNCE_FROM_REGEX.test(fromText) && BOUNCE_SUBJECT_REGEX.test(subject)) {
    return { isBounce: true, kind: 'heuristic' };
  }

  return { isBounce: false };
};

/**
 * Parse a small block of RFC-822-style headers into a flat key→value map
 * (lowercase keys, first value wins). Used for the message/delivery-status
 * attachment of a DSN.
 */
const parseDsnFields = (raw) => {
  const out = {};
  if (!raw) return out;
  const text = typeof raw === 'string' ? raw : raw.toString('utf8');
  // Unfold continuation lines (RFC 5322): a line starting with whitespace
  // belongs to the previous header.
  const unfolded = text.replace(/\r?\n[ \t]+/g, ' ');
  for (const line of unfolded.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z][A-Za-z0-9-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (!(key in out)) out[key] = m[2].trim();
  }
  return out;
};

/**
 * Extract our tracking-id from a DSN payload. Two places to look:
 *  1. message/rfc822 part — the original outbound message with our header.
 *  2. message/delivery-status doesn't carry it directly, but the
 *     human-readable text part often quotes the original headers.
 */
const extractTrackingId = (parsed) => {
  // Iterate over all attachments (mailparser puts message/* parts here).
  const atts = parsed.attachments || [];

  for (const a of atts) {
    const ct = (a.contentType || '').toLowerCase();
    if (ct.startsWith('message/rfc822')) {
      const text = a.content ? a.content.toString('utf8') : '';
      // Don't fully parse — a regex over the headers section is enough and
      // cheaper. Headers end at the first blank line.
      const headersBlock = text.split(/\r?\n\r?\n/)[0] || text;
      const m = headersBlock.match(/^X-Coffee-Email-Id\s*:\s*([^\r\n]+)/im);
      if (m) return m[1].trim();
    }
  }

  // Fallback: scan the full text body (some MTAs paste original headers into
  // the human-readable part instead of attaching message/rfc822).
  const body = (parsed.text || '') + '\n' + (parsed.html || '');
  const m = body.match(/X-Coffee-Email-Id\s*:\s*([0-9a-fA-F-]{36})/);
  return m ? m[1].trim() : null;
};

/**
 * Extract DSN status info from a parsed bounce.
 *
 * mailparser folds the `message/delivery-status` MIME part into `parsed.text`
 * rather than exposing it as a discrete attachment, so we parse the whole
 * text body. parseDsnFields' regex requires a single-word header name,
 * which keeps it from matching prose lines that happen to contain a colon
 * (`SMTP error from remote mail server after RCPT TO: ...`).
 *
 * If a delivery-status part ever does appear as an attachment (some MTAs),
 * we still prefer it because it's the canonical machine-readable source.
 */
const extractDsnInfo = (parsed) => {
  let code = null;
  let reason = null;
  let finalRecipient = null;

  const atts = parsed.attachments || [];
  for (const a of atts) {
    const ct = (a.contentType || '').toLowerCase();
    if (ct.startsWith('message/delivery-status')) {
      const fields = parseDsnFields(a.content);
      code = fields.status || code;
      reason = fields['diagnostic-code'] || reason;
      finalRecipient = fields['final-recipient'] || finalRecipient;
      break;
    }
  }

  if (!code || !reason || !finalRecipient) {
    const bodyFields = parseDsnFields(parsed.text || '');
    code = code || bodyFields.status || null;
    reason = reason || bodyFields['diagnostic-code'] || null;
    finalRecipient = finalRecipient || bodyFields['final-recipient'] || null;
  }

  // Last-resort fallback for non-RFC-3464 bounces: take the subject as the
  // reason so the admin sees *something* in the UI.
  if (!reason && parsed.subject) {
    reason = parsed.subject;
  }

  return { code, reason, finalRecipient };
};

const codeToStatus = (code) => {
  if (typeof code !== 'string') return 'bounced_hard';
  if (code.startsWith('4')) return 'bounced_soft';
  return 'bounced_hard';
};

/**
 * Connect, fetch, classify, update DB, move bounces. Safe to call repeatedly;
 * concurrent invocations are coalesced via the inFlight guard.
 */
const processOnce = async () => {
  if (inFlight) {
    logger.info('Bounce processor: skipping run, previous still in flight');
    return { success: false, error: 'in-flight' };
  }
  const config = getImapConfig();
  if (!config) return { success: false, error: 'disabled' };

  loadDeps();
  inFlight = true;

  let client = null;
  let processed = 0;
  let matched = 0;
  let unmatched = 0;

  try {
    client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.pass },
      logger: false,
    });
    await client.connect();

    // Ensure target folder exists. mailboxCreate throws if it already does,
    // so swallow that case.
    try {
      await client.mailboxCreate(config.processedFolder);
    } catch (_err) { /* already exists — fine */ }

    const lock = await client.getMailboxLock(config.inboxFolder);
    const bounceUids = [];

    try {
      // SEARCH for unseen messages, then fetch their source. imapflow's
      // fetch() with { seen: false } combines these into one round-trip.
      for await (const msg of client.fetch({ seen: false }, { source: true, envelope: true, uid: true })) {
        processed++;
        let parsed;
        try {
          parsed = await simpleParser(msg.source);
        } catch (err) {
          logger.warn('Bounce processor: parse failed, leaving message unread', {
            uid: msg.uid,
            error: err.message,
          });
          continue;
        }

        const classification = classifyAsBounce(parsed);
        if (!classification.isBounce) {
          // Crucial: leave non-bounce mail untouched (not marked seen, not moved).
          continue;
        }

        const trackingId = extractTrackingId(parsed);
        const { code, reason, finalRecipient } = extractDsnInfo(parsed);
        const status = codeToStatus(code);

        if (trackingId) {
          try {
            const result = db.run(
              `UPDATE emails
                  SET status = ?, bounce_code = ?, bounce_reason = ?, bounced_at = CURRENT_TIMESTAMP
                WHERE tracking_id = ?`,
              [status, code, reason, trackingId]
            );
            if (result.changes > 0) {
              matched++;
              logger.info('Bounce matched', {
                trackingId,
                status,
                code,
                finalRecipient,
                uid: msg.uid,
              });
            } else {
              unmatched++;
              logger.warn('Bounce tracking-id has no matching email row', {
                trackingId,
                code,
                finalRecipient,
                uid: msg.uid,
              });
            }
          } catch (err) {
            logger.error('Failed to record bounce', { error: err.message, trackingId });
          }
        } else {
          unmatched++;
          logger.warn('Bounce detected but tracking-id not extractable', {
            uid: msg.uid,
            subject: parsed.subject,
            kind: classification.kind,
            finalRecipient,
          });
        }

        bounceUids.push(msg.uid);
      }
    } finally {
      lock.release();
    }

    if (bounceUids.length > 0) {
      try {
        await client.messageMove(bounceUids, config.processedFolder, { uid: true });
      } catch (err) {
        logger.error('Failed to move processed bounces', {
          error: err.message,
          count: bounceUids.length,
        });
      }
    }

    logger.info('Bounce processor run complete', {
      processed,
      bounces: bounceUids.length,
      matched,
      unmatched,
    });

    return { success: true, processed, matched, unmatched };
  } catch (err) {
    logger.error('Bounce processor run failed', { error: err.message });
    return { success: false, error: err.message };
  } finally {
    if (client) {
      try {
        await client.logout();
      } catch (_err) { /* ignore */ }
    }
    inFlight = false;
  }
};

/**
 * Start periodic polling. Idempotent — calling start() while already running
 * resets the timer with the current config interval.
 */
const start = () => {
  stop();
  const config = getImapConfig();
  if (!config) {
    logger.info('Bounce processor disabled (imap_host not configured)');
    return;
  }

  const intervalMs = Math.max(1, config.intervalMin) * 60 * 1000;
  logger.info('Bounce processor starting', {
    host: config.host,
    inbox: config.inboxFolder,
    intervalMin: config.intervalMin,
  });

  // Kick off an initial run after a small delay so server startup isn't
  // blocked or noisy if IMAP is slow/unreachable.
  setTimeout(() => {
    processOnce().catch((err) => {
      logger.error('Initial bounce processor run errored', { error: err.message });
    });
  }, 5000);

  pollTimer = setInterval(() => {
    processOnce().catch((err) => {
      logger.error('Bounce processor tick errored', { error: err.message });
    });
  }, intervalMs);
};

const stop = () => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
};

/**
 * Diagnostic helper for the admin UI. Connects to the configured IMAP
 * mailbox, opens the inbox folder, reports counts, and disconnects.
 *
 * It does NOT modify the mailbox in any way (no fetch with mark-as-seen,
 * no move, no delete). Safe to call on a live mailbox.
 *
 * Returns a flat object suitable for JSON responses:
 *   {
 *     success: true,
 *     host, port, secure, user, inboxFolder, processedFolder,
 *     processedFolderExists,
 *     totalMessages, unseenMessages
 *   }
 * or { success: false, error: '...' } on failure.
 */
const testConnection = async () => {
  const config = getImapConfig();
  if (!config) {
    return { success: false, error: 'IMAP host not configured' };
  }

  loadDeps();

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    logger: false,
  });

  try {
    await client.connect();

    const boxes = await client.list();
    const processedFolderExists = boxes.some((b) => b.path === config.processedFolder);

    // Collect message/unseen counts for every folder so the operator can
    // see at a glance where bounces might be hiding (e.g. provider auto-
    // sorting into Junk/Bounces/Quarantine on Exchange-style servers).
    // Some folders are non-selectable containers — for those, status()
    // throws; we surface them with null counts rather than aborting.
    const folders = [];
    for (const box of boxes) {
      try {
        const status = await client.status(box.path, { messages: true, unseen: true });
        folders.push({
          path: box.path,
          messages: status.messages ?? 0,
          unseen: status.unseen ?? 0,
        });
      } catch (_err) {
        folders.push({ path: box.path, messages: null, unseen: null });
      }
    }

    // Inbox-specific counts kept for the toast summary (legacy contract).
    const inboxFolder = folders.find((f) => f.path === config.inboxFolder);
    const totalMessages = inboxFolder?.messages ?? 0;
    const unseenMessages = inboxFolder?.unseen ?? 0;

    return {
      success: true,
      host: config.host,
      port: config.port,
      secure: config.secure,
      user: config.user,
      inboxFolder: config.inboxFolder,
      processedFolder: config.processedFolder,
      processedFolderExists,
      totalMessages,
      unseenMessages,
      folders,
    };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    try {
      await client.logout();
    } catch (_err) { /* ignore */ }
  }
};

/**
 * Diagnostic helper for the admin UI. Reads the first few unseen messages
 * read-only and reports the classification-relevant fields for each.
 *
 * Use this when "Run Bounce Check Now" returns processed > 0 but matched +
 * unmatched == 0 — meaning a message is there but classifyAsBounce isn't
 * recognizing it. The output lets the operator (or us, later) see exactly
 * which headers the provider chose for its DSN-like reply.
 *
 * Read-only: no flag changes, no folder moves.
 *
 * @param {number} [limit=5] - Max number of messages to inspect.
 */
const inspectUnread = async (limit = 5) => {
  const config = getImapConfig();
  if (!config) {
    return { success: false, error: 'IMAP host not configured' };
  }

  loadDeps();

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    logger: false,
  });

  const inspected = [];

  try {
    await client.connect();
    const lock = await client.getMailboxLock(config.inboxFolder, { readonly: true });

    try {
      let collected = 0;
      for await (const msg of client.fetch({ seen: false }, { source: true, envelope: true, uid: true })) {
        if (collected >= limit) break;
        collected++;

        let parsed;
        try {
          parsed = await simpleParser(msg.source);
        } catch (err) {
          inspected.push({ uid: msg.uid, parseError: err.message });
          continue;
        }

        const contentTypeHeader = parsed.headers?.get('content-type');
        const contentType = typeof contentTypeHeader === 'string'
          ? contentTypeHeader
          : (contentTypeHeader?.value || '');

        const returnPathHeader = parsed.headers?.get('return-path');
        const returnPath = typeof returnPathHeader === 'string'
          ? returnPathHeader
          : (returnPathHeader?.text || returnPathHeader?.value || '');

        const autoSubmitted = parsed.headers?.get('auto-submitted') || '';

        const classification = classifyAsBounce(parsed);
        const trackingId = extractTrackingId(parsed);
        const dsn = extractDsnInfo(parsed);

        const attachmentTypes = (parsed.attachments || [])
          .map((a) => a.contentType)
          .filter(Boolean);

        const body = parsed.text || '';
        const bodySnippet = body.length > 500 ? body.slice(0, 500) + '…' : body;

        inspected.push({
          uid: msg.uid,
          subject: parsed.subject || '(no subject)',
          from: parsed.from?.text || '(no from)',
          contentType,
          returnPath,
          autoSubmitted: typeof autoSubmitted === 'string' ? autoSubmitted : (autoSubmitted?.value || ''),
          classifiedAsBounce: classification.isBounce,
          classificationKind: classification.kind || null,
          trackingIdFound: trackingId,
          dsnCode: dsn.code,
          dsnReason: dsn.reason,
          attachmentContentTypes: attachmentTypes,
          bodySnippet,
        });
      }
    } finally {
      lock.release();
    }

    return { success: true, count: inspected.length, messages: inspected };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    try {
      await client.logout();
    } catch (_err) { /* ignore */ }
  }
};

module.exports = {
  start,
  stop,
  processOnce,
  testConnection,
  inspectUnread,

  // Exported for tests
  classifyAsBounce,
  parseDsnFields,
  extractTrackingId,
  extractDsnInfo,
  codeToStatus,
};
