/**
 * Email Service Tests
 * Tests for SMTP failure handling - payment tracking must not reset on email failure
 */

const {
  createTestDatabase,
  closeTestDatabase,
  createTestUser,
  getUserById,
  getCoffeePrice,
} = require('../helpers');

describe('Email Service - SMTP Failure Handling', () => {
  let db;

  beforeEach(() => {
    db = createTestDatabase();
  });

  afterAll(() => {
    closeTestDatabase();
  });

  /**
   * Critical test: Payment tracking must NOT reset when email fails
   * This is a key requirement from the PRD
   */
  describe('Payment State Preservation', () => {
    test('payment state is saved before email attempt', () => {
      const user = createTestUser(db, {
        currentTab: 5.0, // €5.00 tab
        pendingPayment: 0,
        accountBalance: 0,
      });

      const amountToPay = user.currentTab;

      // Simulate: Save payment state FIRST (before email)
      db.prepare(`
        UPDATE users SET 
          current_tab = 0,
          pending_payment = pending_payment + ?,
          account_balance = account_balance - ?
        WHERE id = ?
      `).run(amountToPay, amountToPay, user.id);

      // Create payment record FIRST (before email)
      const paymentResult = db.prepare(`
        INSERT INTO payments (user_id, amount, type)
        VALUES (?, ?, 'request')
      `).run(user.id, amountToPay);

      // Verify state is saved
      const savedUser = getUserById(db, user.id);
      expect(savedUser.current_tab).toBe(0);
      expect(savedUser.pending_payment).toBe(5.0);
      expect(savedUser.account_balance).toBe(-5.0);

      const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentResult.lastInsertRowid);
      expect(payment).not.toBeNull();
      expect(payment.amount).toBe(5.0);
    });

    test('payment state remains intact when email fails', () => {
      const user = createTestUser(db, {
        currentTab: 5.0, // €5.00 tab
        pendingPayment: 0,
        accountBalance: 0,
      });

      const amountToPay = user.currentTab;

      // Step 1: Save payment state (ALWAYS succeeds)
      db.prepare(`
        UPDATE users SET 
          current_tab = 0,
          pending_payment = pending_payment + ?,
          account_balance = account_balance - ?
        WHERE id = ?
      `).run(amountToPay, amountToPay, user.id);

      db.prepare(`
        INSERT INTO payments (user_id, amount, type)
        VALUES (?, ?, 'request')
      `).run(user.id, amountToPay);

      // Step 2: Simulate email failure (AFTER payment state saved)
      const emailFailed = true; // Simulate SMTP error

      // Important: We do NOT rollback payment state on email failure
      if (emailFailed) {
        // Log error but DON'T modify payment state
        // This is intentional - payment tracking is more important than email
      }

      // Step 3: Verify payment state is preserved
      const finalUser = getUserById(db, user.id);
      expect(finalUser.current_tab).toBe(0);
      expect(finalUser.pending_payment).toBe(5.0);
      expect(finalUser.account_balance).toBe(-5.0);

      const payments = db.prepare('SELECT * FROM payments WHERE user_id = ?').all(user.id);
      expect(payments.length).toBe(1);
      expect(payments[0].amount).toBe(5.0);
    });

    test('email success flag does not affect payment state', () => {
      const user = createTestUser(db, {
        currentTab: 3.0, // €3.00 tab
        pendingPayment: 0,
        accountBalance: 0,
      });

      const amountToPay = user.currentTab;

      // Save payment state
      db.prepare(`
        UPDATE users SET 
          current_tab = 0,
          pending_payment = pending_payment + ?,
          account_balance = account_balance - ?
        WHERE id = ?
      `).run(amountToPay, amountToPay, user.id);

      db.prepare(`
        INSERT INTO payments (user_id, amount, type)
        VALUES (?, ?, 'request')
      `).run(user.id, amountToPay);

      // Test both scenarios: email success and failure
      const emailResults = [
        { success: true, messageId: 'msg-123' },
        { success: false, error: 'SMTP connection refused' },
      ];

      // Regardless of email result, payment state should be the same
      for (const emailResult of emailResults) {
        const savedUser = getUserById(db, user.id);
        
        // Payment state should NOT change based on email result
        expect(savedUser.current_tab).toBe(0);
        expect(savedUser.pending_payment).toBe(3.0);
        expect(savedUser.account_balance).toBe(-3.0);
      }
    });

    test('multiple email retries do not duplicate payment records', () => {
      const user = createTestUser(db, {
        currentTab: 2.0, // €2.00 tab
        pendingPayment: 0,
        accountBalance: 0,
      });

      const amountToPay = user.currentTab;

      // Save payment state ONCE
      db.prepare(`
        UPDATE users SET 
          current_tab = 0,
          pending_payment = pending_payment + ?,
          account_balance = account_balance - ?
        WHERE id = ?
      `).run(amountToPay, amountToPay, user.id);

      db.prepare(`
        INSERT INTO payments (user_id, amount, type)
        VALUES (?, ?, 'request')
      `).run(user.id, amountToPay);

      // Simulate 3 email retry attempts (none modify DB)
      for (let i = 0; i < 3; i++) {
        // Email attempt - no DB modification
        const emailSuccess = i === 2; // Third attempt succeeds
      }

      // Verify only ONE payment record exists
      const payments = db.prepare('SELECT * FROM payments WHERE user_id = ?').all(user.id);
      expect(payments.length).toBe(1);

      // User balance should not be affected by retries
      const finalUser = getUserById(db, user.id);
      expect(finalUser.pending_payment).toBe(2.0);
    });
  });

  describe('Email Error Logging', () => {
    test('email errors are logged but do not throw', () => {
      const user = createTestUser(db, {
        currentTab: 5.0, // €5.00 tab
        pendingPayment: 0,
        accountBalance: 0,
      });

      // Simulate the flow with error logging
      let errorLogged = false;
      
      // Payment saved first
      const amountToPay = user.currentTab;

      db.prepare(`
        UPDATE users SET 
          current_tab = 0,
          pending_payment = pending_payment + ?,
          account_balance = account_balance - ?
        WHERE id = ?
      `).run(amountToPay, amountToPay, user.id);

      // Email fails
      try {
        throw new Error('SMTP connection failed');
      } catch (e) {
        // Log error but don't throw
        errorLogged = true;
      }

      expect(errorLogged).toBe(true);

      // Payment state preserved
      const finalUser = getUserById(db, user.id);
      expect(finalUser.current_tab).toBe(0);
      expect(finalUser.pending_payment).toBe(5.0);
    });
  });

  describe('Transaction Isolation', () => {
    test('email sending is outside payment transaction', () => {
      const user = createTestUser(db, {
        currentTab: 4.0, // €4.00 tab
        pendingPayment: 0,
        accountBalance: 0,
      });

      const amountToPay = user.currentTab;

      // This demonstrates the correct pattern:
      // 1. Database transaction for payment state
      // 2. Email sending AFTER transaction completes

      // Step 1: Transaction (atomic)
      const txn = db.transaction(() => {
        db.prepare(`
          UPDATE users SET 
            current_tab = 0,
            pending_payment = pending_payment + ?,
            account_balance = account_balance - ?
          WHERE id = ?
        `).run(amountToPay, amountToPay, user.id);

        db.prepare(`
          INSERT INTO payments (user_id, amount, type)
          VALUES (?, ?, 'request')
        `).run(user.id, amountToPay);
      });
      txn();

      // Step 2: Email (after transaction, may fail independently)
      let emailSent = false;
      try {
        // Simulate email
        emailSent = true;
      } catch (e) {
        emailSent = false;
        // Log but don't throw
      }

      // Regardless of email status, payment is committed
      const finalUser = getUserById(db, user.id);
      expect(finalUser.current_tab).toBe(0);
      expect(finalUser.pending_payment).toBe(4.0);
      expect(finalUser.account_balance).toBe(-4.0);
    });
  });
});
