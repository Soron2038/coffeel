const db = require('../db/database');
const logger = require('../utils/logger');

/**
 * Get all settings
 * @returns {Object} Settings as key-value pairs
 */
const getAllSettings = () => {
  const rows = db.all('SELECT key, value, updated_at FROM settings');
  const settings = {};
  
  rows.forEach(row => {
    settings[row.key] = {
      value: row.value,
      updatedAt: row.updated_at,
    };
  });
  
  return settings;
};

/**
 * Get a single setting by key
 * @param {string} key - Setting key
 * @returns {string|null} Setting value or null
 */
const getSetting = (key) => {
  const row = db.get('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : null;
};

/**
 * Get coffee price as number
 * @returns {number} Coffee price
 */
const getCoffeePrice = () => {
  const price = getSetting('coffee_price');
  return price ? parseFloat(price) : 0.50; // Default to 0.50
};

/**
 * Get admin email
 * @returns {string} Admin email
 */
const getAdminEmail = () => {
  return getSetting('admin_email') || process.env.ADMIN_EMAIL || 'admin@example.com';
};

/**
 * Get bank details
 * @returns {Object} Bank details
 */
const getBankDetails = () => {
  return {
    iban: getSetting('bank_iban') || process.env.BANK_IBAN || '',
    bic: getSetting('bank_bic') || process.env.BANK_BIC || '',
    owner: getSetting('bank_owner') || process.env.BANK_OWNER || '',
  };
};

/**
 * Update a setting
 * @param {string} key - Setting key
 * @param {string} value - New value
 * @returns {Object} Result
 */
const updateSetting = (key, value) => {
  // Validate key (only allow known settings)
  const allowedKeys = [
    'coffee_price',
    'admin_email',
    'bank_iban',
    'bank_bic',
    'bank_owner',
  ];

  if (!allowedKeys.includes(key)) {
    return { success: false, error: 'Invalid setting key' };
  }

  // Validate value based on key
  if (key === 'coffee_price') {
    const price = parseFloat(value);
    if (isNaN(price) || price < 0 || price > 100) {
      return { success: false, error: 'Invalid coffee price (must be 0-100)' };
    }
    value = price.toFixed(2);
  }

  if (key === 'admin_email') {
    // Basic email validation
    if (!value || !value.includes('@')) {
      return { success: false, error: 'Invalid email address' };
    }
  }

  try {
    // Upsert the setting
    db.run(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value]
    );

    logger.info('Setting updated', { key, value });
    return { success: true, key, value };
  } catch (err) {
    logger.error('Failed to update setting', { error: err.message, key });
    return { success: false, error: 'Failed to update setting' };
  }
};

/**
 * Update multiple settings at once
 * @param {Object} settings - Object with key-value pairs
 * @returns {Object} Result with updated settings
 */
const updateSettings = (settings) => {
  const results = {};
  const errors = [];

  db.transaction(() => {
    for (const [key, value] of Object.entries(settings)) {
      const result = updateSetting(key, value);
      if (result.success) {
        results[key] = value;
      } else {
        errors.push(`${key}: ${result.error}`);
      }
    }
  });

  if (errors.length > 0) {
    return { success: false, errors, updated: results };
  }

  return { success: true, updated: results };
};

module.exports = {
  getAllSettings,
  getSetting,
  getCoffeePrice,
  getAdminEmail,
  getBankDetails,
  updateSetting,
  updateSettings,
};
