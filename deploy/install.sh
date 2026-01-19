#!/bin/bash
# CofFeEL Automated Deployment Script
# Run this on Ubuntu server: bash install.sh

set -e

echo "╔═══════════════════════════════════════════════════╗"
echo "║   CofFeEL - Automated Deployment                  ║"
echo "╚═══════════════════════════════════════════════════╝"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
APP_DIR="/opt/coffeel"
APP_USER="coffeel"
LOG_DIR="/var/log/coffeel"
REPO_URL="https://github.com/Soron2038/coffeel.git"

log() {
    echo -e "${GREEN}[✓]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[!]${NC} $1"
}

error() {
    echo -e "${RED}[✗]${NC} $1"
    exit 1
}

# Check if running as root or with sudo
if [ "$EUID" -ne 0 ]; then
    error "Please run with sudo: sudo bash install.sh"
fi

echo "Step 1/8: Updating system packages..."
apt update -qq
apt upgrade -y -qq
log "System updated"

echo ""
echo "Step 2/8: Installing Node.js 20.x LTS..."
# Remove Ubuntu's default nodejs if present (no npm)
apt remove -y nodejs npm 2>/dev/null || true
# Install Node.js 20.x from NodeSource (includes npm)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
log "Node.js $(node --version) with npm $(npm --version) installed"

echo ""
echo "Step 3/8: Installing dependencies..."
apt install -y build-essential nginx sqlite3 git
log "Dependencies installed"

echo ""
echo "Step 4/8: Installing PM2..."
if ! command -v pm2 &> /dev/null; then
    npm install -g pm2
    log "PM2 installed"
else
    log "PM2 already installed"
fi

echo ""
echo "Step 5/8: Creating application user and cloning repository..."
if ! id "$APP_USER" &>/dev/null; then
    useradd -m -s /bin/bash $APP_USER
    log "User '$APP_USER' created"
else
    log "User '$APP_USER' already exists"
fi

# Create log directory
mkdir -p $LOG_DIR
chown $APP_USER:$APP_USER $LOG_DIR

echo ""
echo "Step 6/8: Cloning repository..."
if [ -d "$APP_DIR/.git" ]; then
    warn "Repository exists, pulling latest..."
    chown -R $APP_USER:$APP_USER $APP_DIR
    sudo -u $APP_USER git -C $APP_DIR pull
else
    # Create directory as root, then clone as user
    mkdir -p $APP_DIR
    chown $APP_USER:$APP_USER $APP_DIR
    sudo -u $APP_USER git clone $REPO_URL $APP_DIR
fi

# Create backups directory inside app dir
mkdir -p $APP_DIR/backups
chown -R $APP_USER:$APP_USER $APP_DIR
log "Repository ready"

echo ""
echo "Step 7/8: Installing npm packages..."
cd $APP_DIR
sudo -u $APP_USER npm ci --production
log "NPM packages installed"

echo ""
echo "Step 8/8: Setting up configuration..."

# Create .env if not exists
if [ ! -f "$APP_DIR/.env" ]; then
    sudo -u $APP_USER cp $APP_DIR/.env.example $APP_DIR/.env
    warn ".env created from template - YOU MUST EDIT IT!"
fi

# Set permissions
chmod 600 $APP_DIR/.env
chown $APP_USER:$APP_USER $APP_DIR/.env

# Initialize database
sudo -u $APP_USER npm run db:init --prefix $APP_DIR
log "Database initialized"

# Create PM2 ecosystem file
cat > $APP_DIR/ecosystem.config.js << 'EOF'
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
EOF
chown $APP_USER:$APP_USER $APP_DIR/ecosystem.config.js
log "PM2 config created"

# Setup Nginx
cat > /etc/nginx/sites-available/coffeel << 'EOF'
server {
    listen 80;
    server_name _;

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

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml;
}
EOF

# Enable site
ln -sf /etc/nginx/sites-available/coffeel /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
log "Nginx configured"

# Setup backup cron
chmod +x $APP_DIR/deploy/daily-backup.sh
CRON_LINE="0 3 * * * $APP_DIR/deploy/daily-backup.sh"
(crontab -u $APP_USER -l 2>/dev/null | grep -v "daily-backup.sh"; echo "$CRON_LINE") | crontab -u $APP_USER -
log "Daily backup cron job added (3 AM)"

# Start application
sudo -u $APP_USER pm2 start $APP_DIR/ecosystem.config.js
sudo -u $APP_USER pm2 save
env PATH=$PATH:/usr/bin pm2 startup systemd -u $APP_USER --hp /home/$APP_USER
log "Application started with PM2"

echo ""
echo "╔═══════════════════════════════════════════════════╗"
echo "║   ✅ CofFeEL Deployment Complete!                 ║"
echo "╚═══════════════════════════════════════════════════╝"
echo ""
echo "IMPORTANT: Edit the configuration file:"
echo "  sudo nano $APP_DIR/.env"
echo ""
echo "Then restart the application:"
echo "  sudo -u coffeel pm2 restart coffeel"
echo ""
echo "Access the application:"
echo "  Kiosk: http://$(hostname -I | awk '{print $1}')"
echo "  Admin: http://$(hostname -I | awk '{print $1}')/admin.html"
echo ""
echo "Check status:"
echo "  sudo -u coffeel pm2 status"
echo "  sudo -u coffeel pm2 logs coffeel"
echo ""
