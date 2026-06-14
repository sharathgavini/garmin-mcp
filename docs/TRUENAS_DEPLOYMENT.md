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

Check OAuth metadata:

```bash
curl https://garmin.sharathgavini.com/.well-known/oauth-authorization-server
```

Run a manual sync:

```bash
docker exec garmin-mcp python -m sync.main --days 7 --output /app/data/latest
```

The manual command works because the container sets `GARMIN_SESSION_FILE=/app/secrets/.garmin-session.enc`.

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
  --sleep-seconds 2
```

Resume an interrupted backfill:

```bash
docker exec garmin-mcp python -m sync.backfill \
  --start-date 2020-01-01 \
  --end-date 2026-06-14 \
  --output /app/data/archive
```

Use `--force` to ignore `backfill_checkpoint.json` and start from `--start-date` again. Activity details are fetched only when `/app/data/archive/activity_details/{activity_id}.json` does not already exist.

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
└── activity_details/{activity_id}.json
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
- raw Garmin payloads
- Garmin credentials

Only normalized JSON files are written under `/app/data`. The encrypted session file stays under `/app/secrets`.

Do not expose a public unauthenticated sync endpoint.

## Future `sync_now` Plan

Do not add unauthenticated sync.

For self-hosting, a future `sync_now` should use one of these protected patterns:

- MCP tool `sync_now` requiring the same bearer-authenticated `/mcp` channel, with server-side rate limiting and a single-process lock.
- A local-only admin endpoint bound to the Docker network, protected by a separate admin token.
- A queue/file signal consumed by the scheduled sync process.

The existing `latest_sync_status.json`, `get_sync_status`, and `get_latest_activity` tools are already the polling/read side of that future flow.

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
