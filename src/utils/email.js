import nodemailer from 'nodemailer';
import { getDatabase } from '../db/connection.js';

let transporter = null;

/**
 * Initialize email transporter with SMTP settings
 */
function getTransporter() {
  if (!transporter) {
    const db = getDatabase();
    const settings = {};
    
    // Load SMTP settings from database
    const rows = db.prepare('SELECT key, value FROM settings WHERE key LIKE "smtp_%"').all();
    rows.forEach(row => {
      settings[row.key] = row.value;
    });
    
    // Fallback to environment variables
    const smtpConfig = {
      host: settings.smtp_host || process.env.SMTP_HOST,
      port: parseInt(settings.smtp_port || process.env.SMTP_PORT || '587'),
      secure: (settings.smtp_secure || process.env.SMTP_SECURE) === 'true',
      auth: {
        user: settings.smtp_user || process.env.SMTP_USER,
        pass: settings.smtp_pass || process.env.SMTP_PASS
      }
    };
    
    transporter = nodemailer.createTransporter(smtpConfig);
    
    console.log(`📧 Email transporter initialized: ${smtpConfig.host}:${smtpConfig.port}`);
  }
  
  return transporter;
}

/**
 * Send payment request email to user
 * @param {Object} params - Email parameters
 * @param {string} params.userEmail - Recipient email
 * @param {string} params.userName - User's full name
 * @param {number} params.coffeeCount - Number of coffees consumed
 * @param {number} params.amount - Total amount to pay
 * @param {number} params.coffeePrice - Price per coffee
 * @returns {Promise<Object>} Email send result
 */
export async function sendPaymentRequestEmail({ userEmail, userName, coffeeCount, amount, coffeePrice }) {
  try {
    const db = getDatabase();
    
    // Get bank details and admin email from settings
    const settings = {};
    const rows = db.prepare(`
      SELECT key, value FROM settings 
      WHERE key IN ('bank_iban', 'bank_bic', 'bank_owner', 'admin_email', 'smtp_from')
    `).all();
    
    rows.forEach(row => {
      settings[row.key] = row.value;
    });
    
    const bankIban = settings.bank_iban || process.env.BANK_IBAN || 'Not configured';
    const bankBic = settings.bank_bic || process.env.BANK_BIC || 'Not configured';
    const bankOwner = settings.bank_owner || process.env.BANK_OWNER || 'CFEL Coffee Fund';
    const adminEmail = settings.admin_email || process.env.ADMIN_EMAIL || 'admin@example.com';
    const fromEmail = settings.smtp_from || process.env.SMTP_FROM || 'CofFeEL System <coffee@example.com>';
    
    // Email template (English, as per PRD requirements)
    const subject = `Coffee Payment Request - ${coffeeCount} coffees`;
    
    const textBody = `
Hello ${userName},

You have requested to pay for your coffee consumption.

Details:
- Coffees consumed: ${coffeeCount}
- Price per coffee: €${coffeePrice.toFixed(2)}
- Total amount: €${amount.toFixed(2)}

Please transfer the amount to the following account:

Account holder: ${bankOwner}
IBAN: ${bankIban}
BIC: ${bankBic}
Reference: ${userName} - Coffee Payment

Thank you!

CofFeEL System
CFEL Coffee Tracking
    `.trim();
    
    const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #2563eb; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
    .details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .detail-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
    .detail-label { font-weight: 600; }
    .bank-info { background: #eff6ff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #2563eb; }
    .total { font-size: 24px; font-weight: bold; color: #2563eb; text-align: center; padding: 20px; }
    .footer { text-align: center; color: #6b7280; font-size: 14px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>☕ Coffee Payment Request</h1>
    </div>
    <div class="content">
      <p>Hello <strong>${userName}</strong>,</p>
      <p>You have requested to pay for your coffee consumption.</p>
      
      <div class="details">
        <div class="detail-row">
          <span class="detail-label">Coffees consumed:</span>
          <span>${coffeeCount}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Price per coffee:</span>
          <span>€${coffeePrice.toFixed(2)}</span>
        </div>
        <div class="detail-row" style="border-bottom: none;">
          <span class="detail-label">Total amount:</span>
          <span><strong>€${amount.toFixed(2)}</strong></span>
        </div>
      </div>
      
      <div class="bank-info">
        <h3 style="margin-top: 0;">Bank Transfer Details</h3>
        <p><strong>Account holder:</strong> ${bankOwner}</p>
        <p><strong>IBAN:</strong> ${bankIban}</p>
        <p><strong>BIC:</strong> ${bankBic}</p>
        <p><strong>Reference:</strong> ${userName} - Coffee Payment</p>
      </div>
      
      <p>Thank you for your payment!</p>
      
      <div class="footer">
        <p>CofFeEL System - CFEL Coffee Tracking</p>
      </div>
    </div>
  </div>
</body>
</html>
    `.trim();
    
    // Send email
    const mailOptions = {
      from: fromEmail,
      to: userEmail,
      cc: adminEmail,
      subject: subject,
      text: textBody,
      html: htmlBody
    };
    
    const result = await getTransporter().sendMail(mailOptions);
    
    console.log(`📧 Payment request email sent to ${userEmail}`);
    return { success: true, messageId: result.messageId };
    
  } catch (error) {
    console.error('❌ Failed to send payment request email:', error);
    // IMPORTANT: Don't throw error - per WARP.md line 187, never reset payment state on SMTP failure
    return { success: false, error: error.message };
  }
}

/**
 * Verify SMTP connection
 * @returns {Promise<boolean>} True if connection successful
 */
export async function verifyEmailConnection() {
  try {
    await getTransporter().verify();
    console.log('✅ SMTP connection verified');
    return true;
  } catch (error) {
    console.error('❌ SMTP connection failed:', error);
    return false;
  }
}
