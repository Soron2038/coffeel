#!/usr/bin/env node
// scripts/daily-db-backup.js

// Cron:
// 0 3 * * * cd /opt/coffeel && node scripts/daily-db-backup.js


const Database = require('better-sqlite3');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/coffee.db');
const db = new Database(DB_PATH, { readonly: true });

// Settings aus DB laden
const getS = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;

const transporter = nodemailer.createTransport({
  host: getS('smtp_host'),
  port: parseInt(getS('smtp_port') || '587', 10),
  secure: getS('smtp_secure') === 'true',
  auth: { user: getS('smtp_user'), pass: getS('smtp_pass') }
});

// Statistiken für die E-Mail sammeln
const stats = db.prepare(`
  SELECT 
    (SELECT COUNT(*) FROM users WHERE deleted_by_user = 0) as activeUsers,
    (SELECT COUNT(*) FROM users WHERE deleted_by_user = 1) as deletedUsers,
    (SELECT COUNT(*) FROM payments WHERE type = 'received') as totalPayments,
    (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE type = 'received') as totalRevenue
`).get();

const today = new Date().toLocaleDateString('de-DE', {
  weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric'
});
const backupDate = new Date().toISOString().slice(0, 10);
const backupPath = `/opt/coffeel/data/backups/coffeel-backup-${backupDate}.db`;

const generateBackupEmail = () => {
  const text = `
Hallo Admin,

im Anhang findest Du das tägliche Backup der CofFeEL-Datenbank.

=== Backup-Info ===
Datum: ${today}
Datei: coffeel-backup-${backupDate}.db

=== Aktuelle Statistiken ===
Aktive Benutzer: ${stats.activeUsers}
Gelöschte Benutzer: ${stats.deletedUsers}
Zahlungen gesamt: ${stats.totalPayments}
Einnahmen gesamt: €${stats.totalRevenue.toFixed(2)}

---
CofFeEL - Coffee Tracking System
Automatisches tägliches Backup
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
    .stats-box { background: #f5ebe0; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #8b5a2b; }
    .footer { padding: 15px; text-align: center; color: #7a5f45; font-size: 12px; border-radius: 0 0 8px 8px; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 8px 0; }
    .label { color: #7a5f45; }
    .value { font-weight: bold; text-align: right; }
    .highlight { color: #8b5a2b; font-size: 18px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">☕ CofFeEL Backup</h1>
    </div>
    <div class="content">
      <p>Hallo Admin,</p>
      <p>im Anhang findest Du das tägliche Backup der CofFeEL-Datenbank.</p>
      
      <div class="info-box">
        <h3 style="margin-top: 0;">Backup-Info</h3>
        <table>
          <tr>
            <td class="label">Datum:</td>
            <td class="value">${today}</td>
          </tr>
          <tr>
            <td class="label">Datei:</td>
            <td class="value"><code>coffeel-backup-${backupDate}.db</code></td>
          </tr>
        </table>
      </div>
      
      <div class="stats-box">
        <h3 style="margin-top: 0;">Aktuelle Statistiken</h3>
        <table>
          <tr>
            <td class="label">Aktive Benutzer:</td>
            <td class="value">${stats.activeUsers}</td>
          </tr>
          <tr>
            <td class="label">Gelöschte Benutzer:</td>
            <td class="value">${stats.deletedUsers}</td>
          </tr>
          <tr>
            <td class="label">Zahlungen gesamt:</td>
            <td class="value">${stats.totalPayments}</td>
          </tr>
          <tr>
            <td class="label">Einnahmen gesamt:</td>
            <td class="value highlight">€${stats.totalRevenue.toFixed(2)}</td>
          </tr>
        </table>
      </div>
    </div>
    <div class="footer">
      <p>CofFeEL - Coffee Tracking System<br>Automatisches tägliches Backup</p>
    </div>
  </div>
</body>
</html>
`;

  return { text, html };
};

// Backup erstellen und versenden
db.backup(backupPath).then(async () => {
  const emailContent = generateBackupEmail();

  await transporter.sendMail({
    from: getS('smtp_from') || getS('smtp_user'),
    to: getS('admin_email'),
    subject: `☕ CofFeEL Backup – ${today}`,
    text: emailContent.text,
    html: emailContent.html,
    attachments: [{
      filename: `coffeel-backup-${backupDate}.db`,
      path: backupPath
    }]
  });

  // Backups älter als 30 Tage löschen
  const backupDir = path.dirname(backupPath);
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const file of fs.readdirSync(backupDir)) {
    if (!file.startsWith('coffeel-backup-') || !file.endsWith('.db')) continue;
    const filePath = path.join(backupDir, file);
    if (fs.statSync(filePath).mtimeMs < cutoff) {
      fs.unlinkSync(filePath);
    }
  }

  console.log(`✅ Backup erfolgreich versendet und gespeichert (${today})`);
  process.exit(0);
}).catch(err => {
  console.error('❌ Backup fehlgeschlagen:', err.message);
  process.exit(1);
});
