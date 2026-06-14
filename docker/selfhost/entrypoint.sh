#!/usr/bin/env sh
set -eu

# Ensure persistent bind mounts exist before sync or OAuth state touches them.
mkdir -p "${GARMIN_DATA_DIR:-/app/data}" /app/secrets

# Optional startup sync is best-effort so container restarts do not fail the server.
if [ "${RUN_INITIAL_SYNC:-false}" = "true" ]; then
  /app/docker/selfhost/run-sync.sh || true
fi

# supercronic owns the daily schedule while node serves MCP in the foreground.
supercronic /app/docker/selfhost/crontab &
exec node /app/server/dist/src/index.js
