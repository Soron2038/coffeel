// RFC 5322 compliant email validation (simplified but effective)
const validateEmail = (email) => {
  if (!email || typeof email !== 'string') {
    return false;
  }

  // Basic RFC 5322 pattern
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return emailRegex.test(email);
};

// Validate user input for registration
const validateUserInput = (firstName, lastName, email) => {
  const errors = [];

  // First name validation
  if (!firstName || typeof firstName !== 'string') {
    errors.push('First name is required');
  } else if (firstName.trim().length < 2) {
    errors.push('First name must be at least 2 characters');
  } else if (firstName.trim().length > 100) {
    errors.push('First name must be less than 100 characters');
  }

  // Last name validation
  if (!lastName || typeof lastName !== 'string') {
    errors.push('Last name is required');
  } else if (lastName.trim().length < 2) {
    errors.push('Last name must be at least 2 characters');
  } else if (lastName.trim().length > 100) {
    errors.push('Last name must be less than 100 characters');
  }

  // Email validation
  if (!email || typeof email !== 'string') {
    errors.push('Email is required');
  } else if (!validateEmail(email)) {
    errors.push('Invalid email format');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

// Sanitize string input to prevent XSS
const sanitizeInput = (str) => {
  if (typeof str !== 'string') {
    return '';
  }

  return str
    .trim()
    .replace(/[<>]/g, '') // Remove < and > characters
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, ''); // Remove event handlers like onclick=
};

// Validate payment amount
const validatePaymentAmount = (amount) => {
  const numAmount = parseFloat(amount);
  
  if (isNaN(numAmount)) {
    return { isValid: false, error: 'Amount must be a number' };
  }

  if (numAmount < 0) {
    return { isValid: false, error: 'Amount must be positive' };
  }

  if (numAmount > 10000) {
    return { isValid: false, error: 'Amount exceeds maximum (10000)' };
  }

  // Round to 2 decimal places
  const roundedAmount = Math.round(numAmount * 100) / 100;

  return { isValid: true, amount: roundedAmount };
};

// Validate integer ID
const validateId = (id) => {
  const numId = parseInt(id, 10);
  return !isNaN(numId) && numId > 0;
};

/**
 * Express middleware to validate :id parameter
 * Adds parsed userId to req object
 */
const validateIdParam = (req, res, next) => {
  if (!validateId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid user ID' });
  }
  req.userId = parseInt(req.params.id, 10);
  next();
};

/**
 * Async handler wrapper to avoid try/catch in every route
 * Catches errors and passes them to error handler
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = {
  validateEmail,
  validateUserInput,
  sanitizeInput,
  validatePaymentAmount,
  validateId,
  validateIdParam,
  asyncHandler,
};
