#!/usr/bin/env node
/**
 * Database Seed Script
 * Adds test users for development
 * 
 * Usage: npm run db:seed
 */

require('dotenv').config();
const db = require('../src/db/database');

console.log('=== CofFeEL Database Seeding ===\n');

// Test users data
const testUsers = [
  { firstName: 'Max', lastName: 'Mustermann', email: 'max@example.com', coffeeCount: 5 },
  { firstName: 'Anna', lastName: 'Schmidt', email: 'anna@example.com', coffeeCount: 12 },
  { firstName: 'John', lastName: 'Doe', email: 'john@example.com', coffeeCount: 0 },
  { firstName: 'Jane', lastName: 'Smith', email: 'jane@example.com', coffeeCount: 3 },
  { firstName: 'Hans', lastName: 'Mueller', email: 'hans@example.com', coffeeCount: 27 },
  { firstName: 'Lisa', lastName: 'Weber', email: 'lisa@example.com', coffeeCount: 8 },
  { firstName: 'Peter', lastName: 'Anderson', email: 'peter@example.com', coffeeCount: 15 },
  { firstName: 'Maria', lastName: 'Garcia', email: 'maria@example.com', coffeeCount: 2 },
];

// Insert statement
const insertUser = db.prepare(`
  INSERT OR IGNORE INTO users (first_name, last_name, email, coffee_count)
  VALUES (?, ?, ?, ?)
`);

// Seed users within a transaction
console.log('👥 Adding test users...\n');

db.transaction(() => {
  for (const user of testUsers) {
    const result = insertUser.run(
      user.firstName,
      user.lastName,
      user.email,
      user.coffeeCount
    );
    
    if (result.changes > 0) {
      console.log(`   ✅ Added: ${user.firstName} ${user.lastName} (${user.email}) - ${user.coffeeCount} coffees`);
    } else {
      console.log(`   ⏭️  Skipped: ${user.email} (already exists)`);
    }
  }
});

// Add one deleted user for testing
console.log('\n🗑️  Adding a deleted test user...');
const deletedUserResult = db.run(`
  INSERT OR IGNORE INTO users (first_name, last_name, email, coffee_count, deleted_by_user, deleted_at)
  VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
`, ['Tom', 'Former', 'tom@example.com', 10]);

if (deletedUserResult.changes > 0) {
  console.log('   ✅ Added: Tom Former (tom@example.com) - marked as deleted');
} else {
  console.log('   ⏭️  Skipped: tom@example.com (already exists)');
}

// Add one user with pending payment for testing
console.log('\n💰 Adding a user with pending payment...');
const pendingUserResult = db.run(`
  INSERT OR IGNORE INTO users (first_name, last_name, email, coffee_count, pending_payment, account_balance, last_payment_request)
  VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
`, ['Emma', 'Pending', 'emma@example.com', 3, 13.50, -13.50]);

if (pendingUserResult.changes > 0) {
  console.log('   ✅ Added: Emma Pending (emma@example.com) - €13.50 pending');
} else {
  console.log('   ⏭️  Skipped: emma@example.com (already exists)');
}

// Add one user with credit for testing
console.log('\n💚 Adding a user with credit...');
const creditUserResult = db.run(`
  INSERT OR IGNORE INTO users (first_name, last_name, email, coffee_count, pending_payment, account_balance)
  VALUES (?, ?, ?, ?, ?, ?)
`, ['Oliver', 'Prepaid', 'oliver@example.com', 5, 0, 10.00]);

if (creditUserResult.changes > 0) {
  console.log('   ✅ Added: Oliver Prepaid (oliver@example.com) - €10.00 credit');
} else {
  console.log('   ⏭️  Skipped: oliver@example.com (already exists)');
}

// Close connection
db.close();

// Summary
const total = testUsers.length + 3; // +3 for special test cases
console.log(`\n✅ Seeding complete! Added up to ${total} test users.`);
console.log('\n💡 Test accounts include:');
console.log('   - Regular users with various coffee counts');
console.log('   - One soft-deleted user (Tom Former)');
console.log('   - One user with pending payment (Emma Pending)');
console.log('   - One user with credit balance (Oliver Prepaid)');
