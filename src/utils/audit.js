import { getDatabase } from '../db/connection.js';

/**
 * Log an action to the audit_log table
 * @param {Object} params - Audit log parameters
 * @param {number|null} params.userId - User ID (null for system actions)
 * @param {string} params.action - Action type (increment, decrement, payment_request, etc.)
 * @param {number|null} params.oldValue - Old value before change
 * @param {number|null} params.newValue - New value after change
 * @param {number|null} params.amount - Amount for payment actions
 * @param {string} params.performedBy - 'user' or 'admin'
 * @param {string|null} params.ipAddress - IP address of requester
 * @param {string|null} params.userAgent - User agent string
 */
export function logAudit({
  userId = null,
  action,
  oldValue = null,
  newValue = null,
  amount = null,
  performedBy = 'user',
  ipAddress = null,
  userAgent = null
}) {
  try {
    const db = getDatabase();
    
    const stmt = db.prepare(`
      INSERT INTO audit_log (
        user_id, action, old_value, new_value, amount,
        performed_by, ip_address, user_agent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      userId,
      action,
      oldValue,
      newValue,
      amount,
      performedBy,
      ipAddress,
      userAgent
    );
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`📝 Audit: ${action} by ${performedBy} for user ${userId || 'N/A'}`);
    }
  } catch (error) {
    console.error('❌ Audit logging failed:', error);
    // Don't throw - audit failures shouldn't break the main operation
  }
}

/**
 * Get audit log entries for a user
 * @param {number} userId - User ID
 * @param {number} limit - Max number of entries to return
 * @returns {Array} Audit log entries
 */
export function getUserAuditLog(userId, limit = 50) {
  const db = getDatabase();
  
  const stmt = db.prepare(`
    SELECT * FROM audit_log
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `);
  
  return stmt.all(userId, limit);
}

/**
 * Get recent audit log entries
 * @param {number} limit - Max number of entries to return
 * @returns {Array} Audit log entries
 */
export function getRecentAuditLog(limit = 100) {
  const db = getDatabase();
  
  const stmt = db.prepare(`
    SELECT 
      audit_log.*,
      users.first_name,
      users.last_name,
      users.email
    FROM audit_log
    LEFT JOIN users ON audit_log.user_id = users.id
    ORDER BY audit_log.created_at DESC
    LIMIT ?
  `);
  
  return stmt.all(limit);
}
