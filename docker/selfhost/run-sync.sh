#!/usr/bin/env sh
set -eu

# A simple mkdir lock prevents overlapping scheduled syncs in the same container.
LOCK_DIR=/tmp/garmin-sync.lock
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Garmin sync is already running; skipping."
  exit 0
fi
trap 'rmdir "$LOCK_DIR"' EXIT

# Self-hosted sync preserves raw payloads, details, and streams by default.
python -m sync.main \
  --days "${SYNC_DAYS:-30}" \
  --output "${GARMIN_DATA_DIR:-/app/data/latest}" \
  --session-file "${GARMIN_SESSION_FILE:-/app/secrets/.garmin-session.enc}" \
  --include-raw true \
  --activity-details true \
  --activity-streams true
