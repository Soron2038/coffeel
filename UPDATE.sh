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
    
    # Stash any local changes (like .env modifications)
    local has_changes=false
    if ! git diff --quiet; then
        warn "Local changes detected, stashing..."
        git stash
        has_changes=true
    fi
    
    # Fetch and check for updates
    git fetch origin
    
    local local_hash=$(git rev-parse HEAD)
    local remote_hash=$(git rev-parse origin/main 2>/dev/null || git rev-parse origin/master)
    
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
    git log --oneline HEAD..origin/main 2>/dev/null || git log --oneline HEAD..origin/master
    echo ""
    
    # Pull changes
    info "Pulling updates..."
    git pull --rebase origin main 2>/dev/null || git pull --rebase origin master
    
    # Restore stashed changes if any
    if [ "$has_changes" = true ]; then
        info "Restoring local changes..."
        git stash pop 2>/dev/null || warn "Could not restore stashed changes. Check 'git stash list'."
    fi
    
    success "Repository updated"
    
    # Export flag for dependency check
    export UPDATES_PULLED=true
}

check_dependency_changes() {
    local needs_npm_install=false
    
    if [ "$FORCE_DEPS" = true ]; then
        needs_npm_install=true
        info "Force flag set, will reinstall dependencies"
    elif [ "${UPDATES_PULLED:-false}" = true ]; then
        # Check if package.json or package-lock.json changed in the last commit
        cd "$INSTALL_DIR"
        if git diff --name-only HEAD~1 HEAD 2>/dev/null | grep -qE "^package(-lock)?\.json$"; then
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
        # Check if server files changed
        cd "$INSTALL_DIR"
        if git diff --name-only HEAD~1 HEAD 2>/dev/null | grep -qE "^src/"; then
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
    
    verify_update
}

# Run main function
main "$@"
