const db = require('../db/database');
const logger = require('../utils/logger');
const settingsService = require('./settingsService');
const emailService = require('./emailService');
const userService = require('./userService');

/**
 * Request payment for a user
 * This is the main payment flow when user clicks "Pay" button
 * 
 * Logic:
 * 1. Use currentTab as the amount to pay (already in EUR)
 * 2. Apply existing credit: amount -= max(0, account_balance)
 * 3. If amount > 0 after credit:
 *    - Send email
 *    - Set current_tab = 0
 *    - Increase pending_payment += amount
 *    - Decrease account_balance -= amount
 *    - Create payments entry (type='request')
 * 4. If credit covers all costs:
 *    - Set current_tab = 0
 *    - Decrease account_balance only
 *    - No email needed
 * 
 * @param {number} userId - User ID
 * @returns {Object} Result with payment details
 */
const requestPayment = async (userId) => {
  const user = userService.getUserById(userId);
  if (!user) {
    return { success: false, error: 'User not found' };
  }

  const currentTab = user.currentTab;
  if (currentTab <= 0) {
    return { success: false, error: 'No amount to pay' };
  }

  const totalCost = Math.round(currentTab * 100) / 100;
  
  // Calculate credit that can be applied
  const availableCredit = Math.max(0, user.accountBalance);
  const creditApplied = Math.min(availableCredit, totalCost);
  const amountToPay = Math.round((totalCost - creditApplied) * 100) / 100;

  let emailSent = false;
  let paymentId = null;

  try {
    // Execute payment logic atomically
    db.transaction(() => {
      if (amountToPay > 0) {
        // Case: User needs to pay (credit doesn't cover all)
        
        // Update user record
        db.run(
          `UPDATE users SET 
            current_tab = 0,
            pending_payment = pending_payment + ?,
            account_balance = account_balance - ?,
            last_payment_request = CURRENT_TIMESTAMP
          WHERE id = ?`,
          [amountToPay, totalCost, userId]
        );

        // Create payment record
        const paymentResult = db.run(
          `INSERT INTO payments (user_id, amount, type)
           VALUES (?, ?, 'request')`,
          [userId, amountToPay]
        );
        paymentId = paymentResult.lastInsertRowid;

        // Audit log
        db.run(
          `INSERT INTO audit_log (user_id, action, amount, performed_by)
           VALUES (?, 'payment_request', ?, 'user')`,
          [userId, amountToPay]
        );

      } else {
        // Case: Credit covers entire cost
        
        // Update user record (only deduct from credit, no pending payment)
        db.run(
          `UPDATE users SET 
            current_tab = 0,
            account_balance = account_balance - ?,
            last_payment_request = CURRENT_TIMESTAMP
          WHERE id = ?`,
          [totalCost, userId]
        );

        // Audit log for credit usage
        db.run(
          `INSERT INTO audit_log (user_id, action, amount, performed_by)
           VALUES (?, 'payment_request', ?, 'user')`,
          [userId, 0]
        );
      }
    });

    // Send email AFTER transaction (don't let email failure affect payment tracking)
    if (amountToPay > 0) {
      const emailResult = await emailService.sendPaymentRequestByAmount(user, amountToPay);
      emailSent = emailResult.success;
      
      if (!emailResult.success) {
        logger.warn('Payment request saved but email failed', {
          userId,
          amount: amountToPay,
          error: emailResult.error,
        });
      }
    }

    const updatedUser = userService.getUserById(userId);
    
    logger.info('Payment requested', {
      userId,
      totalCost,
      creditApplied,
      amountToPay,
      emailSent,
    });

    return {
      success: true,
      user: updatedUser,
      payment: {
        id: paymentId,
        totalCost,
        creditApplied,
        amountToPay,
        emailSent,
      },
      message: amountToPay > 0
        ? `Payment request sent (€${amountToPay.toFixed(2)})`
        : `Paid from credit (€${totalCost.toFixed(2)})`,
    };

  } catch (err) {
    logger.error('Failed to request payment', { error: err.message, userId });
    return { success: false, error: 'Failed to process payment request' };
  }
};

/**
 * Confirm payment received (Admin only)
 * 
 * Logic (from PRD):
 * 1. Reduce pending_payment by min(amount, pending_payment)
 * 2. Increase account_balance by amount
 * 3. Create payments entry (type='received', confirmed_by_admin=1)
 * 4. Overpayments automatically become credit
 * 
 * @param {number} userId - User ID
 * @param {number} amount - Amount received
 * @param {string} notes - Admin notes (optional)
 * @returns {Object} Result with updated balances
 */
