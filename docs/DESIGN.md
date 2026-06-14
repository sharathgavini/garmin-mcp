# Design Document

## Goals

Garmin MCP is designed to be the canonical personal Garmin data source for AI clients.

Primary goals:

- Preserve everything Garmin exposes.
- Store both raw and normalized data.
- Keep latest queries fast.
- Support long-range archive queries.
- Expose full activity streams for deep workout analysis.
- Avoid requiring external activity services for Garmin analysis.
- Run well on TrueNAS behind Cloudflare Tunnel.

## Non-Goals

- No database in the current version.
- No public unauthenticated sync endpoint.
- No storage minimization for self-hosted mode.
- No coaching claims baked into server logic; the server returns structured analysis-ready data.

## Key Design Decisions

### JSON Files Instead of a Database

The v1 system uses JSON files because the dataset is small, easy to inspect, easy to back up, and simple to serve from both local disk and GCS.

### Latest and Archive Are Separate

`latest/` powers fast current MCP tools.

`archive/` powers explicit historical date-range tools.

This prevents a long-range question from silently being answered from only the latest sync window.

### Raw and Normalized Data Both Matter

Normalized data powers tools today.

Raw data protects future analytics because Garmin schema fields may become useful later.

### Activity Streams Are First-Class

Activity stream files preserve second-by-second or sample-level Garmin data when available:

- heart rate
- cadence
- speed
- power
- elevation
- distance
- GPS
- laps and splits

Tools do not downsample streams unless explicitly requested.

### Sync Is Separate From Serving

Garmin login/session handling lives in Python sync code.

The TypeScript server reads prepared JSON and exposes MCP tools.

### Auth Stays Mandatory

The server supports bearer auth and OAuth. `sync_now` is a protected MCP tool and should never be exposed as an unauthenticated HTTP endpoint.

## Main Components

- `sync/main.py`: latest sync.
- `sync/backfill.py`: historical archive backfill.
- `sync/activity_streams.py`: tolerant Garmin stream extraction and normalization.
- `sync/session_manager.py`: encrypted session restore and login.
- `server/src/app.ts`: Express app, auth gates, MCP registration.
- `server/src/tools.ts`: tool schemas and handlers.
- `server/src/data.ts`: local and GCS data readers.
- `server/src/workouts.ts`: workout selection, stream shaping, and analysis helpers.
- `server/src/oauth.ts`: single-user OAuth support.

## Failure Handling

- Missing Garmin data becomes empty normalized records or explicit warnings.
- Missing archive partitions are returned as coverage warnings.
- Upload failures mark sync status failed.
- Backfill failures write checkpoints before raising.
- Stale sync locks are reported by `get_sync_status`.

## Future Improvements

- Optional DuckDB or SQLite if JSON becomes too slow.
- More sport-specific analysis modules.
- More Garmin endpoints as the library exposes them.
- Admin UI for sync status and backfill progress.
- Rate limiting for `sync_now`.
