const crypto = require('crypto');
const nodemailer = require('nodemailer');
const db = require('../db/database');
const logger = require('../utils/logger');
const settingsService = require('./settingsService');

// Reusable transporter, lazily created and rebuilt when SMTP config changes.
let transporter = null;
let lastSmtpConfig = null;

/**
 * Get SMTP configuration from database settings (with env fallback)
 */
const getSmtpConfig = () => {
  return {
    host: settingsService.getSetting('smtp_host') || process.env.SMTP_HOST,
    port: parseInt(settingsService.getSetting('smtp_port') || process.env.SMTP_PORT, 10) || 587,
    secure: (settingsService.getSetting('smtp_secure') || process.env.SMTP_SECURE) === 'true',
    user: settingsService.getSetting('smtp_user') || process.env.SMTP_USER,
    pass: settingsService.getSetting('smtp_pass') || process.env.SMTP_PASS,
    from: settingsService.getSetting('smtp_from') || process.env.SMTP_FROM || '"CofFeEL System" <coffee@example.com>',
  };
};

/**
 * Get or create email transporter
 * Recreates transporter if config has changed
 * @returns {Object} Nodemailer transporter
 */
const getTransporter = () => {
  const config = getSmtpConfig();
  const configKey = JSON.stringify({ host: config.host, port: config.port, user: config.user });

  if (!transporter || lastSmtpConfig !== configKey) {
    if (transporter) {
      transporter.close();
    }
    transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user ? {
        user: config.user,
        pass: config.pass,
      } : undefined,
    });
    lastSmtpConfig = configKey;
  }
  return transporter;
};

const TRACKING_HEADER = 'X-Coffee-Email-Id';

/**
 * Insert an `emails` row before send, send via SMTP with the tracking header,
 * then update the row with the SMTP outcome. Returns the same shape as the
 * legacy callers expect: { success, messageId } | { success: false, error }.
 *
 * @param {Object} opts
 * @param {string} opts.to               — recipient address
 * @param {string} opts.subject
 * @param {string} opts.text
 * @param {string} opts.html
 * @param {string} [opts.cc]
 * @param {string} [opts.replyTo]
 * @param {number|null} [opts.userId]    — null for test/preview mails
 * @param {string} opts.emailType        — 'payment_request' | 'welcome' | 'broadcast' | 'test'
 * @param {number|null} [opts.broadcastId]
 */
const sendAndLog = async (opts) => {
  const smtpConfig = getSmtpConfig();
  if (!smtpConfig.host) {
    return { success: false, error: 'SMTP host not configured' };
  }

  const trackingId = crypto.randomUUID();

  // Best-effort log row. If this fails we still try to send — losing tracking
  // is preferable to losing the user-visible email.
  try {
    db.run(
      `INSERT INTO emails
         (tracking_id, user_id, recipient_email, email_type, broadcast_id, subject, status)
       VALUES (?, ?, ?, ?, ?, ?, 'sent')`,
      [
        trackingId,
        opts.userId ?? null,
        opts.to,
        opts.emailType,
        opts.broadcastId ?? null,
        opts.subject ?? null,
      ]
    );
  } catch (err) {
    logger.warn('Failed to log outgoing email pre-send', { error: err.message, to: opts.to });
  }

  const mailOptions = {
    from: smtpConfig.from,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
    headers: { [TRACKING_HEADER]: trackingId },
  };
  if (opts.cc) mailOptions.cc = opts.cc;
  if (opts.replyTo) mailOptions.replyTo = opts.replyTo;

  try {
    const info = await getTransporter().sendMail(mailOptions);

    const rejectedJson = info.rejected && info.rejected.length > 0
      ? JSON.stringify(info.rejected)
      : null;
    const acceptedJson = info.accepted && info.accepted.length > 0
      ? JSON.stringify(info.accepted)
      : null;
    const status = rejectedJson ? 'rejected_smtp' : 'sent';

    try {
      db.run(
        `UPDATE emails
            SET status = ?,
                message_id = ?,
                smtp_response = ?,
                smtp_accepted = ?,
                smtp_rejected = ?
          WHERE tracking_id = ?`,
        [status, info.messageId || null, info.response || null, acceptedJson, rejectedJson, trackingId]
      );
    } catch (err) {
      logger.warn('Failed to update email log post-send', { error: err.message, trackingId });
    }

    if (status === 'rejected_smtp') {
      return { success: false, error: `SMTP rejected recipient(s): ${rejectedJson}`, trackingId };
    }
    return { success: true, messageId: info.messageId, trackingId };
  } catch (err) {
    try {
      db.run(
        'UPDATE emails SET status = \'send_failed\', smtp_response = ? WHERE tracking_id = ?',
        [err.message, trackingId]
      );
    } catch (innerErr) {
      logger.warn('Failed to update email log after send error', { error: innerErr.message, trackingId });
    }
    return { success: false, error: err.message, trackingId };
  }
};

