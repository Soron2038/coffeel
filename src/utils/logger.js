const LOG_LEVELS = {
  ERROR: 'ERROR',
  WARN: 'WARN',
  INFO: 'INFO',
  DEBUG: 'DEBUG',
};

const log = (level, message, meta = {}) => {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    message,
    ...meta,
  };

  const output = `[${timestamp}] ${level}: ${message}`;

  switch (level) {
  case LOG_LEVELS.ERROR:
    console.error(output, meta);
    break;
  case LOG_LEVELS.WARN:
    console.warn(output, meta);
    break;
  case LOG_LEVELS.DEBUG:
    if (process.env.NODE_ENV === 'development') {
      console.log(output, meta);
    }
    break;
  default:
    console.log(output, meta);
  }

  return logEntry;
};

module.exports = {
  error: (message, meta) => log(LOG_LEVELS.ERROR, message, meta),
  warn: (message, meta) => log(LOG_LEVELS.WARN, message, meta),
  info: (message, meta) => log(LOG_LEVELS.INFO, message, meta),
  debug: (message, meta) => log(LOG_LEVELS.DEBUG, message, meta),
};
