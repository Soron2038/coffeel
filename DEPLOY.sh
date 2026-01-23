#!/bin/bash
#
# CofFeEL Deployment Script
# =========================
# Automated deployment for fresh Ubuntu servers (22.04+ / 24.04 LTS)
#
# Usage: curl -fsSL https://raw.githubusercontent.com/Soron2038/coffeel/main/DEPLOY.sh | bash
#    or: wget -qO- https://raw.githubusercontent.com/Soron2038/coffeel/main/DEPLOY.sh | bash
#    or: ./DEPLOY.sh (if already on server)
#
# Co-Authored-By: Warp <agent@warp.dev>

set -o pipefail

# ============================================
# CONFIGURATION
# ============================================

GITHUB_REPO="https://github.com/Soron2038/coffeel.git"
INSTALL_DIR="/opt/coffeel"
NODE_VERSION="20"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ============================================
# HELPER FUNCTIONS
# ============================================

print_banner() {
    echo -e "${CYAN}"
    echo "╔═══════════════════════════════════════════════════╗"
    echo "║                                                   ║"
    echo "║   ☕ CofFeEL - Coffee Tracking System             ║"
    echo "║      Automated Deployment Script                  ║"
    echo "║                                                   ║"
    echo "╚═══════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[!]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

prompt() {
    local message="$1"
    local default="$2"
    local result

    if [ -n "$default" ]; then
        read -rp "$(echo -e "${CYAN}$message${NC} [$default]: ")" result
        echo "${result:-$default}"
    else
        read -rp "$(echo -e "${CYAN}$message${NC}: ")" result
        echo "$result"
    fi
}

prompt_password() {
    local message="$1"
    local result

    read -srp "$(echo -e "${CYAN}$message${NC}: ")" result
    echo
    echo "$result"
}

prompt_yes_no() {
    local message="$1"
    local default="${2:-y}"
    local result

    if [ "$default" = "y" ]; then
        read -rp "$(echo -e "${CYAN}$message${NC} [Y/n]: ")" result
        result="${result:-y}"
    else
        read -rp "$(echo -e "${CYAN}$message${NC} [y/N]: ")" result
        result="${result:-n}"
    fi

    [[ "$result" =~ ^[Yy]$ ]]
}

check_root() {
    if [ "$EUID" -eq 0 ]; then
        error "Please do not run this script as root. Run as a user with sudo privileges."
    fi

    if ! sudo -v; then
        error "This script requires sudo privileges. Please run as a user with sudo access."
    fi
}

check_os() {
    if [ ! -f /etc/os-release ]; then
        error "Cannot detect operating system. This script requires Ubuntu 22.04+"
    fi

    . /etc/os-release

    if [ "$ID" != "ubuntu" ]; then
        error "This script is designed for Ubuntu. Detected: $ID"
    fi

    local version_major
    version_major=$(echo "$VERSION_ID" | cut -d. -f1)

    if [ "$version_major" -lt 22 ]; then
        error "Ubuntu 22.04 or newer is required. Detected: $VERSION_ID"
    fi

    success "Operating system: Ubuntu $VERSION_ID"
}

# ============================================
# INSTALLATION STEPS
# ============================================

install_system_packages() {
    info "Updating system packages..."
    sudo apt update && sudo apt upgrade -y

    info "Installing build tools..."
    sudo apt install -y build-essential python3 git curl sqlite3

    success "System packages installed"
}

install_nodejs() {
    info "Checking Node.js installation..."

    if command -v node &>/dev/null; then
        local current_version
        current_version=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$current_version" -ge "$NODE_VERSION" ]; then
            success "Node.js $(node --version) is already installed"
            return
        else
            warn "Node.js $current_version found, but version $NODE_VERSION+ is required"
        fi
    fi

    info "Installing Node.js ${NODE_VERSION}.x LTS..."
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | sudo -E bash -
    sudo apt install -y nodejs

    success "Node.js $(node --version) installed"
    info "npm version: $(npm --version)"
}

install_pm2() {
    info "Checking PM2 installation..."

    if command -v pm2 &>/dev/null; then
        success "PM2 $(pm2 --version) is already installed"
        return
    fi

    info "Installing PM2 globally..."
    sudo npm install -g pm2

    success "PM2 $(pm2 --version) installed"
}

install_nginx() {
    info "Checking Nginx installation..."

    if command -v nginx &>/dev/null; then
        success "Nginx is already installed"
    else
        info "Installing Nginx..."
        sudo apt install -y nginx
        success "Nginx installed"
    fi

    sudo systemctl enable nginx
    sudo systemctl start nginx
}

clone_repository() {
    info "Setting up application directory..."

    if [ -d "$INSTALL_DIR" ]; then
        if [ -d "$INSTALL_DIR/.git" ]; then
            warn "CofFeEL is already installed at $INSTALL_DIR"
            if prompt_yes_no "Do you want to update the existing installation?" "y"; then
                info "Pulling latest changes..."
                cd "$INSTALL_DIR"
                git pull
                success "Repository updated"
                return
            else
                error "Installation aborted. Remove $INSTALL_DIR first if you want a fresh install."
            fi
        else
            error "$INSTALL_DIR exists but is not a git repository. Please remove it first."
        fi
    fi

    sudo mkdir -p "$INSTALL_DIR"
    sudo chown "$USER:$USER" "$INSTALL_DIR"

    info "Cloning repository from GitHub..."
    git clone "$GITHUB_REPO" "$INSTALL_DIR"

    success "Repository cloned to $INSTALL_DIR"
}

install_dependencies() {
    info "Installing Node.js dependencies..."
    cd "$INSTALL_DIR"
    npm install --production

    success "Dependencies installed"
}

configure_environment() {
    echo
    local env_file="$INSTALL_DIR/.env"

    # Check if .env already exists
    if [ -f "$env_file" ]; then
        warn "Existing .env file found"
        if ! prompt_yes_no "Do you want to reconfigure?" "n"; then
            success "Keeping existing configuration"
            return
        fi
    fi

    # Ask if user wants to configure now or later via Admin Panel
    echo
    info "You can configure SMTP, bank details, and coffee price now,"
    info "or skip this and configure everything later in the Admin Panel."
    echo

    if ! prompt_yes_no "Configure SMTP and bank details now?" "n"; then
        # Create minimal .env with just server settings
        local session_secret
        session_secret=$(openssl rand -hex 32)

        cat > "$env_file" << EOF
# CofFeEL Production Configuration
# Generated by DEPLOY.sh on $(date)
# 
# NOTE: SMTP and bank details can be configured in the Admin Panel
# Go to: http://YOUR_SERVER/admin.html -> Settings

# Server Configuration
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# Session Secret (auto-generated)
SESSION_SECRET=${session_secret}

# Database
DB_PATH=./data/coffee.db

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=60

# Logging
LOG_LEVEL=info
EOF

        chmod 600 "$env_file"
        success "Minimal configuration created"
        warn "Remember to configure SMTP and bank details in Admin Panel!"
        return
    fi

    # Full configuration
    echo
    info "Please provide the following configuration values:"
    echo

    # SMTP Configuration
    echo -e "${YELLOW}--- SMTP Configuration (for payment emails) ---${NC}"
    local smtp_host smtp_port smtp_user smtp_pass smtp_from admin_email

    smtp_host=$(prompt "SMTP Host" "smtp.example.com")
    smtp_port=$(prompt "SMTP Port" "587")
    smtp_user=$(prompt "SMTP Username (email)")
    smtp_pass=$(prompt_password "SMTP Password")
    smtp_from=$(prompt "From Address" "\"CofFeEL\" <${smtp_user}>")
    admin_email=$(prompt "Admin Email (receives CC of payment requests)" "$smtp_user")

    echo
    echo -e "${YELLOW}--- Bank Details (shown in payment emails) ---${NC}"
    local bank_iban bank_bic bank_owner

    bank_iban=$(prompt "Bank IBAN")
    bank_bic=$(prompt "Bank BIC")
    bank_owner=$(prompt "Account Owner Name" "Coffee Fund")

    echo
    echo -e "${YELLOW}--- Coffee Settings ---${NC}"
    local coffee_price

    coffee_price=$(prompt "Price per coffee (EUR)" "0.50")

    # Generate session secret
    local session_secret
    session_secret=$(openssl rand -hex 32)

    # Write configuration
    cat > "$env_file" << EOF
# CofFeEL Production Configuration
# Generated by DEPLOY.sh on $(date)

# Server Configuration
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# Session Secret (auto-generated)
SESSION_SECRET=${session_secret}

# Database
DB_PATH=./data/coffee.db

# SMTP Configuration
SMTP_HOST=${smtp_host}
SMTP_PORT=${smtp_port}
SMTP_SECURE=false
SMTP_USER=${smtp_user}
SMTP_PASS=${smtp_pass}
SMTP_FROM=${smtp_from}

# Admin Email (CC for payment requests)
ADMIN_EMAIL=${admin_email}

# Bank Details
BANK_IBAN=${bank_iban}
BANK_BIC=${bank_bic}
BANK_OWNER="${bank_owner}"

# Coffee Settings
COFFEE_PRICE=${coffee_price}

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=60

# Logging
LOG_LEVEL=info
EOF

    # Secure the file
    chmod 600 "$env_file"

    success "Environment configured and secured"
}

initialize_database() {
    info "Initializing database..."
    cd "$INSTALL_DIR"

    # Create data directory
    mkdir -p "$INSTALL_DIR/data/backups"

    # Initialize database
    npm run db:init

    success "Database initialized"
    echo
    warn "Default admin credentials: admin / admin"
    warn "CHANGE THE PASSWORD IMMEDIATELY after first login!"
    echo
}

configure_nginx() {
    info "Configuring Nginx..."

    local nginx_conf="/etc/nginx/sites-available/coffeel"

    sudo tee "$nginx_conf" > /dev/null << 'EOF'
server {
    listen 80;
    server_name _;

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

        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
EOF

    # Enable site
    sudo ln -sf "$nginx_conf" /etc/nginx/sites-enabled/coffeel

    # Remove default site
    sudo rm -f /etc/nginx/sites-enabled/default

    # Test and reload
    if sudo nginx -t; then
        sudo systemctl reload nginx
        success "Nginx configured and reloaded"
    else
        error "Nginx configuration test failed"
    fi
}

start_application() {
    info "Starting CofFeEL with PM2..."
    cd "$INSTALL_DIR"

    # Stop existing instance if running
    pm2 delete coffeel 2>/dev/null || true

    # Start application
    pm2 start src/server.js --name coffeel

    # Save PM2 configuration
    pm2 save

    # Setup startup script
    info "Setting up PM2 startup script..."
    echo
    warn "PM2 will now generate a startup command. Please run the command it outputs:"
    echo
    pm2 startup

    echo
    info "After running the startup command above, run: pm2 save"
    echo

    success "Application started"
}

setup_firewall() {
    if prompt_yes_no "Do you want to configure UFW firewall?" "y"; then
        info "Configuring firewall..."

        sudo ufw allow 22/tcp comment 'SSH'
        sudo ufw allow 80/tcp comment 'HTTP'
        sudo ufw allow 443/tcp comment 'HTTPS'

        echo
        warn "Enabling UFW firewall. Make sure SSH (port 22) is allowed!"
        if prompt_yes_no "Enable UFW now?" "y"; then
            sudo ufw --force enable
            success "Firewall enabled"
        else
            info "Firewall not enabled. Run 'sudo ufw enable' manually when ready."
        fi
    fi
}

setup_ssl() {
    echo
    if prompt_yes_no "Do you want to set up SSL with Let's Encrypt?" "n"; then
        local domain
        domain=$(prompt "Enter your domain name (e.g., coffeel.example.com)")

        if [ -z "$domain" ]; then
            warn "No domain provided, skipping SSL setup"
            return
        fi

        info "Installing Certbot..."
        sudo apt install -y certbot python3-certbot-nginx

        info "Obtaining SSL certificate for $domain..."
        echo
        warn "Make sure your domain's DNS A record points to this server's IP!"
        echo

        if prompt_yes_no "Continue with SSL setup?" "y"; then
            sudo certbot --nginx -d "$domain"
            success "SSL certificate installed"

            # Test renewal
            info "Testing automatic renewal..."
            sudo certbot renew --dry-run
        fi
    fi
}

setup_backup_cron() {
    if prompt_yes_no "Do you want to set up automated daily backups?" "y"; then
        info "Setting up daily backup cron job..."

        # Create backup script
        sudo tee "$INSTALL_DIR/scripts/daily-backup.sh" > /dev/null << 'EOF'
#!/bin/bash
# CofFeEL Daily Backup Script

BACKUP_DIR="/opt/coffeel/data/backups"
DB_PATH="/opt/coffeel/data/coffee.db"
DATE=$(date +%Y%m%d_%H%M%S)
KEEP_DAYS=30

# Create backup directory
mkdir -p $BACKUP_DIR

# Create backup with SQLite online backup
sqlite3 $DB_PATH ".backup '$BACKUP_DIR/coffeel_auto_$DATE.db'"

# Remove old auto-backups (older than KEEP_DAYS)
find $BACKUP_DIR -name "coffeel_auto_*.db" -mtime +$KEEP_DAYS -delete

echo "$(date): Backup created - coffeel_auto_$DATE.db" >> /var/log/coffeel-backup.log
EOF

        sudo chmod +x "$INSTALL_DIR/scripts/daily-backup.sh"

        # Add cron job (daily at 3 AM)
        (crontab -l 2>/dev/null | grep -v "coffeel"; echo "0 3 * * * $INSTALL_DIR/scripts/daily-backup.sh") | crontab -

        success "Daily backup cron job configured (runs at 3 AM)"
    fi
}

verify_installation() {
    echo
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  Verifying Installation${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    echo

    # Check PM2 status
    info "PM2 Status:"
    pm2 status

    echo

    # Test API
    info "Testing API endpoint..."
    sleep 2

    if curl -sf http://localhost:3000/api/health > /dev/null; then
        success "API is responding"
    else
        warn "API health check failed. Check PM2 logs: pm2 logs coffeel"
    fi

    # Get server IP
    local server_ip
    server_ip=$(hostname -I | awk '{print $1}')

    echo
    echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  Installation Complete!${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
    echo
    echo -e "  ${CYAN}Kiosk UI:${NC}    http://${server_ip}/"
    echo -e "  ${CYAN}Admin Panel:${NC} http://${server_ip}/admin.html"
    echo
    echo -e "  ${YELLOW}Default Admin Login:${NC}"
    echo -e "    Username: admin"
    echo -e "    Password: admin"
    echo
    echo -e "  ${RED}⚠ IMPORTANT: Change the admin password immediately!${NC}"
    echo
    echo -e "  ${CYAN}Useful Commands:${NC}"
    echo "    pm2 status          - Check application status"
    echo "    pm2 logs coffeel    - View application logs"
    echo "    pm2 restart coffeel - Restart application"
    echo
}

# ============================================
# MAIN
# ============================================

main() {
    print_banner

    check_root
    check_os

    echo
    info "This script will install CofFeEL on this server."
    info "Installation directory: $INSTALL_DIR"
    echo

    if ! prompt_yes_no "Do you want to continue?" "y"; then
        echo "Installation aborted."
        exit 0
    fi

    echo
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  Step 1: System Packages${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    install_system_packages

    echo
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  Step 2: Node.js${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    install_nodejs

    echo
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  Step 3: PM2 Process Manager${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    install_pm2

    echo
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  Step 4: Nginx Web Server${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    install_nginx

    echo
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  Step 5: Clone Repository${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    clone_repository

    echo
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  Step 6: Install Dependencies${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    install_dependencies

    echo
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  Step 7: Environment Configuration (Optional)${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    configure_environment

    echo
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  Step 8: Initialize Database${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    initialize_database

    echo
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  Step 9: Configure Nginx${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    configure_nginx

    echo
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  Step 10: Start Application${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    start_application

    echo
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  Step 11: Firewall${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    setup_firewall

    echo
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  Step 12: SSL Certificate (Optional)${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    setup_ssl

    echo
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  Step 13: Automated Backups (Optional)${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    setup_backup_cron

    verify_installation
}

# Run main function
main "$@"
