# TrueNAS Self-Hosted Deployment

This deployment runs the TypeScript MCP HTTP server and Python Garmin sync in one container. The container stores latest normalized Garmin JSON under `/app/data/latest`, historical archive data under `/app/data/archive`, and the encrypted Garmin session under `/app/secrets`.

Cloud Run and GCS support remain available; this is an additional self-hosted path for running behind your existing Cloudflare Tunnel.

## Layout

- MCP server: `http://garmin-mcp:3000`
- Data volume: `/app/data`
- Latest MCP JSON: `/app/data/latest`
- Historical archive: `/app/data/archive`
- Optional raw backfill data: `/app/data/raw`
- Optional exports: `/app/data/exports`
- Encrypted session volume: `/app/secrets`
- Encrypted session file: `/app/secrets/.garmin-session.enc`
- Default sync schedule: daily at `06:00` in `Asia/Kolkata`
- Health check: `GET /healthz`

Use this host directory structure on TrueNAS:

```text
/mnt/scg_pool_1/apps/garmin-mcp/
├── data
│   ├── latest
│   ├── archive
│   ├── raw
│   └── exports
├── secrets
└── repo
```

Create the host directories:

```bash
mkdir -p /mnt/scg_pool_1/apps/garmin-mcp/data/latest
mkdir -p /mnt/scg_pool_1/apps/garmin-mcp/data/archive
mkdir -p /mnt/scg_pool_1/apps/garmin-mcp/data/raw
mkdir -p /mnt/scg_pool_1/apps/garmin-mcp/data/exports
mkdir -p /mnt/scg_pool_1/apps/garmin-mcp/secrets
```

## Required Environment

Set these in your TrueNAS app environment or a local `.env.selfhost` for `docker compose`:

```text
HOST_DATA_DIR=/mnt/scg_pool_1/apps/garmin-mcp/data
HOST_SECRETS_DIR=/mnt/scg_pool_1/apps/garmin-mcp/secrets

GARMIN_EMAIL=...
GARMIN_PASSWORD=...
GARMIN_SESSION_KEY=...
MCP_BEARER_TOKEN=...

GARMIN_DATA_MODE=local
GARMIN_DATA_DIR=/app/data/latest
GARMIN_SESSION_FILE=/app/secrets/.garmin-session.enc
OAUTH_ISSUER=https://garmin.sharathgavini.com
OAUTH_ADMIN_PASSWORD=...
OAUTH_TOKEN_TTL_SECONDS=2592000
TZ=Asia/Kolkata
```

Generate `GARMIN_SESSION_KEY`:

```bash
python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(32))
PY
```

## Docker Compose

Build and start:

```bash
docker compose --env-file .env.selfhost up -d --build
```

For compose, keep host paths and secrets in `.env.selfhost`:

```text
HOST_DATA_DIR=/mnt/scg_pool_1/apps/garmin-mcp/data
HOST_SECRETS_DIR=/mnt/scg_pool_1/apps/garmin-mcp/secrets

GARMIN_EMAIL=...
GARMIN_PASSWORD=...
GARMIN_SESSION_KEY=...
MCP_BEARER_TOKEN=...

GARMIN_DATA_MODE=local
GARMIN_DATA_DIR=/app/data/latest
GARMIN_SESSION_FILE=/app/secrets/.garmin-session.enc
OAUTH_ISSUER=https://garmin.sharathgavini.com
OAUTH_ADMIN_PASSWORD=...
OAUTH_TOKEN_TTL_SECONDS=2592000
TZ=Asia/Kolkata
```

Validate compose before starting:

```bash
docker compose --env-file .env.selfhost config
```

Expected output should include bind mounts like:

```text
/mnt/scg_pool_1/apps/garmin-mcp/data:/app/data
/mnt/scg_pool_1/apps/garmin-mcp/secrets:/app/secrets
```

Check health:

```bash
curl http://localhost:3000/healthz
```

After sync/backfill, validate the MCP data surface from ChatGPT/Claude or MCP Inspector:

```text
Use Garmin MCP and get data capabilities.
Use Garmin MCP and audit data quality for the last 90 days.
Use Garmin MCP and show my recovery dashboard for last_14_days.
Use Garmin MCP and show my training load dashboard for last_30_days.
Use Garmin MCP and detect training anomalies for last_30_days.
```

