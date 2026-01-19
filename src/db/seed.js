import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DB_PATH = join(__dirname, '../../data/coffee.db');

async function seedDatabase() {
  console.log('🌱 Seeding CofFeEL database with test data...');
  
  try {
    const db = new Database(DB_PATH);
    
    // Test users
    const testUsers = [
      { firstName: 'Max', lastName: 'Mustermann', email: 'max.mustermann@cfel.de' },
      { firstName: 'Anna', lastName: 'Schmidt', email: 'anna.schmidt@cfel.de' },
      { firstName: 'Peter', lastName: 'Weber', email: 'peter.weber@cfel.de' },
      { firstName: 'Maria', lastName: 'Müller', email: 'maria.mueller@cfel.de' },
      { firstName: 'Tom', lastName: 'Anderson', email: 'tom.anderson@cfel.de' }
    ];
    
    const insertUser = db.prepare(`
      INSERT OR IGNORE INTO users (first_name, last_name, email, coffee_count)
      VALUES (?, ?, ?, ?)
    `);
    
    const insertMany = db.transaction((users) => {
      for (const user of users) {
        insertUser.run(user.firstName, user.lastName, user.email, 0);
      }
    });
    
    insertMany(testUsers);
    
    console.log(`✅ Seeded ${testUsers.length} test users`);
    
    // Verify
    const count = db.prepare('SELECT COUNT(*) as count FROM users').get();
    console.log(`📊 Total users in database: ${count.count}`);
    
    db.close();
    console.log('✅ Database seeding complete!');
    
  } catch (error) {
    console.error('❌ Database seeding failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  seedDatabase();
}

export { seedDatabase };