/**
 * Send payment request email
 * @param {Object} user - User object
 * @param {number} coffeeCount - Number of coffees
 * @param {number} amount - Total amount to pay
 * @returns {Object} Result with success status
 */
const sendPaymentRequest = async (user, coffeeCount, amount) => {
  const bankDetails = settingsService.getBankDetails();
  const adminEmail = settingsService.getAdminEmail();
  const coffeePrice = settingsService.getCoffeePrice();

  const emailContent = generatePaymentRequestEmail(
    user,
    coffeeCount,
    amount,
    coffeePrice,
    bankDetails
  );

  const subject = `Coffee Payment Request - ${coffeeCount} coffees`;
  const result = await sendAndLog({
    to: user.email,
    cc: adminEmail,
    subject,
    text: emailContent.text,
    html: emailContent.html,
    userId: user.id,
    emailType: 'payment_request',
  });

  if (result.success) {
    logger.info('Payment request email sent', {
      userId: user.id,
      email: user.email,
      amount,
      messageId: result.messageId,
    });
  } else {
    logger.error('Failed to send payment request email', {
      error: result.error,
      userId: user.id,
      email: user.email,
    });
  }
  return result;
};

/**
 * Generate payment request email content
 * @param {Object} user - User object
 * @param {number} coffeeCount - Number of coffees
 * @param {number} amount - Total amount
 * @param {number} coffeePrice - Price per coffee
 * @param {Object} bankDetails - Bank details
 * @returns {Object} Email content with text and html
 */
