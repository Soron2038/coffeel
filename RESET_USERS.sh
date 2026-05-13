#!/bin/bash
#
# CofFeEL User Reset Script
# =========================
# Clears ONLY the coffee drinkers — keeps everything else intact.
#
# Usage: ./RESET_USERS.sh
#
# Use this when you want to start the user list from scratch without
# touching admin accounts, settings, broadcast history, or session state.
# For a more thorough wipe (incl. broadcasts, email logs, sessions) use
# RESET_DB.sh instead.
#
# PRESERVES:
#   ✓ Admin accounts (admin_users)
#   ✓ Admin sessions (you stay logged in)
#   ✓ All settings (SMTP, IMAP, Bank, Coffee Price)
#   ✓ Broadcast history (subjects, bodies, counts)
#   ✓ Email log + bounce records (user_id is nulled, recipient address kept)
#   ✓ Audit log entries unrelated to a specific user (e.g. broadcast sends)
#
# DELETES:
#   ✗ All coffee drinkers (users table)
#   ✗ All payment records
#   ✗ Audit log entries that reference a deleted user

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
    echo "║   ☕ CofFeEL - User Reset                         ║"
    echo "║      Clears coffee drinkers only                  ║"
    echo "║                                                   ║"
    echo "╚═══════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[✓]${NC} $1"; }
warn()    { echo -e "${YELLOW}[!]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Run a SQLite query, return 0 if the table doesn't exist yet (e.g. very old
# database, or schema migration not yet applied).
count_or_zero() {
    sqlite3 "$DB_PATH" "$1" 2>/dev/null || echo 0
}

# ============================================
# MAIN FUNCTIONS
# ============================================

check_prerequisites() {
    [ -d "$INSTALL_DIR" ] || error "CofFeEL is not installed at $INSTALL_DIR"
    [ -f "$DB_PATH" ]      || error "Database not found at $DB_PATH"
    command -v sqlite3 &>/dev/null || error "sqlite3 is not installed"
    success "Prerequisites check passed"
}

show_current_data() {
    echo ""
    info "Current data in database:"

    local user_count=$(count_or_zero "SELECT COUNT(*) FROM users WHERE deleted_by_user = 0;")
    local soft_deleted=$(count_or_zero "SELECT COUNT(*) FROM users WHERE deleted_by_user = 1;")
    local payment_count=$(count_or_zero "SELECT COUNT(*) FROM payments;")
    local audit_user_count=$(count_or_zero "SELECT COUNT(*) FROM audit_log WHERE user_id IS NOT NULL;")
    local audit_global_count=$(count_or_zero "SELECT COUNT(*) FROM audit_log WHERE user_id IS NULL;")
    local email_count=$(count_or_zero "SELECT COUNT(*) FROM emails;")
    local broadcast_count=$(count_or_zero "SELECT COUNT(*) FROM broadcasts;")

    echo -e "  ${RED}Will be deleted:${NC}"
    echo "    • Active users:      $user_count"
    echo "    • Soft-deleted users: $soft_deleted"
    echo "    • Payments:          $payment_count"
    echo "    • Audit log (user-specific): $audit_user_count"
    echo ""
    echo -e "  ${GREEN}Will be preserved:${NC}"
    echo "    • Admin accounts + active sessions"
    echo "    • All settings (SMTP, IMAP, Bank, Coffee Price)"
    echo "    • Audit log (broadcast events): $audit_global_count"
    echo "    • Broadcast history: $broadcast_count"
    echo "    • Email log + bounces: $email_count (user_id will be cleared, addresses kept)"
    echo ""
}

create_backup() {
    info "Creating backup of current database..."
    mkdir -p "$BACKUP_DIR"
    local date_stamp=$(date +%Y%m%d_%H%M%S)
    local backup_file="$BACKUP_DIR/coffeel_before_userreset_$date_stamp.db"
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

reset_users() {
    info "Clearing user data..."

    # Single transaction with FKs disabled — `payments` and `audit_log`
    # reference `users(id)` without ON DELETE, so a delete order with FKs
    # active would require a careful sequence. Disabling lets us do this
    # in any order safely.
    sqlite3 "$DB_PATH" <<EOF
PRAGMA foreign_keys = OFF;
BEGIN;

DELETE FROM payments;
DELETE FROM audit_log WHERE user_id IS NOT NULL;

-- Keep email log + bounce statistics intact (recipient_email is the source
-- of truth for bounce diagnostics), but null out the orphan user_id so the
-- column stays consistent with the FK's intended ON DELETE SET NULL.
UPDATE emails SET user_id = NULL WHERE user_id IS NOT NULL;

DELETE FROM users;

-- Reset AUTOINCREMENT so the next user starts at id 1
DELETE FROM sqlite_sequence WHERE name IN ('users', 'payments');

COMMIT;

-- VACUUM cannot run inside a transaction
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

    echo -e "${YELLOW}Are you sure you want to clear all coffee drinkers?${NC}"
    read -rp "Type 'RESET' to confirm: " confirmation

    if [ "$confirmation" != "RESET" ]; then
        echo ""
        info "Reset cancelled."
        exit 0
    fi

    echo ""
    create_backup
    stop_service
    reset_users
    start_service

    echo ""
    echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  User Reset Complete!${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "  ${GREEN}Preserved:${NC}"
    echo "    ✓ Admin accounts + sessions"
    echo "    ✓ Settings (SMTP, IMAP, Bank, Coffee Price)"
    echo "    ✓ Broadcast history"
    echo "    ✓ Email log + bounce records"
    echo "    ✓ Broadcast-related audit log entries"
    echo ""
    echo -e "  ${CYAN}Cleared:${NC}"
    echo "    ✗ All coffee drinkers"
    echo "    ✗ All payments"
    echo "    ✗ User-specific audit log entries"
    echo ""
    echo "  Ready for the next round of coffee! ☕"
    echo ""
}

main "$@"
