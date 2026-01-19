# CofFeEL Deployment Guide

This guide covers deploying CofFeEL to an Ubuntu server with Nginx, PM2, SSL, and automated backups.

## Prerequisites

- Ubuntu 22.04 LTS or newer
- Root or sudo access
- Domain name (optional, for SSL)
- SMTP credentials for email sending

## 1. Server Setup

### Update System

```bash
sudo apt update && sudo apt upgrade -y
```

### Install Node.js 20.x LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version  # Should show v20.x.x
```

### Install Build Tools (for native modules)

```bash
sudo apt install -y build-essential python3
```

### Install Nginx

```bash
sudo apt install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

### Install PM2 (Process Manager)

```bash
sudo npm install -g pm2
```

## 2. Application Setup

### Create Application User

```bash
sudo useradd -m -s /bin/bash coffeel
sudo mkdir -p /opt/coffeel
sudo chown coffeel:coffeel /opt/coffeel
```

### Clone Repository

```bash
sudo -u coffeel git clone https://github.com/Soron2038/coffeel.git /opt/coffeel
cd /opt/coffeel
```

### Install Dependencies

```bash
sudo -u coffeel npm ci --production
```

### Configure Environment

```bash
sudo -u coffeel cp .env.example .env
sudo nano /opt/coffeel/.env
```

Edit `.env` with production values:

```env
NODE_ENV=production
PORT=3000
HOST=127.0.0.1

# Admin credentials (use strong password!)
ADMIN_USER=admin
ADMIN_PASS=your-secure-password-here

# Database
DATABASE_PATH=/opt/coffeel/data/coffee.db

# SMTP (use your actual mail server)
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

# Settings
COFFEE_PRICE=0.50
ADMIN_EMAIL=admin@cfel.de
```

### Initialize Database

```bash
sudo -u coffeel npm run db:init
```

### Set Permissions

```bash
sudo chown -R coffeel:coffeel /opt/coffeel
sudo chmod 600 /opt/coffeel/.env
```

## 3. PM2 Configuration

### Create Ecosystem File

```bash
sudo -u coffeel nano /opt/coffeel/ecosystem.config.js
```

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
    error_file: '/var/log/coffeel/error.log',
    out_file: '/var/log/coffeel/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  }],
};
```

### Create Log Directory

```bash
sudo mkdir -p /var/log/coffeel
sudo chown coffeel:coffeel /var/log/coffeel
```

### Start Application

```bash
sudo -u coffeel pm2 start /opt/coffeel/ecosystem.config.js
sudo -u coffeel pm2 save
```

### Setup PM2 Startup

```bash
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u coffeel --hp /home/coffeel
```

## 4. Nginx Configuration

### Create Site Config

```bash
sudo nano /etc/nginx/sites-available/coffeel
```

```nginx
server {
    listen 80;
    server_name coffeel.example.com;  # Replace with your domain

    # Redirect to HTTPS (uncomment after SSL setup)
    # return 301 https://$server_name$request_uri;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300;
        proxy_connect_timeout 300;
    }

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml;
}
```

### Enable Site

```bash
sudo ln -s /etc/nginx/sites-available/coffeel /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 5. SSL Certificate (Let's Encrypt)

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

## 9. Updating the Application

```bash
cd /opt/coffeel

# Stop application
sudo -u coffeel pm2 stop coffeel

# Create backup first!
sudo -u coffeel /opt/coffeel/scripts/daily-backup.sh

# Pull updates
sudo -u coffeel git pull

# Install dependencies
sudo -u coffeel npm ci --production

# Run migrations (if any)
# sudo -u coffeel npm run db:migrate

# Restart application
sudo -u coffeel pm2 restart coffeel
```

## 10. Useful Commands

```bash
# Application
sudo -u coffeel pm2 status           # Check status
sudo -u coffeel pm2 logs coffeel     # View logs
sudo -u coffeel pm2 restart coffeel  # Restart
sudo -u coffeel pm2 stop coffeel     # Stop

# Nginx
sudo systemctl status nginx          # Check Nginx
sudo nginx -t                        # Test config
sudo systemctl reload nginx          # Reload config

# Database
sqlite3 /opt/coffeel/data/coffee.db  # Open database
npm run db:backup                    # Manual backup

# Logs
tail -f /var/log/coffeel/out.log     # Application logs
tail -f /var/log/nginx/access.log    # Nginx access logs
```

## Troubleshooting

### Application won't start

```bash
# Check logs
sudo -u coffeel pm2 logs coffeel --lines 100

# Check if port is in use
sudo lsof -i:3000

# Verify environment
sudo -u coffeel cat /opt/coffeel/.env
```

### 502 Bad Gateway

1. Check if PM2 is running: `sudo -u coffeel pm2 status`
2. Check Nginx config: `sudo nginx -t`
3. Verify proxy_pass port matches application port

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

## Support

For issues, check:
1. PM2 logs: `pm2 logs coffeel`
2. Nginx error logs: `/var/log/nginx/error.log`
3. Application health: `curl localhost:3000/api/health`
