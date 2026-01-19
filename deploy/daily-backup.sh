#!/bin/bash
# CofFeEL Daily Backup Script
# Add to crontab: 0 3 * * * /opt/coffeel/deploy/daily-backup.sh

set -e

# Configuration
BACKUP_DIR="${BACKUP_DIR:-/opt/coffeel/backups}"
DB_PATH="${DB_PATH:-/opt/coffeel/data/coffee.db}"
KEEP_DAYS="${KEEP_DAYS:-30}"
LOG_FILE="${LOG_FILE:-/var/log/coffeel/backup.log}"

# Generate timestamp
DATE=$(date +%Y%m%d_%H%M%S)

# Create backup directory if needed
mkdir -p "$BACKUP_DIR"

# Log function
log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" >> "$LOG_FILE"
    echo "$1"
}

log "Starting backup..."

# Check if database exists
if [ ! -f "$DB_PATH" ]; then
    log "ERROR: Database not found at $DB_PATH"
    exit 1
fi

# Create backup using SQLite online backup
BACKUP_FILE="$BACKUP_DIR/coffee_$DATE.db"
sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'"

if [ $? -eq 0 ]; then
    log "Database backed up to $BACKUP_FILE"
else
    log "ERROR: Backup failed"
    exit 1
fi

# Compress backup
gzip "$BACKUP_FILE"
log "Compressed to ${BACKUP_FILE}.gz"

# Calculate backup size
BACKUP_SIZE=$(du -h "${BACKUP_FILE}.gz" | cut -f1)
log "Backup size: $BACKUP_SIZE"

# Remove old backups
DELETED=$(find "$BACKUP_DIR" -name "coffee_*.db.gz" -mtime +$KEEP_DAYS -delete -print | wc -l)
if [ "$DELETED" -gt 0 ]; then
    log "Removed $DELETED old backup(s)"
fi

# Count remaining backups
BACKUP_COUNT=$(find "$BACKUP_DIR" -name "coffee_*.db.gz" | wc -l)
log "Backup complete. Total backups: $BACKUP_COUNT"

exit 0
