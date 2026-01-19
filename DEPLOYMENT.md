# CofFeEL Deployment Guide

This guide covers deploying CofFeEL to an Ubuntu server with Nginx, PM2, SSL, and automated backups.

**Current Production Server:** `cfelm-pcx65344.desy.de` (131.169.224.146)

## Prerequisites

- Ubuntu 22.04 LTS or newer (tested on Ubuntu 24.04.3 LTS)
- SSH access with sudo privileges
- Node.js 20.x LTS, PM2, Nginx
- SMTP credentials for email sending
- Domain name (optional, for SSL)

## Quick Deploy (Existing Server)

If the server is already set up, use this one-liner from your development machine:

```bash
rsync -avz --exclude 'node_modules' --exclude '.git' --exclude 'data' --exclude '.env' --exclude 'coverage' \
  /path/to/coffeel/ user@server:/opt/coffeel/ && \
  ssh user@server "cd /opt/coffeel && npm install --production && pm2 restart coffeel"
```

Or step by step:

```bash
# 1. Sync files (excludes data and config)
rsync -avz --exclude 'node_modules' --exclude '.git' --exclude 'data' --exclude '.env' --exclude 'coverage' \
  /path/to/coffeel/ user@server:/opt/coffeel/

# 2. Install dependencies and restart
ssh user@server "cd /opt/coffeel && npm install --production && pm2 restart coffeel"
```

---

## Fresh Server Setup

### 1. Update System

```bash
sudo apt update && sudo apt upgrade -y
```

### 2. Install Node.js 20.x LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version  # Should show v20.x.x
npm --version   # Should show 10.x.x
```

### 3. Install Build Tools (for native modules)

```bash
sudo apt install -y build-essential python3
```

### 4. Install Nginx

```bash
sudo apt install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

### 5. Install PM2 (Process Manager)

```bash
sudo npm install -g pm2
pm2 --version
```

## Application Setup

### Create Application Directory

```bash
sudo mkdir -p /opt/coffeel
sudo chown $USER:$USER /opt/coffeel
```

### Option A: Clone from GitHub

```bash
git clone https://github.com/Soron2038/coffeel.git /opt/coffeel
cd /opt/coffeel
```

### Option B: Transfer via rsync (from development machine)

```bash
rsync -avz --exclude 'node_modules' --exclude '.git' --exclude 'data' --exclude '.env' \
  /path/to/local/coffeel/ user@server:/opt/coffeel/
```

### Install Dependencies

```bash
cd /opt/coffeel
npm install --production
```

### Configure Environment

```bash
cp .env.example .env
nano .env
```

Edit `.env` with production values:

```env
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# Database (created automatically)
DB_PATH=./data/coffee.db

# SMTP (configure in Admin Panel or here)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=coffee@example.com
SMTP_PASS=your-smtp-password
SMTP_FROM="CofFeEL <coffee@example.com>"

# Bank details
BANK_IBAN=DE89370400440532013000
BANK_BIC=COBADEFFXXX
BANK_OWNER="CFEL Coffee Fund"

# Initial settings (can be changed in Admin Panel)
COFFEE_PRICE=0.50
ADMIN_EMAIL=admin@example.com
```

### Initialize Database

```bash
npm run db:init
```

This creates the SQLite database with schema and a default admin user: `admin` / `admin`

**Important:** Change the admin password immediately after first login!

### Set Permissions (optional, for stricter security)

```bash
chmod 600 .env
```

## PM2 Configuration

### Start Application (Simple Method)

```bash
cd /opt/coffeel
pm2 start src/server.js --name coffeel
pm2 save
```

### Setup PM2 Startup (survives reboot)

```bash
pm2 startup
# Follow the instructions printed by this command (copy & run the sudo line)
pm2 save
```

### Verify Application

```bash
pm2 status
curl http://localhost:3000/api/users
```

### Alternative: Ecosystem File (optional)

For more control, create `ecosystem.config.js`:

```javascript
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
  }],
};
```

Then start with: `pm2 start ecosystem.config.js`

## Nginx Configuration

### Create Site Config

```bash
sudo nano /etc/nginx/sites-available/coffeel
```

```nginx
server {
    listen 80;
    server_name _;  # Accept any hostname (or replace with your domain)

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Enable Site

```bash
# Create symlink
sudo ln -s /etc/nginx/sites-available/coffeel /etc/nginx/sites-enabled/

# Remove default site (optional)
sudo rm -f /etc/nginx/sites-enabled/default

# Test and reload
sudo nginx -t
sudo systemctl reload nginx
```

## Accessing the Application

- **Kiosk UI:** `http://your-server-ip/`
- **Admin Panel:** `http://your-server-ip/admin.html`

Default admin credentials: `admin` / `admin` — **Change immediately!**

---

## SSL Certificate (Let's Encrypt)

### Install Certbot

```bash
sudo apt install -y certbot python3-certbot-nginx
```

### Obtain Certificate

```bash
sudo certbot --nginx -d coffeel.example.com
```

Follow the prompts. Certbot will automatically configure Nginx for HTTPS.

### Auto-Renewal

Certbot sets up automatic renewal. Test it:

```bash
sudo certbot renew --dry-run
```

## 6. Automated Backups

### Create Backup Script

```bash
sudo nano /opt/coffeel/scripts/daily-backup.sh
```

