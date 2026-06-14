# Architecture

Garmin MCP is split into a sync plane and a serving plane.

## System Diagram

```text
Garmin Connect
  |
  | encrypted session restore or login
  v
Python sync jobs
  |
  | write normalized JSON, raw payloads, streams, manifests, status
  v
Persistent data directory
  |
  +-- latest/
  |     +-- daily.json
  |     +-- activities.json
  |     +-- activity_details/
  |     +-- activity_streams/
  |     +-- raw/
  |
  +-- archive/
        +-- daily/year=YYYY/month=MM/daily.json
        +-- activities/year=YYYY/month=MM/activities.json
        +-- activity_details/
        +-- activity_streams/
        +-- raw/
  |
  v
TypeScript MCP HTTP server
  |
  +-- bearer auth
  +-- OAuth for remote MCP clients
  +-- /healthz
  +-- /mcp tools
  |
  v
ChatGPT / Claude / MCP clients
```

## Sync Plane

The sync plane lives in `sync/`.

Responsibilities:

- Restore encrypted Garmin session.
- Log in only when needed.
- Fetch daily health metrics.
- Fetch activities, activity details, and activity streams.
- Preserve raw Garmin payloads for future reprocessing.
- Normalize data into MCP-friendly JSON.
- Write status, checkpoint, and manifest files.
- Upload to GCS when Cloud Run mode is used.

Primary commands:

```bash
python -m sync.main --days 30 --output /app/data/latest
python -m sync.backfill --start-date 2025-10-01 --end-date 2026-06-14 --output /app/data/archive
```

## Serving Plane

The serving plane lives in `server/`.

Responsibilities:

- Serve MCP over HTTP at `/mcp`.
- Protect MCP with bearer token or OAuth access token.
- Serve health at `/healthz`.
- Read local JSON or GCS JSON.
- Expose latest, archive, stream, analysis, OAuth, and sync tools.
- Never handle Garmin passwords inside MCP tool calls.

## Storage Layout

Latest data is optimized for fast current-state questions:

```text
/app/data/latest/
  manifest.json
  latest_sync_status.json
  daily.json
  sleep.json
  hrv.json
  stress.json
  body_battery.json
  activities.json
  activity_details/{activity_id}.json
  activity_streams/{activity_id}.json
  raw/
```

Archive data is optimized for explicit date-range questions:

```text
/app/data/archive/
  manifest.json
  backfill_checkpoint.json
  daily/year=YYYY/month=MM/daily.json
  sleep/year=YYYY/month=MM/sleep.json
  hrv/year=YYYY/month=MM/hrv.json
  stress/year=YYYY/month=MM/stress.json
  body_battery/year=YYYY/month=MM/body_battery.json
  activities/year=YYYY/month=MM/activities.json
  activity_details/{activity_id}.json
  activity_streams/{activity_id}.json
  raw/
```

## Request Flow

Latest/recent tool:

```text
MCP client -> /mcp -> tool handler -> latest JSON reader -> response
```

Archive range tool:

```text
MCP client -> /mcp -> archive tool -> month partition reader -> coverage + rows -> response
```

Sync now:

```text
MCP client -> sync_now -> sync.lock -> background python sync -> latest_sync_status.json
```

## Authentication

The server accepts:

- `Authorization: Bearer $MCP_BEARER_TOKEN`
- OAuth access tokens issued by the built-in single-user OAuth flow

No unauthenticated sync endpoint exists.

## Deployment Modes

- Local sample-data development
- TrueNAS self-hosted Docker container
- Cloud Run plus GCS
- GitHub Actions scheduled sync