const confirmPayment = (userId, amount, notes = '') => {
  const user = userService.getUserById(userId);
  if (!user) {
    return { success: false, error: 'User not found' };
  }

  const receivedAmount = Math.round(parseFloat(amount) * 100) / 100;
  if (isNaN(receivedAmount) || receivedAmount <= 0) {
    return { success: false, error: 'Invalid amount' };
  }

  const oldPending = user.pendingPayment;

  // Calculate how much pending is cleared vs. credit created
  const pendingCleared = Math.min(receivedAmount, oldPending);
  const creditCreated = receivedAmount - pendingCleared;

  let paymentId = null;

  try {
    db.transaction(() => {
      // Update user record
      db.run(
        `UPDATE users SET 
          pending_payment = pending_payment - ?,
          account_balance = account_balance + ?
        WHERE id = ?`,
        [pendingCleared, receivedAmount, userId]
      );

      // Create payment record
      const paymentResult = db.run(
        `INSERT INTO payments (user_id, amount, type, confirmed_by_admin, admin_notes)
         VALUES (?, ?, 'received', 1, ?)`,
        [userId, receivedAmount, notes || null]
      );
      paymentId = paymentResult.lastInsertRowid;

      // Audit log
      db.run(
        `INSERT INTO audit_log (user_id, action, amount, performed_by)
         VALUES (?, 'payment_received', ?, 'admin')`,
        [userId, receivedAmount]
      );
    });

    const updatedUser = userService.getUserById(userId);

    logger.info('Payment confirmed', {
      userId,
      amount: receivedAmount,
      pendingCleared,
      creditCreated,
      newBalance: updatedUser.accountBalance,
    });

    return {
      success: true,
      user: updatedUser,
      payment: {
        id: paymentId,
        amount: receivedAmount,
        pendingCleared,
        creditCreated,
      },
      message: creditCreated > 0
        ? `Payment confirmed. Credit: €${creditCreated.toFixed(2)}`
        : 'Payment confirmed',
    };

  } catch (err) {
    logger.error('Failed to confirm payment', { error: err.message, userId });
    return { success: false, error: 'Failed to confirm payment' };
  }
};

/**
 * Get payment history for a user or all users
 * @param {Object} filters - Filter options
 * @param {number} filters.userId - Filter by user ID
 * @param {string} filters.type - Filter by type ('request' or 'received')
 * @param {string} filters.startDate - Filter by start date (ISO string)
 * @param {string} filters.endDate - Filter by end date (ISO string)
 * @param {number} filters.limit - Maximum number of records
 * @returns {Array} Array of payment records
 */
const getPaymentHistory = (filters = {}) => {
  let sql = `
    SELECT 
      p.id,
      p.user_id,
      p.amount,
      p.type,
      p.confirmed_by_admin,
      p.admin_notes,
      p.created_at,
      u.first_name,
      u.last_name,
      u.email
    FROM payments p
    JOIN users u ON p.user_id = u.id
    WHERE 1=1
  `;
  const params = [];

  if (filters.userId) {
    sql += ' AND p.user_id = ?';
    params.push(filters.userId);
  }

  if (filters.type) {
    sql += ' AND p.type = ?';
    params.push(filters.type);
  }

  if (filters.startDate) {
    sql += ' AND p.created_at >= ?';
    params.push(filters.startDate);
  }

  if (filters.endDate) {
    sql += ' AND p.created_at <= ?';
    params.push(filters.endDate);
  }

  sql += ' ORDER BY p.created_at DESC';

  if (filters.limit) {
    sql += ' LIMIT ?';
    params.push(filters.limit);
  }

  const rows = db.all(sql, params);

  return rows.map(row => ({
    id: row.id,
    userId: row.user_id,
    userName: `${row.first_name} ${row.last_name}`,
    userEmail: row.email,
    amount: row.amount,
    type: row.type,
    confirmedByAdmin: Boolean(row.confirmed_by_admin),
    adminNotes: row.admin_notes,
    createdAt: row.created_at,
  }));
};

/**
 * Get payment summary statistics
 * @returns {Object} Summary statistics
 */
const getPaymentSummary = () => {
  const totalRequested = db.get(`
    SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE type = 'request'
  `);

  const totalReceived = db.get(`
    SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE type = 'received'
  `);

  const totalPending = db.get(`
    SELECT COALESCE(SUM(pending_payment), 0) as total FROM users WHERE deleted_by_user = 0
  `);

  const totalCredit = db.get(`
    SELECT COALESCE(SUM(account_balance), 0) as total FROM users WHERE account_balance > 0 AND deleted_by_user = 0
  `);

  // Total outstanding = currentTab + pendingPayment for all active users
  const totalOutstanding = db.get(`
    SELECT COALESCE(SUM(current_tab + pending_payment), 0) as total FROM users WHERE deleted_by_user = 0
  `);

  return {
    totalRequested: totalRequested.total,
    totalReceived: totalReceived.total,
    totalPending: totalPending.total,
    totalCredit: totalCredit.total,
    totalOutstanding: totalOutstanding.total,
  };
};

/**
 * Export all data as CSV-compatible format
 * @param {boolean} includeDeleted - Include soft-deleted users
 * @returns {Array} Array of data rows
 */
const exportData = (includeDeleted = true) => {
  let userSql = `
    SELECT 
      id,
      first_name,
      last_name,
      email,
      current_tab,
      pending_payment,
      account_balance,
      last_payment_request,
      deleted_by_user,
      deleted_at,
      created_at
    FROM users
  `;

  if (!includeDeleted) {
    userSql += ' WHERE deleted_by_user = 0';
  }

  userSql += ' ORDER BY last_name, first_name';

  const users = db.all(userSql);
  const payments = getPaymentHistory({});

  return {
    users: users.map(u => ({
      id: u.id,
      firstName: u.first_name,
      lastName: u.last_name,
      email: u.email,
      currentTab: u.current_tab,
      pendingPayment: u.pending_payment,
      accountBalance: u.account_balance,
      lastPaymentRequest: u.last_payment_request,
      deleted: u.deleted_by_user ? 'Yes' : 'No',
      deletedAt: u.deleted_at,
      createdAt: u.created_at,
    })),
    payments,
  };
};

module.exports = {
  requestPayment,
  confirmPayment,
  getPaymentHistory,
  getPaymentSummary,
  exportData,
};
