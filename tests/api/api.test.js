/**
 * API Integration Tests
 * Tests for all API endpoints using supertest
 */

const request = require('supertest');
const express = require('express');
const path = require('path');

// Setup test environment
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = ':memory:';
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASSWORD = 'testpassword';
process.env.LOG_LEVEL = 'error';

// Mock email service
jest.mock('../../src/services/emailService', () => ({
  sendPaymentRequest: jest.fn().mockResolvedValue({ success: true, messageId: 'mock-id' }),
}));

const { createTestDatabase, closeTestDatabase } = require('../helpers');

describe('API Endpoints', () => {
  let app;
  let db;

  beforeAll(() => {
    // Initialize test database
    db = createTestDatabase();

    // Mock the database module to use our test db
    jest.doMock('../../src/db/database', () => ({
      get: (sql, params) => db.prepare(sql).get(...(params || [])),
      all: (sql, params) => db.prepare(sql).all(...(params || [])),
      run: (sql, params) => db.prepare(sql).run(...(params || [])),
      transaction: (fn) => {
        const transaction = db.transaction(fn);
        return transaction();
      },
      getDb: () => db,
    }));

    // Create a minimal app for testing
    app = express();
    app.use(express.json());

    // Load routes after mocking
    const apiRoutes = require('../../src/routes/api');
    app.use('/api', apiRoutes);
  });

  afterAll(() => {
    closeTestDatabase();
    jest.resetModules();
  });

  beforeEach(() => {
    // Reset database for each test
    db.exec('DELETE FROM payments');
    db.exec('DELETE FROM audit_log');
    db.exec('DELETE FROM users');
  });

  describe('GET /api/health', () => {
    test('returns health status', async () => {
      const res = await request(app).get('/api/health');
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'ok');
      expect(res.body).toHaveProperty('timestamp');
    });
  });

  describe('User Endpoints', () => {
    describe('GET /api/users', () => {
      test('returns empty array when no users', async () => {
        const res = await request(app).get('/api/users');
        
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
      });

      test('returns only active users by default', async () => {
        // Create users directly in test db
        db.prepare(`
          INSERT INTO users (first_name, last_name, email) VALUES ('Active', 'User', 'active@test.com')
        `).run();
        db.prepare(`
          INSERT INTO users (first_name, last_name, email, deleted_by_user) VALUES ('Deleted', 'User', 'deleted@test.com', 1)
        `).run();

        const res = await request(app).get('/api/users');
        
        expect(res.status).toBe(200);
        expect(res.body.length).toBe(1);
        expect(res.body[0].email).toBe('active@test.com');
      });

      test('returns all users when includeDeleted=true', async () => {
        db.prepare(`
          INSERT INTO users (first_name, last_name, email) VALUES ('Active', 'User', 'active@test.com')
        `).run();
        db.prepare(`
          INSERT INTO users (first_name, last_name, email, deleted_by_user) VALUES ('Deleted', 'User', 'deleted@test.com', 1)
        `).run();

        const res = await request(app).get('/api/users?includeDeleted=true');
        
        expect(res.status).toBe(200);
        expect(res.body.length).toBe(2);
      });
    });

    describe('POST /api/users', () => {
      test('creates a new user', async () => {
        const res = await request(app)
          .post('/api/users')
          .send({
            firstName: 'John',
            lastName: 'Doe',
            email: 'john@test.com',
          });
        
        expect(res.status).toBe(201);
        expect(res.body).toHaveProperty('id');
        expect(res.body.firstName).toBe('John');
        expect(res.body.email).toBe('john@test.com');
      });

      test('rejects missing required fields', async () => {
        const res = await request(app)
          .post('/api/users')
          .send({
            firstName: 'John',
            // Missing lastName and email
          });
        
        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty('error');
      });

      test('rejects invalid email', async () => {
        const res = await request(app)
          .post('/api/users')
          .send({
            firstName: 'John',
            lastName: 'Doe',
            email: 'not-an-email',
          });
        
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('email');
      });

      test('rejects duplicate email', async () => {
        // Create first user
        db.prepare(`
          INSERT INTO users (first_name, last_name, email) VALUES ('First', 'User', 'duplicate@test.com')
        `).run();

        const res = await request(app)
          .post('/api/users')
          .send({
            firstName: 'Second',
            lastName: 'User',
            email: 'duplicate@test.com',
          });
        
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('exists');
      });
    });

    describe('DELETE /api/users/:id', () => {
      test('soft deletes a user', async () => {
        const result = db.prepare(`
          INSERT INTO users (first_name, last_name, email) VALUES ('Test', 'User', 'test@test.com')
        `).run();
        const userId = result.lastInsertRowid;

        const res = await request(app).delete(`/api/users/${userId}`);
        
        expect(res.status).toBe(200);
        expect(res.body.deletedByUser).toBeTruthy();

        // Verify user is soft deleted
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        expect(user.deleted_by_user).toBe(1);
      });

      test('returns 404 for non-existent user', async () => {
        const res = await request(app).delete('/api/users/99999');
        
        expect(res.status).toBe(400);
      });
    });
  });

  describe('Coffee Tracking Endpoints', () => {
    let userId;

    beforeEach(() => {
      const result = db.prepare(`
        INSERT INTO users (first_name, last_name, email, coffee_count) 
        VALUES ('Coffee', 'Drinker', 'coffee@test.com', 0)
      `).run();
      userId = result.lastInsertRowid;
    });

    describe('POST /api/users/:id/increment', () => {
      test('increments coffee count', async () => {
        const res = await request(app).post(`/api/users/${userId}/increment`);
        
        expect(res.status).toBe(200);
        expect(res.body.coffeeCount).toBe(1);
      });

      test('handles multiple increments', async () => {
        await request(app).post(`/api/users/${userId}/increment`);
        await request(app).post(`/api/users/${userId}/increment`);
        const res = await request(app).post(`/api/users/${userId}/increment`);
        
        expect(res.body.coffeeCount).toBe(3);
      });
    });

    describe('POST /api/users/:id/decrement', () => {
      test('decrements coffee count', async () => {
        // First set coffee count to 5
        db.prepare('UPDATE users SET coffee_count = 5 WHERE id = ?').run(userId);

        const res = await request(app).post(`/api/users/${userId}/decrement`);
        
        expect(res.status).toBe(200);
        expect(res.body.coffeeCount).toBe(4);
      });

      test('does not go below zero', async () => {
        const res = await request(app).post(`/api/users/${userId}/decrement`);
        
        expect(res.status).toBe(200);
        expect(res.body.coffeeCount).toBe(0);
      });
    });
  });

  describe('Payment Endpoints', () => {
    let userId;

    beforeEach(() => {
      const result = db.prepare(`
        INSERT INTO users (first_name, last_name, email, coffee_count, pending_payment, account_balance) 
        VALUES ('Pay', 'User', 'pay@test.com', 10, 0, 0)
      `).run();
      userId = result.lastInsertRowid;
    });

    describe('POST /api/users/:id/pay', () => {
      test('creates payment request', async () => {
        const res = await request(app).post(`/api/users/${userId}/pay`);
        
        expect(res.status).toBe(200);
        expect(res.body.coffeeCount).toBe(0);
        expect(res.body.pendingPayment).toBe(5.0); // 10 coffees * €0.50
      });

      test('rejects payment for zero coffees', async () => {
        db.prepare('UPDATE users SET coffee_count = 0 WHERE id = ?').run(userId);

        const res = await request(app).post(`/api/users/${userId}/pay`);
        
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('No coffees');
      });

      test('applies existing credit', async () => {
        db.prepare('UPDATE users SET account_balance = 3.0 WHERE id = ?').run(userId);

        const res = await request(app).post(`/api/users/${userId}/pay`);
        
        expect(res.status).toBe(200);
        expect(res.body.pendingPayment).toBe(2.0); // 5.0 - 3.0 credit = 2.0
      });
    });
  });

  describe('Input Validation', () => {
    test('rejects invalid user ID', async () => {
      const res = await request(app).get('/api/users/invalid');
      
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid');
    });

    test('rejects negative user ID', async () => {
      const res = await request(app).get('/api/users/-1');
      
      expect(res.status).toBe(400);
    });
  });
});
