#!/usr/bin/env sh
set -eu

mkdir -p "${GARMIN_DATA_DIR:-/app/data}" /app/secrets

if [ "${RUN_INITIAL_SYNC:-false}" = "true" ]; then
  /app/docker/selfhost/run-sync.sh || true
fi

supercronic /app/docker/selfhost/crontab &
exec node /app/server/dist/src/index.js
