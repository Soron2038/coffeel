import express from 'express';
import { getDatabase } from '../db/connection.js';
import { logAudit } from '../utils/audit.js';
import { sendPaymentRequestEmail } from '../utils/email.js';
import { requireAdmin, optionalAdmin } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/users - List all users (optionally including deleted)
 * Query params:
 * - includeDeleted=true (admin only)
 */
router.get('/', optionalAdmin, (req, res) => {
  try {
    const db = getDatabase();
    const includeDeleted = req.query.includeDeleted === 'true' && req.isAdmin;
    
    let query = `
      SELECT 
        id, first_name as firstName, last_name as lastName, email,
        coffee_count as coffeeCount, pending_payment as pendingPayment,
        account_balance as accountBalance, last_payment_request as lastPaymentRequest,
        deleted_by_user as deletedByUser, deleted_at as deletedAt,
        created_at as createdAt, updated_at as updatedAt
      FROM users
    `;
    
    if (!includeDeleted) {
      query += ' WHERE deleted_by_user = 0';
    }
    
    query += ' ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE';
    
    const users = db.prepare(query).all();
    
    res.json(users);
  } catch (error) {
    console.error('❌ Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

/**
 * POST /api/users - Create new user
 * Body: { firstName, lastName, email }
 */
router.post('/', (req, res) => {
  try {
    const { firstName, lastName, email } = req.body;
    
    // Validation
    if (!firstName || firstName.length < 2) {
      return res.status(400).json({ error: 'First name must be at least 2 characters' });
    }
    
    if (!lastName || lastName.length < 2) {
      return res.status(400).json({ error: 'Last name must be at least 2 characters' });
    }
    
    if (!email || !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    
    const db = getDatabase();
    
    // Check for duplicate email (case-insensitive)
    const existing = db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(email);
    if (existing) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    
    // Insert user
    const stmt = db.prepare(`
      INSERT INTO users (first_name, last_name, email)
      VALUES (?, ?, ?)
    `);
    
    const result = stmt.run(firstName, lastName, email.toLowerCase());
    
    // Get created user
    const user = db.prepare(`
      SELECT 
        id, first_name as firstName, last_name as lastName, email,
        coffee_count as coffeeCount, pending_payment as pendingPayment,
        account_balance as accountBalance
      FROM users WHERE id = ?
    `).get(result.lastInsertRowid);
    
    // Audit log
    logAudit({
      userId: user.id,
      action: 'increment', // User registration counts as first action
      oldValue: null,
      newValue: 0,
      performedBy: 'user',
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });
    
    res.status(201).json(user);
  } catch (error) {
    console.error('❌ Error creating user:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

/**
 * DELETE /api/users/:id - Soft delete user (self-service)
 */
router.delete('/:id', (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const db = getDatabase();
    
    // Check if user exists
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    if (user.deleted_by_user) {
      return res.status(400).json({ error: 'User already deleted' });
    }
    
    // Soft delete
    const stmt = db.prepare(`
      UPDATE users 
      SET deleted_by_user = 1, deleted_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    
    stmt.run(userId);
    
    // Audit log
    logAudit({
      userId,
      action: 'soft_delete',
      oldValue: 0,
      newValue: 1,
      performedBy: 'user',
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });
    
    res.json({
      id: userId,
      deletedByUser: true,
      deletedAt: new Date().toISOString(),
      message: 'User soft-deleted successfully'
    });
  } catch (error) {
    console.error('❌ Error deleting user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

/**
 * POST /api/users/:id/restore - Restore deleted user (admin only)
 */
router.post('/:id/restore', requireAdmin, (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const db = getDatabase();
    
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    if (!user.deleted_by_user) {
      return res.status(400).json({ error: 'User is not deleted' });
    }
    
    // Restore
    const stmt = db.prepare(`
      UPDATE users 
      SET deleted_by_user = 0, deleted_at = NULL
      WHERE id = ?
    `);
    
    stmt.run(userId);
    
    // Audit log
    logAudit({
      userId,
      action: 'restore',
      oldValue: 1,
      newValue: 0,
      performedBy: 'admin',
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });
    
    res.json({
      id: userId,
      deletedByUser: false,
      deletedAt: null,
      message: 'User restored successfully'
    });
  } catch (error) {
    console.error('❌ Error restoring user:', error);
    res.status(500).json({ error: 'Failed to restore user' });
  }
});

/**
 * DELETE /api/users/:id/permanent - Permanently delete user (admin only)
 */
router.delete('/:id/permanent', requireAdmin, (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const db = getDatabase();
    
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Audit log before deletion
    logAudit({
      userId,
      action: 'hard_delete',
      performedBy: 'admin',
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });
    
    // Hard delete
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    
    res.json({ message: 'User permanently deleted' });
  } catch (error) {
    console.error('❌ Error permanently deleting user:', error);
    res.status(500).json({ error: 'Failed to permanently delete user' });
  }
});

/**
 * POST /api/users/:id/increment - Increment coffee count
 */
router.post('/:id/increment', (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const db = getDatabase();
    
    const user = db.prepare('SELECT coffee_count FROM users WHERE id = ? AND deleted_by_user = 0').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const oldValue = user.coffee_count;
    const newValue = oldValue + 1;
    
    db.prepare('UPDATE users SET coffee_count = ? WHERE id = ?').run(newValue, userId);
    
    // Audit log
    logAudit({
      userId,
      action: 'increment',
      oldValue,
      newValue,
      performedBy: 'user',
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });
    
    const updated = db.prepare(`
      SELECT id, coffee_count as coffeeCount, account_balance as accountBalance
      FROM users WHERE id = ?
    `).get(userId);
    
    res.json(updated);
  } catch (error) {
    console.error('❌ Error incrementing coffee count:', error);
    res.status(500).json({ error: 'Failed to increment coffee count' });
  }
});

/**
 * POST /api/users/:id/decrement - Decrement coffee count (min 0)
 */
router.post('/:id/decrement', (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const db = getDatabase();
    
    const user = db.prepare('SELECT coffee_count FROM users WHERE id = ? AND deleted_by_user = 0').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const oldValue = user.coffee_count;
    const newValue = Math.max(0, oldValue - 1);
    
    db.prepare('UPDATE users SET coffee_count = ? WHERE id = ?').run(newValue, userId);
    
    // Audit log
    logAudit({
      userId,
      action: 'decrement',
      oldValue,
      newValue,
      performedBy: 'user',
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });
    
    const updated = db.prepare(`
      SELECT id, coffee_count as coffeeCount, account_balance as accountBalance
      FROM users WHERE id = ?
    `).get(userId);
    
    res.json(updated);
  } catch (error) {
    console.error('❌ Error decrementing coffee count:', error);
    res.status(500).json({ error: 'Failed to decrement coffee count' });
  }
});

/**
 * POST /api/users/:id/pay - Send payment request email
 * Implements credit application logic per WARP.md lines 111-131
 */
router.post('/:id/pay', async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const db = getDatabase();
    
    // Get user and coffee price
    const user = db.prepare(`
      SELECT * FROM users WHERE id = ? AND deleted_by_user = 0
    `).get(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    if (user.coffee_count === 0) {
      return res.status(400).json({ error: 'No coffees to pay for' });
    }
    
    const coffeePrice = parseFloat(
      db.prepare('SELECT value FROM settings WHERE key = "coffee_price"').get().value
    );
    
    // Payment flow logic (CRITICAL - per WARP.md)
    const coffeeCount = user.coffee_count;
    let calculatedAmount = coffeeCount * coffeePrice;
    
    // Apply existing credit
    if (user.account_balance > 0) {
      calculatedAmount = Math.max(0, calculatedAmount - user.account_balance);
    }
    
    // Use transaction for atomicity (WARP.md line 217)
    const transaction = db.transaction(() => {
      if (calculatedAmount > 0) {
        // Need to send email - update all payment fields
        db.prepare(`
          UPDATE users 
          SET coffee_count = 0,
              pending_payment = pending_payment + ?,
              account_balance = account_balance - ?,
              last_payment_request = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(calculatedAmount, calculatedAmount, userId);
        
        // Create payment record
        db.prepare(`
          INSERT INTO payments (user_id, amount, type, coffee_count)
          VALUES (?, ?, 'request', ?)
        `).run(userId, calculatedAmount, coffeeCount);
        
      } else {
        // Credit covers everything - just update balance and reset count
        db.prepare(`
          UPDATE users 
          SET coffee_count = 0,
              account_balance = account_balance - ?
          WHERE id = ?
        `).run(coffeeCount * coffeePrice, userId);
      }
    });
    
    transaction();
    
    // Get payment ID
    const paymentId = calculatedAmount > 0 
      ? db.prepare('SELECT last_insert_rowid() as id').get().id 
      : null;
    
    // Send email if amount > 0 (AFTER transaction completes)
    let emailSent = false;
    let emailError = null;
    
    if (calculatedAmount > 0) {
      const emailResult = await sendPaymentRequestEmail({
        userEmail: user.email,
        userName: `${user.first_name} ${user.last_name}`,
        coffeeCount,
        amount: calculatedAmount,
        coffeePrice
      });
      
      emailSent = emailResult.success;
      emailError = emailResult.error;
      
      // IMPORTANT: Per WARP.md line 187, NEVER reset payment state on SMTP failure
      // Payment is already committed to database
    }
    
    // Audit log
    logAudit({
      userId,
      action: 'payment_request',
      oldValue: coffeeCount,
      newValue: 0,
      amount: calculatedAmount,
      performedBy: 'user',
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });
    
    // Get updated user
    const updatedUser = db.prepare(`
      SELECT 
        id, coffee_count as coffeeCount, pending_payment as pendingPayment,
        account_balance as accountBalance
      FROM users WHERE id = ?
    `).get(userId);
    
    const response = {
      ...updatedUser,
      emailSent,
      paymentId,
      message: calculatedAmount > 0 
        ? `Payment request sent to ${user.email} (€${calculatedAmount.toFixed(2)})`
        : 'Payment covered by existing credit'
    };
    
    if (emailError) {
      response.emailError = emailError;
    }
    
    res.json(response);
  } catch (error) {
    console.error('❌ Error processing payment request:', error);
    res.status(500).json({ error: 'Failed to process payment request' });
  }
});

/**
 * POST /api/users/:id/confirm-payment - Admin confirms payment received
 * Body: { amount, notes }
 */
router.post('/:id/confirm-payment', requireAdmin, (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { amount, notes } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }
    
    const db = getDatabase();
    
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Payment confirmation logic (per WARP.md lines 127-131)
    const transaction = db.transaction(() => {
      // Reduce pending_payment by min(amount, pending_payment)
      const reductionAmount = Math.min(amount, user.pending_payment);
      
      // Increase account_balance by full amount
      db.prepare(`
        UPDATE users 
        SET pending_payment = pending_payment - ?,
            account_balance = account_balance + ?
        WHERE id = ?
      `).run(reductionAmount, amount, userId);
      
      // Create payment record
      db.prepare(`
        INSERT INTO payments (user_id, amount, type, confirmed_by_admin, admin_notes)
        VALUES (?, ?, 'received', 1, ?)
      `).run(userId, amount, notes || null);
    });
    
    transaction();
    
    const paymentId = db.prepare('SELECT last_insert_rowid() as id').get().id;
    
    // Audit log
    logAudit({
      userId,
      action: 'payment_received',
      amount,
      performedBy: 'admin',
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });
    
    // Get updated user
    const updatedUser = db.prepare(`
      SELECT 
        id, pending_payment as pendingPayment,
        account_balance as accountBalance
      FROM users WHERE id = ?
    `).get(userId);
    
    const creditAmount = updatedUser.accountBalance;
    const message = creditAmount > 0 
      ? `Payment confirmed. Credit: €${creditAmount.toFixed(2)}`
      : 'Payment confirmed';
    
    res.json({
      ...updatedUser,
      paymentId,
      message
    });
  } catch (error) {
    console.error('❌ Error confirming payment:', error);
    res.status(500).json({ error: 'Failed to confirm payment' });
  }
});

export default router;
