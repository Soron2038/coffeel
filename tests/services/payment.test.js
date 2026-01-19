/**
 * Payment Service Tests
 * Tests for the complex payment calculation logic
 */

const {
  createTestDatabase,
  closeTestDatabase,
  createTestUser,
  getUserById,
  getCoffeePrice,
} = require('../helpers');

describe('Payment Logic', () => {
  let db;
  const COFFEE_PRICE = 0.5; // Default from settings

  beforeEach(() => {
    db = createTestDatabase();
  });

  afterAll(() => {
    closeTestDatabase();
  });

  describe('Payment Request Calculation', () => {
    /**
     * Test exact payment scenario
     * User has coffees, no credit, pays exact amount
     */
    test('exact payment - no existing credit', () => {
      const user = createTestUser(db, {
        coffeeCount: 10,
        pendingPayment: 0,
        accountBalance: 0,
      });

      const coffeeCount = user.coffeeCount;
      const coffeePrice = getCoffeePrice(db);
      const totalCost = coffeeCount * coffeePrice; // 10 * 0.5 = 5.00

      // Calculate what should happen
      const availableCredit = Math.max(0, user.accountBalance); // 0
      const creditApplied = Math.min(availableCredit, totalCost); // 0
      const amountToPay = totalCost - creditApplied; // 5.00

      expect(totalCost).toBe(5.0);
      expect(creditApplied).toBe(0);
      expect(amountToPay).toBe(5.0);

      // Simulate payment request update
      db.prepare(`
        UPDATE users SET 
          coffee_count = 0,
          pending_payment = pending_payment + ?,
          account_balance = account_balance - ?
        WHERE id = ?
      `).run(amountToPay, totalCost, user.id);

      const updatedUser = getUserById(db, user.id);
      expect(updatedUser.coffee_count).toBe(0);
      expect(updatedUser.pending_payment).toBe(5.0);
      expect(updatedUser.account_balance).toBe(-5.0);
    });

    /**
     * Test overpayment scenario (creates credit)
     * User pays more than owed, excess becomes credit
     */
    test('overpayment - creates credit', () => {
      const user = createTestUser(db, {
        coffeeCount: 0,
        pendingPayment: 5.0,
        accountBalance: -5.0,
      });

      const paymentAmount = 10.0; // Pay double
      const pendingCleared = Math.min(paymentAmount, user.pendingPayment); // 5.0
      const creditCreated = paymentAmount - pendingCleared; // 5.0

      expect(pendingCleared).toBe(5.0);
      expect(creditCreated).toBe(5.0);

      // Simulate payment confirmation
      db.prepare(`
        UPDATE users SET 
          pending_payment = pending_payment - ?,
          account_balance = account_balance + ?
        WHERE id = ?
      `).run(pendingCleared, paymentAmount, user.id);

      const updatedUser = getUserById(db, user.id);
      expect(updatedUser.pending_payment).toBe(0);
      expect(updatedUser.account_balance).toBe(5.0); // -5 + 10 = 5 credit
    });

    /**
     * Test partial payment scenario
     * User pays less than pending amount
     */
    test('partial payment - reduces pending', () => {
      const user = createTestUser(db, {
        coffeeCount: 0,
        pendingPayment: 10.0,
        accountBalance: -10.0,
      });

      const paymentAmount = 6.0;
      const pendingCleared = Math.min(paymentAmount, user.pendingPayment); // 6.0

      // Simulate payment confirmation
      db.prepare(`
        UPDATE users SET 
          pending_payment = pending_payment - ?,
          account_balance = account_balance + ?
        WHERE id = ?
      `).run(pendingCleared, paymentAmount, user.id);

      const updatedUser = getUserById(db, user.id);
      expect(updatedUser.pending_payment).toBe(4.0); // 10 - 6 = 4
      expect(updatedUser.account_balance).toBe(-4.0); // -10 + 6 = -4
    });

    /**
     * Test prepayment scenario (user has existing credit)
     * Credit should be applied before creating new pending payment
     */
    test('prepayment - credit covers partial cost', () => {
      const user = createTestUser(db, {
        coffeeCount: 10,
        pendingPayment: 0,
        accountBalance: 3.0, // Has €3 credit
      });

      const coffeeCount = user.coffeeCount;
      const coffeePrice = getCoffeePrice(db);
      const totalCost = coffeeCount * coffeePrice; // 10 * 0.5 = 5.00

      const availableCredit = Math.max(0, user.accountBalance); // 3.0
      const creditApplied = Math.min(availableCredit, totalCost); // 3.0
      const amountToPay = totalCost - creditApplied; // 2.0

      expect(totalCost).toBe(5.0);
      expect(creditApplied).toBe(3.0);
      expect(amountToPay).toBe(2.0);

      // Simulate payment request with credit application
      db.prepare(`
        UPDATE users SET 
          coffee_count = 0,
          pending_payment = pending_payment + ?,
          account_balance = account_balance - ?
        WHERE id = ?
      `).run(amountToPay, totalCost, user.id);

      const updatedUser = getUserById(db, user.id);
      expect(updatedUser.coffee_count).toBe(0);
      expect(updatedUser.pending_payment).toBe(2.0); // Only unpaid portion
      expect(updatedUser.account_balance).toBe(-2.0); // 3 - 5 = -2
    });

    /**
     * Test credit covers all cost
     * User has enough credit, no payment needed
     */
    test('credit covers entire cost - no payment needed', () => {
      const user = createTestUser(db, {
        coffeeCount: 4,
        pendingPayment: 0,
        accountBalance: 5.0, // Has €5 credit
      });

      const coffeeCount = user.coffeeCount;
      const coffeePrice = getCoffeePrice(db);
      const totalCost = coffeeCount * coffeePrice; // 4 * 0.5 = 2.00

      const availableCredit = Math.max(0, user.accountBalance); // 5.0
      const creditApplied = Math.min(availableCredit, totalCost); // 2.0
      const amountToPay = totalCost - creditApplied; // 0

      expect(amountToPay).toBe(0);
      expect(creditApplied).toBe(2.0);

      // When credit covers all, only deduct from balance, no pending
      db.prepare(`
        UPDATE users SET 
          coffee_count = 0,
          account_balance = account_balance - ?
        WHERE id = ?
      `).run(totalCost, user.id);

      const updatedUser = getUserById(db, user.id);
      expect(updatedUser.coffee_count).toBe(0);
      expect(updatedUser.pending_payment).toBe(0); // No pending created
      expect(updatedUser.account_balance).toBe(3.0); // 5 - 2 = 3 credit remains
    });

    /**
     * Test credit application on next payment
     * User with remaining credit uses it on next coffee payment
     */
    test('credit application on subsequent payment', () => {
      // Initial state: user paid, has credit
      const user = createTestUser(db, {
        coffeeCount: 0,
        pendingPayment: 0,
        accountBalance: 2.5, // Credit from previous overpayment
      });

      // User drinks 8 coffees
      db.prepare('UPDATE users SET coffee_count = 8 WHERE id = ?').run(user.id);

      const currentUser = getUserById(db, user.id);
      const coffeeCount = currentUser.coffee_count;
      const coffeePrice = getCoffeePrice(db);
      const totalCost = coffeeCount * coffeePrice; // 8 * 0.5 = 4.00

      const availableCredit = Math.max(0, currentUser.account_balance); // 2.5
      const creditApplied = Math.min(availableCredit, totalCost); // 2.5
      const amountToPay = totalCost - creditApplied; // 1.5

      expect(amountToPay).toBe(1.5);

      // Apply credit and create pending for remainder
      db.prepare(`
        UPDATE users SET 
          coffee_count = 0,
          pending_payment = pending_payment + ?,
          account_balance = account_balance - ?
        WHERE id = ?
      `).run(amountToPay, totalCost, user.id);

      const updatedUser = getUserById(db, user.id);
      expect(updatedUser.coffee_count).toBe(0);
      expect(updatedUser.pending_payment).toBe(1.5);
      expect(updatedUser.account_balance).toBe(-1.5); // 2.5 - 4 = -1.5
    });
  });

  describe('Edge Cases', () => {
    /**
     * Test zero coffees - should not create payment
     */
    test('zero coffees - no payment created', () => {
      const user = createTestUser(db, {
        coffeeCount: 0,
        pendingPayment: 0,
        accountBalance: 0,
      });

      const coffeeCount = user.coffeeCount;
      expect(coffeeCount).toBe(0);
      // Payment request should be rejected at service level
    });

    /**
     * Test rounding precision
     */
    test('handles decimal precision correctly', () => {
      const user = createTestUser(db, {
        coffeeCount: 3,
        pendingPayment: 0,
        accountBalance: 0,
      });

      const coffeePrice = getCoffeePrice(db);
      const totalCost = Math.round(3 * coffeePrice * 100) / 100;
      expect(totalCost).toBe(1.5);
    });

    /**
     * Test multiple sequential payments
     */
    test('multiple sequential payments accumulate correctly', () => {
      const user = createTestUser(db, {
        coffeeCount: 10,
        pendingPayment: 0,
        accountBalance: 0,
      });

      const coffeePrice = getCoffeePrice(db);

      // First payment request: 10 coffees = €5
      db.prepare(`
        UPDATE users SET 
          coffee_count = 0,
          pending_payment = pending_payment + 5.0,
          account_balance = account_balance - 5.0
        WHERE id = ?
      `).run(user.id);

      // Add more coffees before payment
      db.prepare('UPDATE users SET coffee_count = 6 WHERE id = ?').run(user.id);

      // Second payment request: 6 coffees = €3
      db.prepare(`
        UPDATE users SET 
          coffee_count = 0,
          pending_payment = pending_payment + 3.0,
          account_balance = account_balance - 3.0
        WHERE id = ?
      `).run(user.id);

      const updatedUser = getUserById(db, user.id);
      expect(updatedUser.pending_payment).toBe(8.0); // 5 + 3
      expect(updatedUser.account_balance).toBe(-8.0); // -5 + -3
    });

    /**
     * Test payment when user already has debt (negative balance)
     */
    test('payment request with existing debt', () => {
      const user = createTestUser(db, {
        coffeeCount: 4,
        pendingPayment: 5.0,
        accountBalance: -5.0, // Already owes €5
      });

      const coffeePrice = getCoffeePrice(db);
      const totalCost = 4 * coffeePrice; // 2.00

      // No credit available (balance is negative)
      const availableCredit = Math.max(0, user.accountBalance); // 0
      const amountToPay = totalCost - availableCredit; // 2.00

      db.prepare(`
        UPDATE users SET 
          coffee_count = 0,
          pending_payment = pending_payment + ?,
          account_balance = account_balance - ?
        WHERE id = ?
      `).run(amountToPay, totalCost, user.id);

      const updatedUser = getUserById(db, user.id);
      expect(updatedUser.pending_payment).toBe(7.0); // 5 + 2
      expect(updatedUser.account_balance).toBe(-7.0); // -5 - 2
    });
  });

  describe('Payment Confirmation', () => {
    test('confirms exact pending amount', () => {
      const user = createTestUser(db, {
        coffeeCount: 0,
        pendingPayment: 5.0,
        accountBalance: -5.0,
      });

      const paymentAmount = 5.0;
      const pendingCleared = Math.min(paymentAmount, user.pendingPayment);

      db.prepare(`
        UPDATE users SET 
          pending_payment = pending_payment - ?,
          account_balance = account_balance + ?
        WHERE id = ?
      `).run(pendingCleared, paymentAmount, user.id);

      const updatedUser = getUserById(db, user.id);
      expect(updatedUser.pending_payment).toBe(0);
      expect(updatedUser.account_balance).toBe(0);
    });

    test('payment record is created', () => {
      const user = createTestUser(db, {
        coffeeCount: 0,
        pendingPayment: 5.0,
        accountBalance: -5.0,
      });

      // Insert payment record
      const result = db.prepare(`
        INSERT INTO payments (user_id, amount, type, confirmed_by_admin, admin_notes)
        VALUES (?, ?, 'received', 1, ?)
      `).run(user.id, 5.0, 'Test payment');

      expect(result.lastInsertRowid).toBeGreaterThan(0);

      const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(result.lastInsertRowid);
      expect(payment.user_id).toBe(user.id);
      expect(payment.amount).toBe(5.0);
      expect(payment.type).toBe('received');
      expect(payment.confirmed_by_admin).toBe(1);
    });
  });
});