The container uses `TZ=Asia/Kolkata` by default. Date presets such as `last_30_days`, `this_week`, and `year_to_date` resolve using the server timezone.

Check OAuth metadata:

```bash
curl https://garmin.sharathgavini.com/.well-known/oauth-authorization-server
```

Run a manual sync:

```bash
docker exec garmin-mcp python -m sync.main \
  --days 30 \
  --output /app/data/latest \
  --include-raw true \
  --activity-details true \
  --activity-streams true
```

The manual command works because the container sets `GARMIN_SESSION_FILE=/app/secrets/.garmin-session.enc`.

Repair missing archive activity details without rerunning full backfill:

```bash
docker exec garmin-mcp python -m sync.repair_activity_details \
  --start-date 2026-03-18 \
  --end-date 2026-06-14 \
  --output /app/data/archive \
  --sleep-seconds 1
```

Check repair status:

```text
Use Garmin MCP and call repair_activity_details_status.
```

View scheduled sync logs:

```bash
docker logs garmin-mcp
```

## Historical Backfill

Backfill writes a partitioned archive under `/app/data/archive` and does not change the MCP server's fast latest-data path.

Run a historical backfill:

```bash
docker exec garmin-mcp python -m sync.backfill \
  --start-date 2020-01-01 \
  --end-date 2026-06-14 \
  --output /app/data/archive \
  --chunk-days 7 \
  --sleep-seconds 2 \
  --include-raw true \
  --activity-details true \
  --activity-streams true
```

Resume an interrupted backfill:

```bash
docker exec garmin-mcp python -m sync.backfill \
  --start-date 2020-01-01 \
  --end-date 2026-06-14 \
  --output /app/data/archive \
  --include-raw true \
  --activity-details true \
  --activity-streams true
```

Use `--force` to ignore `backfill_checkpoint.json` and start from `--start-date` again. Activity details and streams are fetched only when the corresponding `/app/data/archive/activity_details/{activity_id}.json` or `/app/data/archive/activity_streams/{activity_id}.json` file does not already exist.

Detached full historical backfill:

```bash
nohup docker exec garmin-mcp python -m sync.backfill \
  --start-date 2025-10-01 \
  --end-date 2026-06-14 \
  --output /app/data/archive \
  --chunk-days 7 \
  --sleep-seconds 2 \
  --include-raw true \
  --activity-details true \
  --activity-streams true \
  > /mnt/scg_pool_1/apps/garmin-mcp/data/exports/backfill-full.log 2>&1 &
```

If a sync lock is stale after checking logs:

```bash
rm /mnt/scg_pool_1/apps/garmin-mcp/data/latest/sync.lock
```

Archive layout:

```text
/app/data/archive/
├── manifest.json
├── backfill_checkpoint.json
├── daily/year=2026/month=06/daily.json
├── sleep/year=2026/month=06/sleep.json
├── hrv/year=2026/month=06/hrv.json
├── stress/year=2026/month=06/stress.json
├── body_battery/year=2026/month=06/body_battery.json
├── activities/year=2026/month=06/activities.json
├── activity_details/{activity_id}.json
├── activity_streams/{activity_id}.json
└── raw/
```

## Activity Streams and Analysis

Daily sync and backfill store normalized activity details plus full Garmin stream files when Garmin provides samples:

- heart rate
- cadence
- speed
- power when available
- elevation
- distance progression
- GPS points when available
- laps and splits

Use the MCP tools:

- `get_latest_workout`
- `get_latest_workout_summary`
- `get_latest_workout_streams`
- `get_activity_streams`
- `analyze_activity`
- `analyze_latest_workout`
- `get_latest_ride`
- `get_latest_ride_summary`
- `get_latest_ride_streams`
- `sync_now`

Example prompts:

```text
Use Garmin MCP and get my latest workout summary.
Use Garmin MCP and get my latest ride streams.
Use Garmin MCP and analyze my latest ride using full Garmin HR, cadence, speed, power if available, elevation, and distance streams. Do not use Strava.
Use Garmin MCP and analyze my latest badminton session.
Use Garmin MCP and analyze my latest gym workout.
Use Garmin MCP, sync now with activity streams, then analyze my latest workout.
```