```bash
#!/bin/bash
# CofFeEL Daily Backup Script

BACKUP_DIR="/opt/coffeel/backups"
DB_PATH="/opt/coffeel/data/coffee.db"
DATE=$(date +%Y%m%d_%H%M%S)
KEEP_DAYS=30

# Create backup directory
mkdir -p $BACKUP_DIR

# Create backup with SQLite online backup
sqlite3 $DB_PATH ".backup '$BACKUP_DIR/coffee_$DATE.db'"

# Compress backup
gzip $BACKUP_DIR/coffee_$DATE.db

# Remove old backups (older than KEEP_DAYS)
find $BACKUP_DIR -name "coffee_*.db.gz" -mtime +$KEEP_DAYS -delete

# Log backup
echo "$(date): Backup created - coffee_$DATE.db.gz" >> /var/log/coffeel/backup.log
```

### Make Executable

```bash
sudo chmod +x /opt/coffeel/scripts/daily-backup.sh
sudo chown coffeel:coffeel /opt/coffeel/scripts/daily-backup.sh
```

### Setup Cron Job (Daily at 3 AM)

```bash
sudo -u coffeel crontab -e
```

Add:

```cron
0 3 * * * /opt/coffeel/scripts/daily-backup.sh
```

## 7. Firewall Configuration

### Setup UFW

```bash
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
```

## 8. Monitoring

### Check Application Status

```bash
sudo -u coffeel pm2 status
sudo -u coffeel pm2 logs coffeel
```

### Monitor Resources

```bash
sudo -u coffeel pm2 monit
```

### Health Check Endpoint

```bash
curl http://localhost:3000/api/health
```

### Setup UptimeRobot (Optional)

1. Go to [UptimeRobot](https://uptimerobot.com)
2. Add new monitor: `https://coffeel.example.com/api/health`
3. Set interval: 5 minutes
4. Add email alert

## Updating the Application

### From Development Machine (recommended)

```bash
# One-liner deploy
rsync -avz --exclude 'node_modules' --exclude '.git' --exclude 'data' --exclude '.env' --exclude 'coverage' \
  /path/to/coffeel/ user@server:/opt/coffeel/ && \
  ssh user@server "pm2 restart coffeel"
```

### On Server (git pull)

```bash
cd /opt/coffeel

# Create backup first!
cp data/coffee.db data/coffee_backup_$(date +%Y%m%d).db

# Pull updates
git pull

# Install dependencies (if package.json changed)
npm install --production

# Restart application
pm2 restart coffeel
```

## Useful Commands

```bash
# Application
pm2 status                  # Check status
pm2 logs coffeel            # View logs (Ctrl+C to exit)
pm2 logs coffeel --lines 50 # Last 50 lines
pm2 restart coffeel         # Restart
pm2 stop coffeel            # Stop
pm2 monit                   # Real-time monitoring

# Nginx
sudo systemctl status nginx # Check Nginx status
sudo nginx -t               # Test config
sudo systemctl reload nginx # Reload config

# Database
sqlite3 /opt/coffeel/data/coffee.db  # Open database shell
npm run db:backup           # Create backup

# Logs
pm2 logs coffeel                          # PM2 logs
sudo tail -f /var/log/nginx/access.log    # Nginx access
sudo tail -f /var/log/nginx/error.log     # Nginx errors
```

## Troubleshooting

### Application won't start

```bash
# Check logs
pm2 logs coffeel --lines 100

# Check if port is in use
sudo lsof -i:3000

# Verify Node version (must be 20.x)
node --version

# Verify .env exists
cat /opt/coffeel/.env
```

### 502 Bad Gateway

1. Check if PM2 is running: `pm2 status`
2. Test app directly: `curl http://localhost:3000/api/users`
3. Check Nginx config: `sudo nginx -t`
4. Check Nginx error log: `sudo tail /var/log/nginx/error.log`

### SSL Issues

```bash
# Check certificate status
sudo certbot certificates

# Renew manually
sudo certbot renew
```

### Database Issues

```bash
# Check database integrity
sqlite3 /opt/coffeel/data/coffee.db "PRAGMA integrity_check;"

# Restore from backup
cp /opt/coffeel/backups/coffee_LATEST.db /opt/coffeel/data/coffee.db
```

## Security Checklist

- [ ] Strong ADMIN_PASS in .env
- [ ] HTTPS enabled and forced
- [ ] Firewall configured (UFW)
- [ ] .env file has restricted permissions (600)
- [ ] Regular backups running
- [ ] PM2 configured for auto-restart
- [ ] Nginx security headers enabled
- [ ] Server updates automated

## Architecture Overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Browser   │────▶│    Nginx    │────▶│   Node.js   │
│  (iPad/PC)  │     │   (Port 80) │     │ (Port 3000) │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
                                        ┌──────▼──────┐
                                        │   SQLite    │
                                        │  Database   │
                                        └─────────────┘
```

- **Nginx**: Reverse proxy, handles SSL termination
- **Node.js/Express**: Application server (managed by PM2)
- **SQLite**: Embedded database (file-based, no separate server)
- **PM2**: Process manager with auto-restart and log management

## Support

For issues, check:
1. PM2 logs: `pm2 logs coffeel`
2. Nginx error logs: `sudo tail /var/log/nginx/error.log`
3. Application health: `curl localhost:3000/api/users`
