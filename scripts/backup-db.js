#!/usr/bin/env node
/**
 * Database Backup Script
 * Creates a timestamped copy of the database
 * 
 * Usage: npm run db:backup
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../src/db/database');

const DB_PATH = db.DB_PATH;
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '../data/backups');

console.log('=== CofFeEL Database Backup ===\n');

// Check if database exists
if (!fs.existsSync(DB_PATH)) {
  console.log('❌ Database file not found!');
  console.log(`   Expected location: ${DB_PATH}`);
  console.log('   Run "npm run db:init" first.');
  process.exit(1);
}

// Ensure backup directory exists
if (!fs.existsSync(BACKUP_DIR)) {
  console.log(`📁 Creating backup directory: ${BACKUP_DIR}`);
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// Generate backup filename with timestamp
const timestamp = new Date().toISOString()
  .replace(/[:.]/g, '-')
  .replace('T', '_')
  .slice(0, 19);
const backupFilename = `coffeel_${timestamp}.db`;
const backupPath = path.join(BACKUP_DIR, backupFilename);

// Perform backup using SQLite backup API
console.log('💾 Creating backup...');
console.log(`   Source: ${DB_PATH}`);
console.log(`   Destination: ${backupPath}`);

try {
  // Use better-sqlite3's backup method for safe backup
  const database = db.getDb();
  database.backup(backupPath)
    .then(() => {
      // Close connection after backup
      db.close();
      
      // Get backup file size
      const stats = fs.statSync(backupPath);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      
      console.log(`\n✅ Backup created successfully!`);
      console.log(`   File: ${backupFilename}`);
      console.log(`   Size: ${sizeMB} MB`);
      
      // List recent backups
      console.log('\n📋 Recent backups:');
      const backups = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.endsWith('.db'))
        .sort()
        .reverse()
        .slice(0, 5);
      
      backups.forEach(b => {
        const bPath = path.join(BACKUP_DIR, b);
        const bStats = fs.statSync(bPath);
        const bSize = (bStats.size / 1024 / 1024).toFixed(2);
        console.log(`   - ${b} (${bSize} MB)`);
      });
      
      // Cleanup old backups (keep last 30)
      const allBackups = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.endsWith('.db'))
        .sort();
      
      if (allBackups.length > 30) {
        console.log('\n🧹 Cleaning up old backups (keeping last 30)...');
        const toDelete = allBackups.slice(0, allBackups.length - 30);
        toDelete.forEach(b => {
          fs.unlinkSync(path.join(BACKUP_DIR, b));
          console.log(`   Deleted: ${b}`);
        });
      }
    })
    .catch((err) => {
      console.error('❌ Backup failed:', err.message);
      db.close();
      process.exit(1);
    });
} catch (err) {
  console.error('❌ Backup failed:', err.message);
  db.close();
  process.exit(1);
}
