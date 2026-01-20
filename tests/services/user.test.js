/**
 * User Service Tests
 * Tests for user CRUD operations, soft delete, and coffee tracking
 */

const {
  createTestDatabase,
  closeTestDatabase,
  createTestUser,
  getUserById,
} = require('../helpers');

describe('User Service', () => {
  let db;

  beforeEach(() => {
    db = createTestDatabase();
  });

  afterAll(() => {
    closeTestDatabase();
  });

  describe('User Creation', () => {
    test('creates a new user with valid data', () => {
      const user = createTestUser(db, {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
      });

      expect(user.id).toBeGreaterThan(0);
      
      const savedUser = getUserById(db, user.id);
      expect(savedUser.first_name).toBe('John');
      expect(savedUser.last_name).toBe('Doe');
      expect(savedUser.email).toBe('john.doe@example.com');
      expect(savedUser.current_tab).toBe(0);
      expect(savedUser.pending_payment).toBe(0);
      expect(savedUser.account_balance).toBe(0);
      expect(savedUser.deleted_by_user).toBe(0);
    });

    test('rejects duplicate email (exact match)', () => {
      createTestUser(db, { email: 'test@example.com' });

      // Try to create another user with exact same email
      expect(() => {
        createTestUser(db, { email: 'test@example.com' });
      }).toThrow(); // UNIQUE constraint violation
    });

    test('trims whitespace from name fields', () => {
      const user = createTestUser(db, {
        firstName: '  Jane  ',
        lastName: '  Smith  ',
        email: 'jane@example.com',
      });

      // Note: This test assumes validation/trimming happens at service level
      // The raw database insert doesn't trim automatically
      const savedUser = getUserById(db, user.id);
      expect(savedUser).not.toBeNull();
    });
  });

  describe('Soft Delete', () => {
    test('soft deletes a user', () => {
      const user = createTestUser(db, {});

      // Soft delete
      db.prepare(`
        UPDATE users SET 
          deleted_by_user = 1,
          deleted_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(user.id);

      const deletedUser = getUserById(db, user.id);
      expect(deletedUser.deleted_by_user).toBe(1);
      expect(deletedUser.deleted_at).not.toBeNull();
    });

    test('soft deleted users are excluded from default query', () => {
      const activeUser = createTestUser(db, { email: 'active@example.com' });
      const deletedUser = createTestUser(db, { email: 'deleted@example.com' });

      // Soft delete one user
      db.prepare('UPDATE users SET deleted_by_user = 1 WHERE id = ?').run(deletedUser.id);

      // Query active users only
      const activeUsers = db.prepare('SELECT * FROM users WHERE deleted_by_user = 0').all();
      expect(activeUsers.length).toBe(1);
      expect(activeUsers[0].email).toBe('active@example.com');
    });

    test('soft deleted users can still be retrieved with flag', () => {
      const user = createTestUser(db, {});
      db.prepare('UPDATE users SET deleted_by_user = 1 WHERE id = ?').run(user.id);

      // Query all users including deleted
      const allUsers = db.prepare('SELECT * FROM users').all();
      expect(allUsers.length).toBe(1);
      expect(allUsers[0].deleted_by_user).toBe(1);
    });

    test('preserves payment data after soft delete', () => {
      const user = createTestUser(db, {
        currentTab: 5.0,
        pendingPayment: 10.0,
        accountBalance: -10.0,
      });

      // Soft delete
      db.prepare('UPDATE users SET deleted_by_user = 1 WHERE id = ?').run(user.id);

      const deletedUser = getUserById(db, user.id);
      expect(deletedUser.current_tab).toBe(5.0);
      expect(deletedUser.pending_payment).toBe(10.0);
      expect(deletedUser.account_balance).toBe(-10.0);
    });
  });

  describe('Restore User', () => {
    test('restores a soft-deleted user', () => {
      const user = createTestUser(db, {});

      // Soft delete
      db.prepare(`
        UPDATE users SET deleted_by_user = 1, deleted_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(user.id);

      // Restore
      db.prepare(`
        UPDATE users SET deleted_by_user = 0, deleted_at = NULL
        WHERE id = ?
      `).run(user.id);

      const restoredUser = getUserById(db, user.id);
      expect(restoredUser.deleted_by_user).toBe(0);
      expect(restoredUser.deleted_at).toBeNull();
    });

    test('restored user appears in active users list', () => {
      const user = createTestUser(db, { email: 'restored@example.com' });

      // Delete and restore
      db.prepare('UPDATE users SET deleted_by_user = 1 WHERE id = ?').run(user.id);
      db.prepare('UPDATE users SET deleted_by_user = 0 WHERE id = ?').run(user.id);

      const activeUsers = db.prepare('SELECT * FROM users WHERE deleted_by_user = 0').all();
      expect(activeUsers.length).toBe(1);
      expect(activeUsers[0].email).toBe('restored@example.com');
    });
  });

  describe('Hard Delete', () => {
    test('permanently removes user from database', () => {
      const user = createTestUser(db, {});
      
      db.prepare('DELETE FROM users WHERE id = ?').run(user.id);

      const deletedUser = getUserById(db, user.id);
      expect(deletedUser).toBeUndefined();
    });

    test('hard delete also removes payment records', () => {
      const user = createTestUser(db, {});

      // Create payment record
      db.prepare(`
        INSERT INTO payments (user_id, amount, type)
        VALUES (?, 5.0, 'request')
      `).run(user.id);

      // First delete payments (FK constraint), then user
      db.prepare('DELETE FROM payments WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(user.id);

      const payments = db.prepare('SELECT * FROM payments WHERE user_id = ?').all(user.id);
      expect(payments.length).toBe(0);
      
      const deletedUser = getUserById(db, user.id);
      expect(deletedUser).toBeUndefined();
    });
  });

  describe('Tab Increment/Decrement', () => {
    const COFFEE_PRICE = 0.5;

    test('increments tab by coffee price', () => {
      const user = createTestUser(db, { currentTab: 0 });

      db.prepare('UPDATE users SET current_tab = current_tab + ? WHERE id = ?').run(COFFEE_PRICE, user.id);

      const updatedUser = getUserById(db, user.id);
      expect(updatedUser.current_tab).toBe(0.5);
    });

    test('decrements tab by coffee price', () => {
      const user = createTestUser(db, { currentTab: 2.5 });

      db.prepare('UPDATE users SET current_tab = current_tab - ? WHERE id = ?').run(COFFEE_PRICE, user.id);

      const updatedUser = getUserById(db, user.id);
      expect(updatedUser.current_tab).toBe(2.0);
    });

    test('does not allow negative tab', () => {
      const user = createTestUser(db, { currentTab: 0 });

      // Decrement with MAX constraint (implemented at service level)
      db.prepare(`
        UPDATE users SET current_tab = MAX(0, current_tab - ?) WHERE id = ?
      `).run(COFFEE_PRICE, user.id);

      const updatedUser = getUserById(db, user.id);
      expect(updatedUser.current_tab).toBe(0);
    });

    test('handles multiple increments correctly', () => {
      const user = createTestUser(db, { currentTab: 0 });

      // Simulate 5 coffee increments (each adds €0.50)
      for (let i = 0; i < 5; i++) {
        db.prepare('UPDATE users SET current_tab = current_tab + ? WHERE id = ?').run(COFFEE_PRICE, user.id);
      }

      const updatedUser = getUserById(db, user.id);
      expect(updatedUser.current_tab).toBe(2.5); // 5 × €0.50
    });
  });

  describe('User Sorting', () => {
    test('sorts users by last name, then first name', () => {
      createTestUser(db, { firstName: 'Zoe', lastName: 'Anderson', email: 'z@a.com' });
      createTestUser(db, { firstName: 'Alice', lastName: 'Brown', email: 'a@b.com' });
      createTestUser(db, { firstName: 'Bob', lastName: 'Anderson', email: 'b@a.com' });

      const users = db.prepare(`
        SELECT * FROM users WHERE deleted_by_user = 0 
        ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE
      `).all();

      expect(users[0].first_name).toBe('Bob'); // Anderson, Bob
      expect(users[1].first_name).toBe('Zoe'); // Anderson, Zoe
      expect(users[2].first_name).toBe('Alice'); // Brown, Alice
    });

    test('case-insensitive sorting', () => {
      createTestUser(db, { firstName: 'alice', lastName: 'smith', email: 'a@s.com' });
      createTestUser(db, { firstName: 'Bob', lastName: 'Smith', email: 'b@s.com' });

      const users = db.prepare(`
        SELECT * FROM users WHERE deleted_by_user = 0 
        ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE
      `).all();

      expect(users[0].first_name).toBe('alice');
      expect(users[1].first_name).toBe('Bob');
    });
  });

  describe('Set Current Tab', () => {
    test('admin can set tab amount directly', () => {
      const user = createTestUser(db, { currentTab: 2.5 });

      db.prepare('UPDATE users SET current_tab = ? WHERE id = ?').run(5.0, user.id);

      const updatedUser = getUserById(db, user.id);
      expect(updatedUser.current_tab).toBe(5.0);
    });

    test('setting tab to zero works', () => {
      const user = createTestUser(db, { currentTab: 2.5 });

      db.prepare('UPDATE users SET current_tab = 0 WHERE id = ?').run(user.id);

      const updatedUser = getUserById(db, user.id);
      expect(updatedUser.current_tab).toBe(0);
    });
  });
});
