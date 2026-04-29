#!/usr/bin/env node
/**
 * Database Migration CLI Wrapper
 *
 * Calls the shared migrations module against the configured database.
 * Useful for manual deploys or recovery; the same module is also invoked
 * automatically on server boot and after backup restore.
 *
 * Usage: npm run db:migrate
 */

require('dotenv').config();
const db = require('../src/db/database');
const { runMigrations } = require('../src/db/migrations');

console.log('=== CofFeEL Database Migration ===\n');

const cliLogger = {
  info: (msg) => console.log(`⏳ ${msg}`),
  warn: (msg) => console.warn(`⚠  ${msg}`),
  error: (msg) => console.error(`❌ ${msg}`),
};

try {
  const result = runMigrations(db.getDb(), { logger: cliLogger });
  result.applied.forEach((m) => console.log(`✅ ${m}`));
  result.skipped.forEach((m) => console.log(`⏭  ${m}`));
  console.log('\n✅ Migration complete.');
} catch (err) {
  console.error('\n❌ Migration failed:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