const generatePaymentRequestEmail = (user, coffeeCount, amount, coffeePrice, bankDetails) => {
  const paymentReference = `Coffee - ${user.firstName} ${user.lastName}`;

  const text = `
Hello ${user.firstName},

This is a payment request for your coffee consumption.

=== Coffee Summary ===
Coffees consumed: ${coffeeCount}
Price per coffee: €${coffeePrice.toFixed(2)}
Total amount due: €${amount.toFixed(2)}

=== Payment Details ===
Bank: ${bankDetails.owner}
IBAN: ${bankDetails.iban}
BIC: ${bankDetails.bic}
Reference: ${paymentReference}

Please transfer the amount to the account above.

Thank you for your payment!

---
CofFeEL - Coffee Tracking System
This is an automated message.
`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #2563eb; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }
    .summary { background: white; padding: 15px; border-radius: 8px; margin: 15px 0; }
    .bank-details { background: #eff6ff; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #2563eb; }
    .amount { font-size: 24px; font-weight: bold; color: #2563eb; }
    .footer { padding: 15px; text-align: center; color: #6b7280; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 8px 0; }
    .label { color: #6b7280; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">☕ Coffee Payment Request</h1>
    </div>
    <div class="content">
      <p>Hello ${user.firstName},</p>
      <p>This is a payment request for your coffee consumption.</p>

      <div class="summary">
        <h3 style="margin-top: 0;">Coffee Summary</h3>
        <table>
          <tr>
            <td class="label">Coffees consumed:</td>
            <td><strong>${coffeeCount}</strong></td>
          </tr>
          <tr>
            <td class="label">Price per coffee:</td>
            <td>€${coffeePrice.toFixed(2)}</td>
          </tr>
          <tr>
            <td class="label">Total amount due:</td>
            <td class="amount">€${amount.toFixed(2)}</td>
          </tr>
        </table>
      </div>

      <div class="bank-details">
        <h3 style="margin-top: 0;">Payment Details</h3>
        <table>
          <tr>
            <td class="label">Bank:</td>
            <td><strong>${bankDetails.owner}</strong></td>
          </tr>
          <tr>
            <td class="label">IBAN:</td>
            <td><code>${bankDetails.iban}</code></td>
          </tr>
          <tr>
            <td class="label">BIC:</td>
            <td><code>${bankDetails.bic}</code></td>
          </tr>
          <tr>
            <td class="label">Reference:</td>
            <td><strong>${paymentReference}</strong></td>
          </tr>
        </table>
      </div>

      <p>Please transfer the amount to the account above.</p>
      <p>Thank you for your payment!</p>
    </div>
    <div class="footer">
      <p>CofFeEL - Coffee Tracking System<br>This is an automated message.</p>
    </div>
  </div>
</body>
</html>
`;

  return { text, html };
};

/**
 * Send payment request email (amount-based, no coffee count)
 * @param {Object} user - User object
 * @param {number} amount - Total amount to pay
 * @returns {Object} Result with success status
 */
const sendPaymentRequestByAmount = async (user, amount) => {
  const bankDetails = settingsService.getBankDetails();
  const adminEmail = settingsService.getAdminEmail();

  const emailContent = generatePaymentRequestEmailByAmount(
    user,
    amount,
    bankDetails
  );

  const subject = `Coffee Payment Request - €${amount.toFixed(2)}`;
  const result = await sendAndLog({
    to: user.email,
    cc: adminEmail,
    subject,
    text: emailContent.text,
    html: emailContent.html,
    userId: user.id,
    emailType: 'payment_request',
  });

  if (result.success) {
    logger.info('Payment request email sent', {
      userId: user.id,
      email: user.email,
      amount,
      messageId: result.messageId,
    });
  } else {
    logger.error('Failed to send payment request email', {
      error: result.error,
      userId: user.id,
      email: user.email,
    });
  }
  return result;
};

/**
 * Generate payment request email content (amount-based)
 */
const generatePaymentRequestEmailByAmount = (user, amount, bankDetails) => {
  const paymentReference = `Coffee - ${user.firstName} ${user.lastName}`;

  const text = `
Hello ${user.firstName},

This is a payment request for your coffee consumption.

=== Payment Summary ===
Amount due: €${amount.toFixed(2)}

=== Payment Details ===
Bank: ${bankDetails.owner}
IBAN: ${bankDetails.iban}
BIC: ${bankDetails.bic}
Reference: ${paymentReference}

Please transfer the amount to the account above.

Thank you for your payment!

---
CofFeEL - Coffee Tracking System
This is an automated message.
`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #8b5a2b; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #faf8f5; padding: 20px; border: 1px solid #c9ad8c; }
    .summary { background: white; padding: 15px; border-radius: 8px; margin: 15px 0; }
    .bank-details { background: #f5ebe0; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #8b5a2b; }
    .amount { font-size: 24px; font-weight: bold; color: #8b5a2b; }
    .footer { padding: 15px; text-align: center; color: #7a5f45; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 8px 0; }
    .label { color: #7a5f45; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">☕ Coffee Payment Request</h1>
    </div>
    <div class="content">
      <p>Hello ${user.firstName},</p>
      <p>This is a payment request for your coffee consumption.</p>

      <div class="summary">
        <h3 style="margin-top: 0;">Amount Due</h3>
        <p class="amount">€${amount.toFixed(2)}</p>
      </div>

      <div class="bank-details">
        <h3 style="margin-top: 0;">Payment Details</h3>
        <table>
          <tr>
            <td class="label">Bank:</td>
            <td><strong>${bankDetails.owner}</strong></td>
          </tr>
          <tr>
            <td class="label">IBAN:</td>
            <td><code>${bankDetails.iban}</code></td>
          </tr>
          <tr>
            <td class="label">BIC:</td>
            <td><code>${bankDetails.bic}</code></td>
          </tr>
          <tr>
            <td class="label">Reference:</td>
            <td><strong>${paymentReference}</strong></td>
          </tr>
        </table>
      </div>

      <p>Please transfer the amount to the account above.</p>
      <p>Thank you for your payment!</p>
    </div>
    <div class="footer">
      <p>CofFeEL - Coffee Tracking System<br>This is an automated message.</p>
    </div>
  </div>
</body>
</html>
`;

  return { text, html };
};

/**
 * Send welcome email to new or reactivated user
 * @param {Object} user - User object
 * @param {boolean} isReactivation - Whether this is a reactivation (vs new registration)
 * @returns {Object} Result with success status
 */
const sendWelcomeEmail = async (user, isReactivation = false) => {
  const coffeePrice = settingsService.getCoffeePrice();
  const adminEmail = settingsService.getAdminEmail();

  const emailContent = generateWelcomeEmail(user, coffeePrice, isReactivation);

  const subject = isReactivation
    ? `Welcome back to CofFeEL, ${user.firstName}!`
    : `Welcome to CofFeEL, ${user.firstName}!`;

  const result = await sendAndLog({
    to: user.email,
    cc: adminEmail,
    subject,
    text: emailContent.text,
    html: emailContent.html,
    userId: user.id,
    emailType: 'welcome',
  });

  if (result.success) {
    logger.info('Welcome email sent', {
      userId: user.id,
      email: user.email,
      isReactivation,
      messageId: result.messageId,
    });
  } else {
    logger.error('Failed to send welcome email', {
      error: result.error,
      userId: user.id,
      email: user.email,
    });
  }
  return result;
};

/**
 * Generate welcome email content
 */
const generateWelcomeEmail = (user, coffeePrice, isReactivation) => {
  const greeting = isReactivation ? 'Welcome back' : 'Welcome';
  const intro = isReactivation
    ? 'Your account has been reactivated. We\'re glad to have you back!'
    : 'Your account has been created. You can now start tracking your coffee consumption!';

  const text = `
${greeting} ${user.firstName}!

${intro}

=== How It Works ===
1. Find your name in the kiosk
2. Tap + when you take a coffee
3. Tap "Pay" when you're ready to settle your tab
4. Transfer the amount to our bank account

=== Current Coffee Price ===
€${coffeePrice.toFixed(2)} per cup

Enjoy your coffee!

---
CofFeEL - Coffee Tracking System
This is an automated message.
`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #8b5a2b; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #faf8f5; padding: 20px; border: 1px solid #c9ad8c; }
    .info-box { background: white; padding: 15px; border-radius: 8px; margin: 15px 0; }
    .price-box { background: #f5ebe0; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #8b5a2b; text-align: center; }
    .price { font-size: 28px; font-weight: bold; color: #8b5a2b; }
    .footer { padding: 15px; text-align: center; color: #7a5f45; font-size: 12px; }
    ol { padding-left: 20px; }
    li { margin: 8px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">☕ ${greeting} to CofFeEL!</h1>
    </div>
    <div class="content">
      <p>Hello ${user.firstName},</p>
      <p>${intro}</p>

      <div class="info-box">
        <h3 style="margin-top: 0;">How It Works</h3>
        <ol>
          <li>Find your name in the kiosk</li>
          <li>Tap <strong>+</strong> when you take a coffee</li>
          <li>Tap <strong>Pay</strong> when you're ready to settle your tab</li>
          <li>Transfer the amount to our bank account</li>
        </ol>
      </div>

      <div class="price-box">
        <p style="margin: 0; color: #7a5f45;">Current Coffee Price</p>
        <p class="price" style="margin: 5px 0;">€${coffeePrice.toFixed(2)}</p>
        <p style="margin: 0; color: #7a5f45; font-size: 14px;">per cup</p>
      </div>

      <p>Enjoy your coffee! ☕</p>
    </div>
    <div class="footer">
      <p>CofFeEL - Coffee Tracking System<br>This is an automated message.</p>
    </div>
  </div>
</body>
</html>
`;

  return { text, html };
};

/**
 * Verify SMTP connection
 * @returns {Object} Result with success status
 */
const verifyConnection = async () => {
  try {
    const transport = getTransporter();
    await transport.verify();
    logger.info('SMTP connection verified');
    return { success: true };
  } catch (err) {
    logger.error('SMTP connection failed', { error: err.message });
    return { success: false, error: err.message };
  }
};

/**
 * Reset transporter (for testing or config changes)
 */
const resetTransporter = () => {
  if (transporter) {
    transporter.close();
    transporter = null;
    lastSmtpConfig = null;
  }
};

/**
 * Generic SMTP send used by broadcasts and any other caller that needs raw
 * email sending without domain-specific templating. Defaults emailType to
 * 'broadcast' since that's the only caller today.
 *
 * @param {Object} opts
 * @param {string} opts.to
 * @param {string} opts.subject
 * @param {string} opts.text
 * @param {string} opts.html
 * @param {string} [opts.replyTo]
 * @param {string} [opts.cc]
 * @param {number|null} [opts.userId]
 * @param {string} [opts.emailType='broadcast']
 * @param {number|null} [opts.broadcastId]
 */
const sendMail = async ({ to, subject, text, html, replyTo, cc, userId, emailType = 'broadcast', broadcastId }) =>
  sendAndLog({
    to,
    subject,
    text,
    html,
    replyTo,
    cc,
    userId,
    emailType,
    broadcastId,
  });

/**
 * Send a test email to verify SMTP configuration
 * @param {string} toEmail - Email address to send test to
 * @returns {Object} Result with success status
 */
const sendTestEmail = async (toEmail) => {
  const result = await sendAndLog({
    to: toEmail,
    subject: 'CofFeEL SMTP Test',
    text: 'This is a test email from CofFeEL to verify your SMTP configuration is working correctly.',
    html: `
      <div style="font-family: sans-serif; padding: 20px;">
        <h2>☕ CofFeEL SMTP Test</h2>
        <p>This is a test email to verify your SMTP configuration is working correctly.</p>
        <p style="color: #10b981;">✅ If you received this email, your SMTP settings are correct!</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
        <p style="color: #6b7280; font-size: 12px;">Sent at: ${new Date().toISOString()}</p>
      </div>
    `,
    userId: null,
    emailType: 'test',
  });

  if (result.success) {
    logger.info('Test email sent', { to: toEmail, messageId: result.messageId });
  } else {
    logger.error('Test email failed', { error: result.error, to: toEmail });
  }
  return result;
};

module.exports = {
  sendPaymentRequest,
  sendPaymentRequestByAmount,
  sendWelcomeEmail,
  verifyConnection,
  resetTransporter,
  sendTestEmail,
  sendMail,

  // Exported for tests
  sendAndLog,
  TRACKING_HEADER,
};
