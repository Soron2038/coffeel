#!/usr/bin/env node
/**
 * Database Initialization Script
 * Creates database schema and loads default settings
 * 
 * Usage: npm run db:init
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../src/db/database');

const DB_PATH = db.DB_PATH;

console.log('=== CofFeEL Database Initialization ===\n');

// Check if database already exists
const dbExists = fs.existsSync(DB_PATH);

if (dbExists) {
  console.log(`⚠️  Database already exists at: ${DB_PATH}`);
  console.log('   This will reset all data!\n');
  
  // In production, ask for confirmation
  if (process.env.NODE_ENV === 'production') {
    console.log('❌ Refusing to reset production database.');
    console.log('   Delete the database file manually if you really want to reset.');
    process.exit(1);
  }
  
  // Remove existing database files
  console.log('🗑️  Removing existing database...');
  fs.unlinkSync(DB_PATH);
  
  // Also remove WAL and SHM files if they exist
  const walPath = DB_PATH + '-wal';
  const shmPath = DB_PATH + '-shm';
  if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
  if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
}

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  console.log(`📁 Creating data directory: ${dataDir}`);
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize database
console.log('📦 Creating database schema...');
db.initialize();

// Verify tables were created
const tables = db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
console.log('\n✅ Created tables:');
tables.forEach(t => console.log(`   - ${t.name}`));

// Verify settings were loaded
const settings = db.all('SELECT key, value FROM settings');
console.log('\n⚙️  Default settings:');
settings.forEach(s => console.log(`   - ${s.key}: ${s.value}`));

// Close connection
db.close();

console.log('\n✅ Database initialized successfully!');
console.log(`   Location: ${DB_PATH}`);
console.log('\n💡 Next steps:');
console.log('   - Run "npm run db:seed" to add test users');
console.log('   - Run "npm run dev" to start the development server');