## TrueNAS Notes

If using the TrueNAS UI instead of `docker compose`, create two persistent host paths and bind mount them:

- `/mnt/scg_pool_1/apps/garmin-mcp/data` to `/app/data`
- `/mnt/scg_pool_1/apps/garmin-mcp/secrets` to `/app/secrets`

Expose container port `3000` only to the Docker network used by Cloudflare Tunnel if possible. The MCP endpoint still requires `Authorization: Bearer $MCP_BEARER_TOKEN`, but the tunnel should be the only public ingress.

## Cloudflare Tunnel

Add an ingress rule to your existing tunnel:

```yaml
ingress:
  - hostname: garmin.sharathgavini.com
    service: http://garmin-mcp:3000
  - service: http_status:404
```

Then configure ChatGPT MCP connector URL:

```text
https://garmin.sharathgavini.com/mcp
```

Use bearer authentication:

```text
Authorization: Bearer YOUR_MCP_BEARER_TOKEN
```

## Schedule

The image uses `supercronic` with:

```cron
0 6 * * * /app/docker/selfhost/run-sync.sh
```

The container sets `TZ=Asia/Kolkata` by default. Override `SYNC_DAYS` to change the scheduled sync window:

```text
SYNC_DAYS=30
```

Set `RUN_INITIAL_SYNC=true` if you want the container to attempt one sync on startup. By default this is off so a restart does not unexpectedly call Garmin.

## Security

The container should not upload or expose:

- `.env`
- `.garmin-session.enc`
- logs
- Garmin credentials

Raw Garmin payloads are stored locally under `/app/data/latest/raw` and `/app/data/archive/raw` for self-hosted retention, but they should not be exposed publicly or copied into logs. The encrypted session file stays under `/app/secrets`.

Do not expose a public unauthenticated sync endpoint.

## `sync_now`

Do not add unauthenticated sync.

The MCP server exposes `sync_now` only through the authenticated `/mcp` channel. It creates `/app/data/latest/sync.lock`, starts `python -m sync.sync_now` in the background, and writes running state to `/app/data/latest/latest_sync_status.json`. Poll `get_sync_status` after calling it.

Delta vs full sync:

```bash
docker exec garmin-mcp python -m sync.sync_now --output /app/data/latest
docker exec garmin-mcp python -m sync.sync_now --output /app/data/latest --full
```

Incremental state is stored at:

```text
/app/data/archive/sync_state.json
```

Status includes `run_type`, per-dataset watermarks, records fetched/upserted, lookback days, and cooldown settings.

## Archive Rollups and Manifest

Archive maintenance writes:

```text
/app/data/archive/partition_manifest.json
/app/data/archive/partition_manifest_verify.json
/app/data/archive/rollups/manifest.json
/app/data/archive/rollups/weekly/YYYY-Www.json
/app/data/archive/rollups/monthly/YYYY-MM.json
/app/data/archive/rollups/sleep_weekly/YYYY-Www.json
```

Rebuild on demand:

```bash
docker exec garmin-mcp python -m sync.archive_maintenance \
  --output /app/data/archive \
  --start-date 2026-03-18 \
  --end-date 2026-06-14 \
  --verify-manifest
```

The existing bearer/OAuth protections remain required.

## OAuth Remote MCP Auth

ChatGPT and Claude remote connectors may expect an OAuth sign-in flow instead of a manually configured bearer token. The server supports a minimal single-user OAuth flow for remote MCP client authentication while preserving `MCP_BEARER_TOKEN`.

OAuth state is stored under `/app/secrets`:

- `oauth-clients.json`
- `oauth-codes.json`
- `oauth-tokens.json`

See [OAUTH_SETUP.md](OAUTH_SETUP.md) for registration, metadata, and token rotation details.

## Troubleshooting

If `/healthz` returns an error before the first sync, run:

```bash
docker exec garmin-mcp python -m sync.main --days 7 --output /app/data/latest --force-login
```

If Garmin session reuse fails, keep the same `GARMIN_SESSION_KEY` and confirm `/app/secrets` is persistent.
