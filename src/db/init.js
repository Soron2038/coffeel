import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Database file path
const DB_PATH = join(__dirname, '../../data/coffee.db');

async function initDatabase() {
  console.log('🚀 Initializing CofFeEL database...');
  
  try {
    // Create database connection
    const db = new Database(DB_PATH, { verbose: console.log });
    
    // Read schema file
    const schemaPath = join(__dirname, 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf8');
    
    // Execute entire schema at once (SQLite can handle multiple statements)
    db.exec(schema);
    
    console.log('✅ Database schema created successfully');
    console.log(`📁 Database location: ${DB_PATH}`);
    
    // Verify tables were created
    const tables = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' 
      ORDER BY name
    `).all();
    
    console.log('📊 Created tables:', tables.map(t => t.name).join(', '));
    
    db.close();
    console.log('✅ Database initialization complete!');
    
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  initDatabase();
}

export { initDatabase };
