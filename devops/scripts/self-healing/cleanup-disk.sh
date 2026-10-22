#!/usr/bin/env bash
#
# Disk cleanup remediation script (#1194)
#
# Registered in the database as the `cleanup-disk` script and executed by the
# self-healing engine when a filesystem runs low on space.
#
# The script only ever touches a small allow-list of well known paths and it
# never removes anything that was written in the last day. It is safe to run
# repeatedly (idempotent).
#
# Usage: cleanup-disk.sh [target]

set -euo pipefail

TARGET="${1:-unknown}"
RETENTION_DAYS="${SELF_HEALING_LOG_RETENTION_DAYS:-7}"
TMP_RETENTION_DAYS="${SELF_HEALING_TMP_RETENTION_DAYS:-1}"

log() {
  printf '[cleanup-disk] %s\n' "$*"
}

log "starting disk cleanup for target '${TARGET}'"

# ── Rotated log files older than the retention window ────────────────────────
if [ -d /var/log ]; then
  log "removing rotated logs older than ${RETENTION_DAYS} day(s) from /var/log"
  find /var/log -type f -name '*.gz' -mtime "+${RETENTION_DAYS}" -delete 2>/dev/null || true
fi

# ── Temporary files older than the retention window ──────────────────────────
if [ -d /tmp ]; then
  log "removing temporary files older than ${TMP_RETENTION_DAYS} day(s) from /tmp"
  find /tmp -type f -mtime "+${TMP_RETENTION_DAYS}" -delete 2>/dev/null || true
fi

# ── Report the resulting disk usage ──────────────────────────────────────────
log "disk usage after the cleanup:"
df -h / 2>/dev/null || true

log "disk cleanup finished"
