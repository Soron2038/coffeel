#!/bin/bash
#
# CofFeEL Update Script
# =====================
# Updates an existing CofFeEL installation on the server
#
# Usage: ./UPDATE.sh [options]
#
# Options:
#   --restart    Force restart of the PM2 service after update
#   --deps       Force reinstall of npm dependencies
#   --help       Show this help message
#
# Co-Authored-By: Antigravity

set -o pipefail

# ============================================
# CONFIGURATION
# ============================================

INSTALL_DIR="/opt/coffeel"
PM2_APP_NAME="coffeel"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Flags
FORCE_RESTART=false
FORCE_DEPS=false

# ============================================
# HELPER FUNCTIONS
# ============================================

print_banner() {
    echo -e "${CYAN}"
    echo "╔═══════════════════════════════════════════════════╗"
    echo "║                                                   ║"
    echo "║   ☕ CofFeEL - Coffee Tracking System             ║"
    echo "║      Update Script                                ║"
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

# Where prompts should read from. When the script is piped into bash
# (curl ... | bash), stdin carries the script itself — a plain `read` would
# swallow the next script lines instead of user input. Read from the
# controlling terminal in that case. Fails if no terminal exists at all.
prompt_input() {
    if [ -t 0 ]; then
        echo "/dev/stdin"
    elif (: < /dev/tty) 2>/dev/null; then
        echo "/dev/tty"
    else
        return 1
    fi
}

prompt_yes_no() {
    local message="$1"
    local default="${2:-n}"
    local result input

    if ! input=$(prompt_input); then
        # No terminal available (fully non-interactive): take the default
        [[ "$default" =~ ^[Yy]$ ]]
        return
    fi

    if [ "$default" = "y" ]; then
        read -rp "$(echo -e "${CYAN}$message${NC} [Y/n]: ")" result < "$input"
        result="${result:-y}"
    else
        read -rp "$(echo -e "${CYAN}$message${NC} [y/N]: ")" result < "$input"
        result="${result:-n}"
    fi

    [[ "$result" =~ ^[Yy]$ ]]
}

show_help() {
    echo "CofFeEL Update Script"
    echo ""
    echo "Usage: ./UPDATE.sh [options]"
    echo ""
    echo "Options:"
    echo "  --restart    Force restart of the PM2 service after update"
    echo "  --deps       Force reinstall of npm dependencies"
    echo "  --help       Show this help message"
    echo ""
    echo "Examples:"
    echo "  ./UPDATE.sh              # Standard update (restarts if needed)"
    echo "  ./UPDATE.sh --restart    # Update and always restart service"
    echo "  ./UPDATE.sh --deps       # Update and reinstall dependencies"
    echo ""
    exit 0
}

check_prerequisites() {
    # Check if installation directory exists
    if [ ! -d "$INSTALL_DIR" ]; then
        error "CofFeEL is not installed at $INSTALL_DIR. Please run DEPLOY.sh first."
    fi

    # Check if it's a git repository
    if [ ! -d "$INSTALL_DIR/.git" ]; then
        error "$INSTALL_DIR is not a git repository. Cannot update."
    fi

    # Check if PM2 is installed
    if ! command -v pm2 &>/dev/null; then
        error "PM2 is not installed. Please run DEPLOY.sh first."
    fi

    # Check if the app is running in PM2
    if ! pm2 describe "$PM2_APP_NAME" &>/dev/null; then
        warn "CofFeEL is not currently running in PM2."
    fi

    success "Prerequisites check passed"
}

# ============================================
# UPDATE STEPS
# ============================================

create_backup() {
    info "Creating database backup before update..."
    
    local backup_dir="$INSTALL_DIR/data/backups"
    local db_path="$INSTALL_DIR/data/coffee.db"
    local date_stamp=$(date +%Y%m%d_%H%M%S)
    
    if [ -f "$db_path" ]; then
        mkdir -p "$backup_dir"
        sqlite3 "$db_path" ".backup '$backup_dir/coffeel_preupdate_$date_stamp.db'"
        success "Backup created: coffeel_preupdate_$date_stamp.db"
    else
        warn "No database found, skipping backup"
    fi
}

fetch_updates() {
    info "Fetching updates from remote repository..."
    cd "$INSTALL_DIR"
    
    # Detect the default branch (main or master)
    local default_branch
    if git rev-parse --verify origin/main &>/dev/null; then
        default_branch="main"
    elif git rev-parse --verify origin/master &>/dev/null; then
        default_branch="master"
    else
        error "Could not detect default branch (main/master)"
    fi
    info "Using branch: $default_branch"

    # Pre-flight: refuse to proceed with leftover unmerged paths.
    # `git stash` silently fails on unmerged entries, so a stale conflict
    # from a previous aborted merge would slip past the stash and break
    # `git pull` later with a confusing message.
    if [ -n "$(git ls-files --unmerged 2>/dev/null)" ]; then
        echo ""
        warn "Repository has unresolved merge conflicts from a previous operation:"
        git ls-files --unmerged | awk '{print "  - " $4}' | sort -u
        echo ""
        error "Resolve them first: 'git checkout HEAD -- <file>' to discard local conflict, \
or 'git add <file>' after manual fix. Then re-run UPDATE.sh."
    fi

    # Stash any local changes (like .env modifications)
    local has_changes=false
    if ! git diff --quiet 2>/dev/null; then
        warn "Local changes detected, stashing..."
        git stash push -m "UPDATE.sh auto-stash $(date +%Y%m%d_%H%M%S)"
        has_changes=true
    fi
    
    # Fetch and check for updates
    git fetch origin
    
    local local_hash=$(git rev-parse HEAD)
    local remote_hash=$(git rev-parse "origin/$default_branch")
    
    if [ "$local_hash" = "$remote_hash" ]; then
        success "Already up to date!"
        
        # Restore stashed changes if any
        if [ "$has_changes" = true ]; then
            git stash pop 2>/dev/null || true
        fi
        
        # Exit unless force flags are set
        if [ "$FORCE_RESTART" = false ] && [ "$FORCE_DEPS" = false ]; then
            echo ""
            info "No updates available. Use --restart to force a service restart."
            exit 0
        fi
        
        return 0
    fi
    
    # Show what's being updated
    echo ""
    info "Updates available:"
    git log --oneline "HEAD..origin/$default_branch"
    echo ""
    
    # Pull changes
    info "Pulling updates..."
    if ! git pull origin "$default_branch"; then
        error "Git pull failed. Please resolve conflicts manually."
    fi
    
    # Restore stashed changes if any
    if [ "$has_changes" = true ]; then
        info "Restoring local changes..."
        git stash pop 2>/dev/null || warn "Could not restore stashed changes. Check 'git stash list'."
    fi
    
    success "Repository updated"

    # Export the pre-pull hash so dependency/restart checks can diff against
    # ALL pulled commits, not just the last one (`HEAD~1` would miss code
    # changes when several commits arrive in one pull).
    export PRE_PULL_HEAD="$local_hash"
    export UPDATES_PULLED=true
}

check_dependency_changes() {
    local needs_npm_install=false
    
    if [ "$FORCE_DEPS" = true ]; then
        needs_npm_install=true
        info "Force flag set, will reinstall dependencies"
    elif [ "${UPDATES_PULLED:-false}" = true ]; then
        # Diff across ALL pulled commits (PRE_PULL_HEAD..HEAD), not just the last one.
        cd "$INSTALL_DIR"
        if git diff --name-only "${PRE_PULL_HEAD:-HEAD~1}" HEAD 2>/dev/null | grep -qE "^package(-lock)?\.json$"; then
            needs_npm_install=true
            info "package.json or package-lock.json changed"
        fi
    fi
    
    if [ "$needs_npm_install" = true ]; then
        install_dependencies
    else
        success "Dependencies unchanged, skipping npm install"
    fi
}

install_dependencies() {
    info "Installing/updating dependencies..."
    cd "$INSTALL_DIR"
    npm install --production
    success "Dependencies installed"
}

check_restart_needed() {
    local needs_restart=false
    
    if [ "$FORCE_RESTART" = true ]; then
        needs_restart=true
    elif [ "${UPDATES_PULLED:-false}" = true ]; then
        # Diff across ALL pulled commits (PRE_PULL_HEAD..HEAD), not just the last one.
        cd "$INSTALL_DIR"
        if git diff --name-only "${PRE_PULL_HEAD:-HEAD~1}" HEAD 2>/dev/null | grep -qE "^src/"; then
            needs_restart=true
            info "Server files changed, restart needed"
        fi
    fi
    
    if [ "$needs_restart" = true ]; then
        restart_service
    else
        info "No server restart needed"
    fi
}

restart_service() {
    info "Restarting CofFeEL service..."
    
    if pm2 describe "$PM2_APP_NAME" &>/dev/null; then
        pm2 restart "$PM2_APP_NAME"
        success "Service restarted"
    else
        warn "Service not found in PM2, starting fresh..."
        cd "$INSTALL_DIR"
        pm2 start src/server.js --name "$PM2_APP_NAME"
        pm2 save
        success "Service started"
    fi
}

# ============================================
# CONFIGURATION DRIFT CHECKS
# ============================================
#
# DEPLOY.sh evolves over time, but UPDATE.sh only pulls code — it does not
# touch nginx config or cron entries by default. These checks detect when an
# existing host is running with outdated server config and offer to repair it.
# Each drift item is prompted separately (default: no) so the admin has to
# consciously approve every change instead of waving them through.

handle_nginx_drift() {
    local nginx_conf="/etc/nginx/sites-available/coffeel"

    echo ""
    warn "Nginx config drift:"
    warn "  $nginx_conf has no 'client_max_body_size' directive."
    warn "  The default 1 MB cap rejects DB backup uploads (Admin Panel → Restore)"
    warn "  with an HTML 413 page that the JSON-parsing frontend cannot read."
    echo ""

    if ! prompt_yes_no "Add 'client_max_body_size 50M;' and reload nginx?" "n"; then
        warn "Skipped — large DB backup uploads via Admin Panel will keep failing."
        warn "  Manual fix later: edit $nginx_conf, add 'client_max_body_size 50M;'"
        warn "  inside each server block, then run: sudo systemctl reload nginx"
        return 0
    fi

    info "Patching $nginx_conf..."
    # Insert directive after every 'server_name' line. If certbot has added a
    # 443 server block, both blocks get the limit (each server block needs it).
    sudo sed -i '/^\s*server_name/a\    client_max_body_size 50M;' "$nginx_conf"

    info "Testing nginx config..."
    if sudo nginx -t; then
        sudo systemctl reload nginx
        success "Nginx config updated and reloaded"
    else
        warn "Nginx config test failed. Please review $nginx_conf manually."
        warn "  The directive was inserted but nginx was NOT reloaded."
    fi
}

handle_pm2_startup_drift() {
    echo ""
    warn "PM2 autostart drift:"
    warn "  pm2-$USER.service is not enabled in systemd."
    warn "  Without it, PM2 does NOT come back after a server reboot — the next"
    warn "  unattended-upgrades reboot will leave nginx returning 502 until"
    warn "  someone SSHes in and runs 'pm2 start' manually."
    echo ""

    if ! prompt_yes_no "Enable PM2 autostart now (registers pm2-$USER.service via systemd)?" "n"; then
        warn "Skipped — CofFeEL will NOT auto-recover from a server reboot."
        warn "  Manual fix later:"
        warn "    sudo env PATH=\$PATH:/usr/bin pm2 startup systemd -u $USER --hp $HOME"
        warn "    pm2 save"
        return 0
    fi

    info "Registering pm2-$USER.service..."
    if ! sudo env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$USER" --hp "$HOME"; then
        warn "pm2 startup failed. Run it manually and re-run UPDATE.sh."
        return 1
    fi

    info "Saving current PM2 process list..."
    pm2 save

    if systemctl is-enabled "pm2-$USER" &>/dev/null; then
        success "PM2 autostart enabled (pm2-$USER.service)"
    else
        warn "pm2 startup ran but pm2-$USER.service is still not enabled."
        warn "  Verify manually: systemctl is-enabled pm2-$USER"
    fi
}

handle_cron_drift() {
    echo ""
    warn "Cron drift:"
    warn "  Daily backup cron still calls the legacy bash script (daily-backup.sh)."
    warn "  Current setup uses scripts/daily-db-backup.js — sends backup + stats"
    warn "  to admin via email."
    echo ""

    if ! prompt_yes_no "Replace the bash backup cron with the node-based one?" "n"; then
        warn "Skipped — daily backups continue with the old bash script (no email)."
        return 0
    fi

    local node_bin
    node_bin=$(command -v node)
    if [ -z "$node_bin" ]; then
        warn "node not found in PATH — skipping cron replacement"
        return 1
    fi

    # Save the current crontab before mutating, so the admin can roll back
    local cron_backup="/tmp/coffeel-crontab-pre-update-$(date +%s).bak"
    crontab -l 2>/dev/null > "$cron_backup"
    info "Old crontab saved to $cron_backup"

    # Strip any prior coffeel/daily-backup entries, append the new one
    (crontab -l 2>/dev/null | grep -v "coffeel\|daily-db-backup\|daily-backup"; \
     echo "0 3 * * * cd $INSTALL_DIR && $node_bin scripts/daily-db-backup.js >> /var/log/coffeel-backup.log 2>&1") | crontab -

    sudo touch /var/log/coffeel-backup.log
    sudo chown "$USER:$USER" /var/log/coffeel-backup.log

    success "Cron entry replaced"
    warn "SMTP host/user/pass and admin_email must be set in the Admin Panel"
    warn "before the next 3 AM run, otherwise the email step will fail."

    if [ -f "$INSTALL_DIR/scripts/daily-backup.sh" ]; then
        info "(Legacy $INSTALL_DIR/scripts/daily-backup.sh remains on disk; remove manually if desired.)"
    fi
}

check_config_drift() {
    info "Scanning server configuration for drift..."

    local nginx_drift=false
    local cron_drift=false
    local pm2_startup_drift=false

    if [ -f "/etc/nginx/sites-available/coffeel" ] && \
       ! sudo grep -q "client_max_body_size" "/etc/nginx/sites-available/coffeel"; then
        nginx_drift=true
    fi

    if crontab -l 2>/dev/null | grep -q "daily-backup.sh"; then
        cron_drift=true
    fi

    # PM2 autostart: required so CofFeEL survives a reboot. Detected by the
    # absence of an enabled systemd unit at pm2-<user>.service.
    if ! systemctl is-enabled "pm2-$USER" &>/dev/null; then
        pm2_startup_drift=true
    fi

    if [ "$nginx_drift" = false ] && [ "$cron_drift" = false ] && [ "$pm2_startup_drift" = false ]; then
        success "No configuration drift detected"
        return 0
    fi

    [ "$nginx_drift" = true ] && handle_nginx_drift
    [ "$cron_drift" = true ] && handle_cron_drift
    [ "$pm2_startup_drift" = true ] && handle_pm2_startup_drift
}

verify_update() {
    echo ""
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  Verifying Update${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    echo ""
    
    # Check PM2 status
    info "PM2 Status:"
    pm2 status "$PM2_APP_NAME"
    echo ""
    
    # Test API
    info "Testing API endpoint..."
    sleep 2
    
    if curl -sf http://localhost:3000/api/health > /dev/null; then
        success "API is responding"
    else
        warn "API health check failed. Check logs: pm2 logs $PM2_APP_NAME"
    fi
    
    # Show current version/commit
    echo ""
    cd "$INSTALL_DIR"
    local current_commit=$(git rev-parse --short HEAD)
    local current_branch=$(git branch --show-current)
    
    echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  Update Complete!${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "  ${CYAN}Branch:${NC}  $current_branch"
    echo -e "  ${CYAN}Commit:${NC}  $current_commit"
    echo -e "  ${CYAN}Date:${NC}    $(date)"
    echo ""
    echo -e "  ${CYAN}Useful Commands:${NC}"
    echo "    pm2 status          - Check application status"
    echo "    pm2 logs $PM2_APP_NAME    - View application logs"
    echo "    pm2 restart $PM2_APP_NAME - Restart application"
    echo ""
}

# ============================================
# MAIN
# ============================================

main() {
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --restart)
                FORCE_RESTART=true
                shift
                ;;
            --deps)
                FORCE_DEPS=true
                shift
                ;;
            --help|-h)
                show_help
                ;;
            *)
                warn "Unknown option: $1"
                show_help
                ;;
        esac
    done
    
    print_banner
    
    check_prerequisites
    
    echo ""
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  Step 1: Backup${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    create_backup
    
    echo ""
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  Step 2: Fetch Updates${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    fetch_updates
    
    echo ""
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  Step 3: Dependencies${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    check_dependency_changes
    
    echo ""
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  Step 4: Restart Service${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    check_restart_needed

    echo ""
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  Step 5: Configuration Drift${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    check_config_drift

    verify_update
}

# Run main function
main "$@"
