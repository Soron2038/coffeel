# CofFeEL Deployment Guide

This guide covers deploying CofFeEL to an Ubuntu server with Nginx, PM2, SSL, and automated backups.

**Current Production Server:** `cfelm-pcx65344.desy.de` (131.169.224.146)

## Automated Deployment (Recommended)

For a fresh Ubuntu 22.04+ server, the bundled `DEPLOY.sh` runs every step in this guide automatically:

```bash
curl -fsSL https://raw.githubusercontent.com/Soron2038/coffeel/main/DEPLOY.sh | bash
```

It walks through 13 steps interactively: install build tools, Node 20, PM2, Nginx (with `client_max_body_size 50M` for backup uploads + standard security headers), clone the repo to `/opt/coffeel`, install npm dependencies, generate `.env` (optional interactive SMTP / bank wizard, otherwise minimal config), initialize the database, configure Nginx as reverse proxy, start under PM2 and register `pm2-<user>.service` via systemd so the app survives reboots, optional UFW firewall, optional Let's Encrypt SSL, optional daily backup cron.

After it finishes, the kiosk is at `http://<server-ip>/` and the admin panel at `http://<server-ip>/admin.html` (default login `admin` / `admin` — change immediately).

For updates, use [`UPDATE.sh`](#updates) (see below).

The rest of this document covers the **manual** steps that `DEPLOY.sh` automates — useful when the script can't run (e.g. behind a strict proxy), when you need to debug, or when you want to understand each piece.

## Prerequisites

- Ubuntu 22.04 LTS or newer (tested on Ubuntu 24.04.3 LTS)
- SSH access with sudo privileges
- Node.js 20.x LTS, PM2, Nginx
- SMTP credentials for email sending
- Domain name (optional, for SSL)

> **Already deployed?** For updating an existing installation, jump to [Updates](#updates) — `UPDATE.sh` handles backup, pull, dependency check, restart, and config-drift detection in one go.

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
  /localpath/to/coffeel/ user@server:/opt/coffeel/
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

Edit `.env` with production values. This is the same schema `DEPLOY.sh` generates:

```env
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# Session secret for the admin login cookie
SESSION_SECRET=<openssl rand -hex 32>

# Database (created automatically by db:init)
DB_PATH=./data/coffee.db

# SMTP (also configurable in Admin Panel → Settings)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=coffee@example.com
SMTP_PASS=your-smtp-password
SMTP_FROM="CofFeEL <coffee@example.com>"

# Admin email — receives CC of payment requests, daily backup reports
ADMIN_EMAIL=admin@example.com

# Bank details
BANK_IBAN=DE89370400440532013000
BANK_BIC=COBADEFFXXX
BANK_OWNER="CFEL Coffee Fund"

# Coffee price in EUR (also editable in Admin Panel)
COFFEE_PRICE=0.50

# Rate limiting (per IP)
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=60

# Logging
LOG_LEVEL=info
```

> **Admin credentials** are not stored in `.env`. They live in the `admin_users` table — `npm run db:init` seeds a default `admin` / `admin` user; change the password from Admin Panel → Admin Users on first login.

### Initialize Database

```bash
npm run db:init
```

This creates the SQLite database with schema and a default admin user: `admin` / `admin`

**Important:** Change the admin password immediately after first login!

### Restore from Backup (if migrating from another server)

If you have a backup from a previous installation:

1. Copy the backup file to the server
2. Place it in `/opt/coffeel/data/backups/`
3. Start the application: `pm2 start src/server.js --name coffeel`
4. Go to Admin Panel → Backups tab
5. Click "Restore" on your backup file

Alternatively, use the Upload feature in Admin Panel → Backups to upload a `.db` file directly from your computer.

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

> `DEPLOY.sh` already handles this automatically (registers `pm2-<user>.service`).
> The steps below are only needed for manual installs or if the systemd unit
> later goes missing — `UPDATE.sh` will also detect that drift and offer to
> re-register it on the next run.

```bash
pm2 startup
# Follow the instructions printed by this command (copy & run the sudo line)
pm2 save
```

Verify with:

```bash
systemctl is-enabled pm2-$USER   # expected: enabled
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

    # Allow DB backup uploads (Admin Panel → Backups → Upload). The default
    # 1 MB cap rejects with HTML 413, which the JSON-parsing frontend can't read.
    client_max_body_size 50M;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
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

Default admin credentials: `admin` / `admin` — **change immediately** in Admin Panel → Admin Users.

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

## 6. Backups

### Admin Panel Backup (Recommended)

The easiest way to manage backups is through the Admin Panel:

1. Go to Admin Panel → **Backups** tab
2. Click **"Create Backup"** to create a new backup
3. Use **"Download"** to save backups to your local machine
4. Use **"Upload Backup File..."** to upload a backup from another server
5. Use **"Restore"** to restore from any backup (a safety backup is created automatically)

Backups are stored in `/opt/coffeel/data/backups/`.

### Automated Daily Backups (Optional)

`DEPLOY.sh` step 13 sets this up automatically. To do it manually, install a cron job that runs `scripts/daily-db-backup.js`:

```bash
# Resolve the absolute path to node — cron has no reliable PATH
NODE_BIN=$(command -v node)

# Add to crontab (daily at 3 AM)
(crontab -l 2>/dev/null | grep -v "coffeel\|daily-db-backup\|daily-backup"; \
 echo "0 3 * * * cd /opt/coffeel && $NODE_BIN scripts/daily-db-backup.js >> /var/log/coffeel-backup.log 2>&1") | crontab -

sudo touch /var/log/coffeel-backup.log
sudo chown $USER:$USER /var/log/coffeel-backup.log
```

What the script does:

- Creates a fresh SQLite online backup in `/opt/coffeel/data/backups/`
- Sends a stats report (user count, balance totals, etc.) with the `.db` file attached as e-mail to `admin_email` from the `settings` table
- Prunes auto-backups older than 30 days

> SMTP host/user/password and `admin_email` must be configured in Admin Panel → Settings before the first 3 AM run, otherwise the e-mail step fails (the backup itself still happens).

> If you previously installed the legacy `daily-backup.sh` (bash) cron, `UPDATE.sh` detects this on the next run and offers to replace it.

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
pm2 status
pm2 logs coffeel
```

### Monitor Resources

```bash
pm2 monit
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

## Updates

### On the server (recommended): `UPDATE.sh`

```bash
cd /opt/coffeel
./UPDATE.sh
```

This is the primary update path. It does the following automatically:

1. **Pre-update DB backup** to `data/backups/coffeel_preupdate_<timestamp>.db`
2. **Auto-stash** any uncommitted local changes, `git pull origin main` (auto-detects `main` / `master`), then `git stash pop`
3. **`npm install --production`** — only if `package.json` or `package-lock.json` changed
4. **`pm2 restart coffeel`** — only if any file under `src/` changed
5. **Configuration drift check** — compares the live server config against what `DEPLOY.sh` would produce now and offers to repair drift item by item (each prompt defaults to **no**, so nothing changes without explicit confirmation):
   - missing `client_max_body_size 50M;` in the Nginx site config
   - legacy bash backup cron → replaced with the `daily-db-backup.js`-based one
   - missing PM2 systemd autostart (`pm2-<user>.service` not enabled) → registered so CofFeEL auto-starts after reboots

If there are no remote commits and no force flags, the script exits early without restarting the service.

#### Flags

| Flag | Effect |
|------|--------|
| _(none)_ | Standard update — restarts / installs only when needed |
| `--restart` | Force a PM2 restart even if no code changed |
| `--deps` | Force `npm install` even if `package.json` didn't change |
| `--help` | Show usage |

### Manual fallback: `git pull` on the server

If `UPDATE.sh` is not available (e.g. for very old checkouts) or you need fine-grained control:

```bash
cd /opt/coffeel

# Always back up first
sqlite3 data/coffee.db ".backup 'data/backups/coffee_preupdate_$(date +%Y%m%d_%H%M%S).db'"

git pull
npm install --production   # only needed if package*.json changed
pm2 restart coffeel
```

### From a development machine (special case)

For pushing un-committed local changes during development without going through GitHub:

```bash
rsync -avz --exclude 'node_modules' --exclude '.git' --exclude 'data' --exclude '.env' --exclude 'coverage' \
  /path/to/coffeel/ user@server:/opt/coffeel/ && \
  ssh user@server "pm2 restart coffeel"
```

This bypasses `UPDATE.sh` (no backup, no drift check, always restarts). Prefer `git push` + `./UPDATE.sh` for normal deploys.

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

# Restore from backup (easiest via Admin Panel → Backups → Restore)
# Or manually:
pm2 stop coffeel
cp /opt/coffeel/data/backups/coffeel_YOURBACKUP.db /opt/coffeel/data/coffee.db
pm2 start coffeel
```

## Security Checklist

- [ ] Default `admin` / `admin` password changed in Admin Panel → Admin Users
- [ ] HTTPS enabled and forced
- [ ] Firewall configured (UFW)
- [ ] `.env` file has restricted permissions (600)
- [ ] `SESSION_SECRET` in `.env` is a strong random value (auto-generated by `DEPLOY.sh`)
- [ ] Regular backups running (cron via `daily-db-backup.js`)
- [ ] PM2 configured for auto-restart on reboot (`pm2 startup` + `pm2 save`)
- [ ] Nginx security headers enabled (`X-Frame-Options`, `X-Content-Type-Options`, `X-XSS-Protection`)
- [ ] Nginx `client_max_body_size 50M` set (so backup uploads work)
- [ ] Server OS updates automated (e.g. `unattended-upgrades`)

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

## Disaster Recovery

If the server is completely lost:

1. **Set up a new server** following "Fresh Server Setup" above
2. **Upload your backup** via Admin Panel → Backups → "Upload Backup File..."
3. **Restore** by clicking "Restore" on the uploaded backup
4. **Verify** all users and payments are present
5. **Update DNS** if the IP address changed

**Tip:** Regularly download backups to your local machine for off-site storage.

## Support

For issues, check:
1. PM2 logs: `pm2 logs coffeel`
2. Nginx error logs: `sudo tail /var/log/nginx/error.log`
3. Application health: `curl localhost:3000/api/health`
4. Database integrity: `sqlite3 /opt/coffeel/data/coffee.db "PRAGMA integrity_check;"`
