# TrueNAS Self-Hosted Deployment

This deployment runs the TypeScript MCP HTTP server and Python Garmin sync in one container. The container stores normalized Garmin JSON under `/app/data` and the encrypted Garmin session under `/app/secrets`.

Cloud Run and GCS support remain available; this is an additional self-hosted path for running behind your existing Cloudflare Tunnel.

## Layout

- MCP server: `http://garmin-mcp:3000`
- Normalized JSON volume: `/app/data`
- Encrypted session volume: `/app/secrets`
- Encrypted session file: `/app/secrets/.garmin-session.enc`
- Default sync schedule: daily at `06:00` in `Asia/Kolkata`
- Health check: `GET /healthz`

Use this host directory structure on TrueNAS:

```text
/mnt/scg_pool_1/apps/garmin-mcp/
├── data
├── secrets
└── repo
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
GARMIN_DATA_DIR=/app/data
GARMIN_SESSION_FILE=/app/secrets/.garmin-session.enc
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
docker compose up -d --build
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
GARMIN_DATA_DIR=/app/data
GARMIN_SESSION_FILE=/app/secrets/.garmin-session.enc
TZ=Asia/Kolkata
```

Validate compose before starting:

```bash
docker compose config
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

Run a manual sync:

```bash
docker exec garmin-mcp python -m sync.main --days 7 --output /app/data
```

The manual command works because the container sets `GARMIN_SESSION_FILE=/app/secrets/.garmin-session.enc`.

View scheduled sync logs:

```bash
docker logs garmin-mcp
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

## Troubleshooting

If `/healthz` returns an error before the first sync, run:

```bash
docker exec garmin-mcp python -m sync.main --days 7 --output /app/data --force-login
```

If Garmin session reuse fails, keep the same `GARMIN_SESSION_KEY` and confirm `/app/secrets` is persistent.
