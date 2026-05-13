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
#   ✓ IMAP settings (bounce detection)
#   ✓ Bank details
#   ✓ Coffee price
#
# DELETES:
#   ✗ All coffee users
#   ✗ All payment records
#   ✗ All audit logs
#   ✗ All broadcast history (subjects, bodies, failed-recipient lists)
#   ✗ All email tracking + bounce records
#   ✗ All admin sessions (admins must log in again)

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

# Run a SQLite query, returning 0 even if the target table doesn't exist yet.
# Older databases may not have all the post-feature tables (broadcasts, emails,
# sessions). We don't want the entire script to die over a missing table.
count_or_zero() {
    local query="$1"
    sqlite3 "$DB_PATH" "$query" 2>/dev/null || echo 0
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

    local user_count=$(count_or_zero "SELECT COUNT(*) FROM users WHERE deleted_by_user = 0;")
    local payment_count=$(count_or_zero "SELECT COUNT(*) FROM payments;")
    local audit_count=$(count_or_zero "SELECT COUNT(*) FROM audit_log;")
    local broadcast_count=$(count_or_zero "SELECT COUNT(*) FROM broadcasts;")
    local email_count=$(count_or_zero "SELECT COUNT(*) FROM emails;")
    local bounce_count=$(count_or_zero "SELECT COUNT(*) FROM emails WHERE status IN ('bounced_hard','bounced_soft');")
    local session_count=$(count_or_zero "SELECT COUNT(*) FROM sessions;")
    local admin_count=$(count_or_zero "SELECT COUNT(*) FROM admin_users;")

    echo -e "  ${RED}Will be deleted:${NC}"
    echo "    • Users: $user_count"
    echo "    • Payments: $payment_count"
    echo "    • Audit log entries: $audit_count"
    echo "    • Broadcasts: $broadcast_count"
    echo "    • Email log entries: $email_count (of which $bounce_count bounces)"
    echo "    • Admin sessions: $session_count"
    echo ""
    echo -e "  ${GREEN}Will be preserved:${NC}"
    echo "    • Admin accounts: $admin_count"
    echo "    • All settings (SMTP, IMAP, Bank, Coffee Price)"
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

    # Wrap in a single transaction with FKs disabled.
    #
    # better-sqlite3 turns foreign_keys ON for the app, but the sqlite3 CLI
    # defaults to OFF — we set it explicitly anyway so the operation behaves
    # the same regardless of CLI defaults. Disabling lets us delete tables
    # whose rows reference each other (e.g. broadcasts.origin_broadcast_id
    # self-reference from a resend chain) without ordering acrobatics.
    sqlite3 "$DB_PATH" <<EOF
PRAGMA foreign_keys = OFF;
BEGIN;

-- User-related tables
DELETE FROM emails;
DELETE FROM audit_log;
DELETE FROM payments;
DELETE FROM broadcasts;
DELETE FROM users;

-- Admin sessions (admin_users itself is preserved; just the cookies expire)
DELETE FROM sessions;

-- Reset AUTOINCREMENT counters so the next inserts start at 1 again.
-- Tables without AUTOINCREMENT (settings, sessions) have no sqlite_sequence row.
DELETE FROM sqlite_sequence
 WHERE name IN ('users', 'payments', 'audit_log', 'broadcasts', 'emails');

COMMIT;

-- VACUUM cannot run inside a transaction. Reclaim freed pages here.
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
    echo "    ✓ IMAP settings (bounce detection)"
    echo "    ✓ Bank details"
    echo "    ✓ Coffee price"
    echo ""
    echo -e "  ${CYAN}Cleared:${NC}"
    echo "    ✗ All coffee users"
    echo "    ✗ All payments"
    echo "    ✗ All audit logs"
    echo "    ✗ All broadcasts"
    echo "    ✗ All email tracking + bounces"
    echo "    ✗ All admin sessions (log in again to access admin panel)"
    echo ""
    echo "  Ready for production! 🚀"
    echo ""
}

main "$@"
