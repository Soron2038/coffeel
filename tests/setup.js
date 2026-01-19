/**
 * Jest Test Setup
 * Initializes test database before each test suite
 */

const path = require('path');

// Set test environment before loading any modules
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = ':memory:';
process.env.LOG_LEVEL = 'error';

// Suppress console during tests unless DEBUG is set
if (!process.env.DEBUG) {
  global.console = {
    ...console,
    log: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    // Keep warn and error for debugging
    warn: console.warn,
    error: console.error,
  };
}
