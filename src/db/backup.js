import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DB_PATH = join(__dirname, '../../data/coffee.db');
const BACKUP_DIR = join(__dirname, '../../data/backups');

async function backupDatabase() {
  console.log('💾 Creating database backup...');
  
  try {
    // Ensure backup directory exists
    if (!existsSync(BACKUP_DIR)) {
      mkdirSync(BACKUP_DIR, { recursive: true });
    }
    
    // Check if database exists
    if (!existsSync(DB_PATH)) {
      console.error('❌ Database file not found:', DB_PATH);
      process.exit(1);
    }
    
    // Create backup filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const backupPath = join(BACKUP_DIR, `coffeel_${timestamp}.db`);
    
    // Copy database file
    copyFileSync(DB_PATH, backupPath);
    
    console.log(`✅ Database backed up to: ${backupPath}`);
    
    // Also backup WAL and SHM files if they exist
    const walPath = `${DB_PATH}-wal`;
    const shmPath = `${DB_PATH}-shm`;
    
    if (existsSync(walPath)) {
      copyFileSync(walPath, `${backupPath}-wal`);
      console.log('✅ WAL file backed up');
    }
    
    if (existsSync(shmPath)) {
      copyFileSync(shmPath, `${backupPath}-shm`);
      console.log('✅ SHM file backed up');
    }
    
    console.log('✅ Backup complete!');
    
  } catch (error) {
    console.error('❌ Backup failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  backupDatabase();
}

export { backupDatabase };
