#!/bin/bash
#
# CofFeEL Database Reset Script
# =============================
# Clears user data while preserving system settings
#
# Usage: ./RESET_DB.sh
#
# PRESERVES:
#   ✓ Admin accounts (admin_users table)
#   ✓ SMTP settings
#   ✓ Bank details
#   ✓ Coffee price
#
# DELETES:
#   ✗ All coffee users
#   ✗ All payment records
#   ✗ All audit logs

set -o pipefail

# ============================================
# CONFIGURATION
# ============================================

INSTALL_DIR="/opt/coffeel"
DB_PATH="$INSTALL_DIR/data/coffee.db"
BACKUP_DIR="$INSTALL_DIR/data/backups"
PM2_APP_NAME="coffeel"

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
    echo -e "${YELLOW}"
    echo "╔═══════════════════════════════════════════════════╗"
    echo "║                                                   ║"
    echo "║   ☕ CofFeEL - Database Reset                     ║"
    echo "║      Clears user data, keeps settings             ║"
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

# ============================================
# MAIN FUNCTIONS
# ============================================

check_prerequisites() {
    if [ ! -d "$INSTALL_DIR" ]; then
        error "CofFeEL is not installed at $INSTALL_DIR"
    fi

    if [ ! -f "$DB_PATH" ]; then
        error "Database not found at $DB_PATH"
    fi

    if ! command -v sqlite3 &>/dev/null; then
        error "sqlite3 is not installed"
    fi

    success "Prerequisites check passed"
}

show_current_data() {
    echo ""
    info "Current data in database:"
    
    local user_count=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM users WHERE deleted_by_user = 0;")
    local payment_count=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM payments;")
    local audit_count=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM audit_log;")
    local admin_count=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM admin_users;")
    
    echo -e "  ${RED}Will be deleted:${NC}"
    echo "    • Users: $user_count"
    echo "    • Payments: $payment_count"
    echo "    • Audit log entries: $audit_count"
    echo ""
    echo -e "  ${GREEN}Will be preserved:${NC}"
    echo "    • Admin accounts: $admin_count"
    echo "    • All settings (SMTP, Bank, Coffee Price)"
    echo ""
}

create_backup() {
    info "Creating backup of current database..."
    
    mkdir -p "$BACKUP_DIR"
    local date_stamp=$(date +%Y%m%d_%H%M%S)
    local backup_file="$BACKUP_DIR/coffeel_before_reset_$date_stamp.db"
    
    sqlite3 "$DB_PATH" ".backup '$backup_file'"
    success "Backup created: $backup_file"
}

stop_service() {
    info "Stopping CofFeEL service..."
    
    if pm2 describe "$PM2_APP_NAME" &>/dev/null; then
        pm2 stop "$PM2_APP_NAME"
        success "Service stopped"
    else
        warn "Service was not running"
    fi
}

reset_user_data() {
    info "Clearing user data..."
    
    # Delete all data from users, payments, and audit_log
    # But preserve settings and admin_users!
    sqlite3 "$DB_PATH" <<EOF
-- Clear user-related tables
DELETE FROM audit_log;
DELETE FROM payments;
DELETE FROM users;

-- Reset autoincrement counters
DELETE FROM sqlite_sequence WHERE name IN ('users', 'payments', 'audit_log');

-- Vacuum to reclaim space
VACUUM;
EOF
    
    success "User data cleared"
}

start_service() {
    info "Starting CofFeEL service..."
    
    if pm2 describe "$PM2_APP_NAME" &>/dev/null; then
        pm2 start "$PM2_APP_NAME"
    else
        cd "$INSTALL_DIR"
        pm2 start src/server.js --name "$PM2_APP_NAME"
        pm2 save
    fi
    
    success "Service started"
}

# ============================================
# MAIN
# ============================================

main() {
    print_banner
    
    check_prerequisites
    show_current_data
    
    echo -e "${YELLOW}Are you sure you want to clear all user data?${NC}"
    read -rp "Type 'RESET' to confirm: " confirmation
    
    if [ "$confirmation" != "RESET" ]; then
        echo ""
        info "Reset cancelled."
        exit 0
    fi
    
    echo ""
    create_backup
    stop_service
    reset_user_data
    start_service
    
    echo ""
    echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  Database Reset Complete!${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "  ${GREEN}Preserved:${NC}"
    echo "    ✓ Admin accounts"
    echo "    ✓ SMTP settings"
    echo "    ✓ Bank details"
    echo "    ✓ Coffee price"
    echo ""
    echo -e "  ${CYAN}Cleared:${NC}"
    echo "    ✗ All coffee users"
    echo "    ✗ All payments"
    echo "    ✗ All audit logs"
    echo ""
    echo "  Ready for production! 🚀"
    echo ""
}

main "$@"
