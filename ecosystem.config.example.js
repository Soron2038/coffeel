/**
 * PM2 Ecosystem Configuration
 * Copy to ecosystem.config.js and adjust paths for your server
 */

module.exports = {
  apps: [{
    name: 'coffeel',
    script: 'src/server.js',
    cwd: '/opt/coffeel',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '256M',
    env: {
      NODE_ENV: 'production',
    },
    error_file: '/var/log/coffeel/error.log',
    out_file: '/var/log/coffeel/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    
    // Graceful shutdown
    kill_timeout: 5000,
    wait_ready: true,
    listen_timeout: 10000,
  }],
};
