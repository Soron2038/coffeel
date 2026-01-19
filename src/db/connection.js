import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let db = null;

export function getDatabase() {
  if (!db) {
    const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/coffee.db');
    
    db = new Database(DB_PATH, {
      verbose: process.env.NODE_ENV === 'development' ? console.log : null
    });
    
    // Enable WAL mode for better concurrency
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    
    console.log(`📁 Database connected: ${DB_PATH}`);
  }
  
  return db;
}

export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
    console.log('📁 Database connection closed');
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  closeDatabase();
  process.exit(0);
});

process.on('SIGTERM', () => {
  closeDatabase();
  process.exit(0);
});
