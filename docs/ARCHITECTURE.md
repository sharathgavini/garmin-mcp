# Architecture

Garmin MCP is split into a sync plane and a serving plane.

## System Diagram

```mermaid
flowchart TB
  Garmin["Garmin Connect"]
  Sync["Python sync jobs\nsync.main / sync.backfill"]
  Session["Encrypted Garmin session\n/app/secrets/.garmin-session.enc"]
  Data["Persistent Garmin JSON\n/app/data"]
  Latest["latest/\nfast current data"]
  Archive["archive/\npartitioned history"]
  Server["TypeScript MCP HTTP server\nExpress + MCP SDK"]
  Tunnel["Cloudflare Tunnel\ngarmin.sharathgavini.com"]
  Clients["ChatGPT / Claude / MCP clients"]

  Garmin -->|"Garmin APIs"| Sync
  Session -->|"restore login"| Sync
  Sync -->|"refresh normalized JSON"| Latest
  Sync -->|"historical backfill"| Archive
  Latest --> Data
  Archive --> Data
  Data -->|"local JSON reader"| Server
  Server -->|"HTTP /mcp + /healthz"| Tunnel
  Tunnel --> Clients
  Clients -->|"OAuth or bearer token"| Server
```

This is the main self-hosted shape. Garmin data is fetched by Python, stored as JSON on the TrueNAS bind mount, and served by the TypeScript MCP server through your Cloudflare Tunnel.

## Container View

```mermaid
flowchart LR
  subgraph TrueNAS["TrueNAS host"]
    HostData["/mnt/scg_pool_1/apps/garmin-mcp/data"]
    HostSecrets["/mnt/scg_pool_1/apps/garmin-mcp/secrets"]
    subgraph Container["garmin-mcp container"]
      Node["Node.js MCP server\nport 3000"]
      Cron["supercronic\n6 AM Asia/Kolkata"]
      Py["Python Garmin sync"]
      AppData["/app/data"]
      AppSecrets["/app/secrets"]
    end
  end

  HostData <-->|"bind mount"| AppData
  HostSecrets <-->|"bind mount"| AppSecrets
  Cron -->|"runs daily"| Py
  Py -->|"writes latest/archive JSON"| AppData
  Py -->|"reads/writes encrypted session"| AppSecrets
  Node -->|"reads latest/archive JSON"| AppData
```

The container has both runtimes because the server and sync jobs are intentionally separate processes:

- Node.js serves MCP requests.
- Python talks to Garmin Connect.
- `supercronic` runs daily sync inside the same container.
- TrueNAS bind mounts preserve data and secrets across rebuilds.

## Data Flow

```mermaid
flowchart TD
  Raw["Raw Garmin payloads\noptional raw/"]
  Normalize["Normalizers\nsleep, HRV, stress,\nbody battery, activities"]
  LatestFiles["/app/data/latest/*.json"]
  ArchiveFiles["/app/data/archive/year=YYYY/month=MM/*.json"]
  Tools["MCP tool handlers"]
  Response["AI-readable response\nsource + coverage + completeness"]

  Raw --> Normalize
  Normalize --> LatestFiles
  Normalize --> ArchiveFiles
  LatestFiles --> Tools
  ArchiveFiles --> Tools
  Tools --> Response
```

The important design rule is that MCP does not call Garmin for ordinary reads. It reads prepared JSON. This keeps ChatGPT/Claude fast, predictable, and independent of Garmin API latency.

## Tool Selection Flow

