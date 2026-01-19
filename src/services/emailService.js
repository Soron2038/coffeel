const nodemailer = require('nodemailer');
const logger = require('../utils/logger');
const settingsService = require('./settingsService');

// Create reusable transporter
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
  
  // Recreate transporter if config changed
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

  try {
    const transport = getTransporter();
    const smtpConfig = getSmtpConfig();
    
    const mailOptions = {
      from: smtpConfig.from,
      to: user.email,
      cc: adminEmail,
      subject: `Coffee Payment Request - ${coffeeCount} coffees`,
      text: emailContent.text,
      html: emailContent.html,
    };

    const info = await transport.sendMail(mailOptions);
    
    logger.info('Payment request email sent', {
      userId: user.id,
      email: user.email,
      amount,
      messageId: info.messageId,
    });

    return { success: true, messageId: info.messageId };
  } catch (err) {
    logger.error('Failed to send payment request email', {
      error: err.message,
      userId: user.id,
      email: user.email,
    });

    // Return error but don't throw - payment tracking should continue
    return { success: false, error: err.message };
  }
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
 * Send a test email to verify SMTP configuration
 * @param {string} toEmail - Email address to send test to
 * @returns {Object} Result with success status
 */
const sendTestEmail = async (toEmail) => {
  try {
    const transport = getTransporter();
    const smtpConfig = getSmtpConfig();
    
    if (!smtpConfig.host) {
      return { success: false, error: 'SMTP host not configured' };
    }

    const mailOptions = {
      from: smtpConfig.from,
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
    };

    const info = await transport.sendMail(mailOptions);
    
    logger.info('Test email sent', { to: toEmail, messageId: info.messageId });
    return { success: true, messageId: info.messageId };
  } catch (err) {
    logger.error('Test email failed', { error: err.message, to: toEmail });
    return { success: false, error: err.message };
  }
};

module.exports = {
  sendPaymentRequest,
  verifyConnection,
  resetTransporter,
  sendTestEmail,
};