```mermaid
flowchart TD
  Question["User asks a Garmin question"]
  Capabilities["get_data_capabilities"]
  SingleDay{"Single-date recovery/sleep/HRV?"}
  Latest{"Recent/latest question?"}
  Streams{"Needs detailed workout streams?"}
  Archive{"Long historical range?"}

  Question --> Capabilities
  Capabilities --> SingleDay
  SingleDay -->|"yes"| RecoveryTools["get_sleep_for_date\nget_hrv_for_date\nget_recovery_for_date"]
  SingleDay -->|"no"| Latest
  Latest -->|"yes"| LatestTools["get_today_summary\nget_range_summary\nget_latest_workout"]
  Latest -->|"no"| Archive
  Archive -->|"yes"| ArchiveTools["get_archive_range_summary\nget_health_metrics_by_date_range\nanalyze_training_period"]
  LatestTools --> Streams
  ArchiveTools --> Streams
  Streams -->|"yes"| StreamTools["get_activity_streams\nget_latest_workout_streams\nanalyze_activity"]
  Streams -->|"no"| Answer["Answer with source + coverage"]
  StreamTools --> Answer
  RecoveryTools --> Answer
```

Agents should start with `get_data_capabilities` for broad questions. They should use `source`, `sources_used`, `coverage`, `defaults_applied`, and stream completeness fields instead of guessing what data exists.

## `sync_now` Flow

```mermaid
sequenceDiagram
  participant User as ChatGPT / Claude
  participant MCP as MCP server
  participant Lock as sync.lock
  participant Py as python -m sync.main
  participant Garmin as Garmin Connect
  participant Data as /app/data/latest

  User->>MCP: sync_now({ force_refresh: true })
  MCP->>Lock: create sync.lock
  MCP->>Data: write latest_sync_status.json running
  MCP-->>User: status started + job_id
  MCP->>Py: spawn background sync
  Py->>Garmin: fetch daily/sleep/HRV/stress/body battery
  Py->>Garmin: fetch activities/details/streams
  Py->>Data: write normalized JSON + raw payloads
  Py->>Data: write sync completeness metadata
  Py->>Lock: remove sync.lock
  User->>MCP: get_sync_completeness
  MCP->>Data: read latest files/status
  MCP-->>User: latest dates + stale warnings + health score
```

`sync_now` does not block until Garmin finishes. It starts the job, then clients poll `get_sync_status` or `get_sync_completeness`.

## Recovery Readiness Flow

```mermaid
flowchart LR
  Sleep["sleep.json\nscore, stages, SpO2,\nrespiration, stress"]
  HRV["hrv.json\novernight avg, status,\nbaseline, readings"]
  Stress["stress.json"]
  Battery["body_battery.json"]
  Daily["daily.json\nRHR, readiness, load"]
  Recovery["get_recovery_for_date"]
  Ready{"full_recovery_data_available?"}
  Advice["AI can give recovery analysis"]
  Missing["Return missing fields\nand explain data gap"]

  Sleep --> Recovery
  HRV --> Recovery
  Stress --> Recovery
  Battery --> Recovery
  Daily --> Recovery
  Recovery --> Ready
  Ready -->|"true"| Advice
  Ready -->|"false"| Missing
```

This is the reliability contract for recovery. If `full_recovery_data_available` is `true`, Garmin MCP has enough recovery data for that date. If it is `false`, the response includes a `missing` list such as `sleep_score` or `overnight_hrv`.

## OAuth / Remote Client Flow

```mermaid
sequenceDiagram
  participant Client as ChatGPT connector
  participant Tunnel as Cloudflare Tunnel
  participant Server as Garmin MCP server
  participant Secrets as /app/secrets OAuth JSON

  Client->>Tunnel: discover OAuth metadata
  Tunnel->>Server: /.well-known/oauth-authorization-server
  Client->>Server: dynamic client registration
  Server->>Secrets: store client_id/client_secret
  Client->>Server: authorize with PKCE
  Server-->>Client: authorization code
  Client->>Server: exchange code for access token
  Server->>Secrets: store access token
  Client->>Server: POST /mcp with Bearer token
```

OAuth here protects your private MCP server. It is not Garmin OAuth. Garmin authentication is handled separately by the encrypted Garmin session used by Python sync.

## Legacy Text Overview

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
