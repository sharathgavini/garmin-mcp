# Garmin MCP

Garmin MCP is a self-hostable Model Context Protocol server that lets ChatGPT, Claude, and other MCP clients query your Garmin Connect data.

The project has two main parts:

- Python sync jobs fetch Garmin data, preserve raw payloads, normalize JSON, and maintain latest/archive datasets.
- A TypeScript MCP HTTP server reads those prepared JSON files and exposes tools for health summaries, activity streams, workout analysis, historical archive queries, OAuth, and sync triggering.

## Start Here

If you are new to this project, read these in order:

1. [Getting Started](docs/GETTING_STARTED.md)
2. [End-to-End Guide](docs/END_TO_END.md)
3. [Architecture](docs/ARCHITECTURE.md)
4. [Design](docs/DESIGN.md)
5. [MCP Tools](docs/MCP_TOOLS.md)
6. [Agent Guide](docs/AGENTS.md)
7. [TrueNAS Deployment](docs/TRUENAS_DEPLOYMENT.md)

## Repository Layout

- `sync/` - Python Garmin sync, backfill, session encryption, normalizers, raw payload and stream storage, and GCS upload helpers.
- `server/` - TypeScript MCP server, OAuth routes, data readers, tool handlers, workout analysis, and Dockerfile.
- `docker/` - self-hosted container entrypoint and scheduled sync scripts.
- `.github/workflows/` - GitHub Actions Garmin sync workflow.
- `docs/` - setup, design, architecture, tool catalog, deployment, OAuth, troubleshooting, and agent-facing notes.
- `sample-data/` - redacted JSON fixtures for local development and MCP tests.
- `tests/` - Python tests for sync, backfill, crypto, GCS upload, normalizers, and stream extraction.

## Local Quick Start

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r sync/requirements.txt
pip install -r requirements-dev.txt

cd server
npm install
npm test
GARMIN_DATA_MODE=local GARMIN_DATA_DIR=../sample-data MCP_BEARER_TOKEN=dev-token npm run dev
```

The local server exposes:

- `GET /healthz`
- `POST /mcp` with `Authorization: Bearer dev-token`

For AI clients, the recommended first calls are:

- `get_data_capabilities` to discover available date ranges, datasets, sports, streams, and archive statistics.
- `get_system_status` to check sync health, archive backfill status, stale-data warnings, and whether sleep/HRV normalization or activity streams need attention.
- `get_tool_guide` when Claude/ChatGPT needs routing help.
- `audit_data_quality` before long-range coaching or when data looks incomplete.
- `get_recovery_dashboard`, `get_training_load_dashboard`, and `detect_training_anomalies` for coaching-ready summaries.

Range-oriented tools accept explicit `start_date`/`end_date` or presets such as `last_14_days`, `last_30_days`, and `last_90_days`.
If `end_date` is omitted or `null`, MCP defaults it to `start_date` for single-day safety and returns the resolved dates in the response.

## Common Commands

Run Python tests:

```bash
.venv/bin/python -m pytest tests
```

Run server tests:

```bash
cd server
npm test
```

Run latest sync locally:

```bash
python -m sync.main --days 30 --output ./local-data/latest --include-raw true --activity-details true --activity-streams true
```

Run historical backfill locally:

```bash
python -m sync.backfill --start-date 2025-10-01 --end-date 2026-06-14 --output ./local-data/archive --include-raw true --activity-details true --activity-streams true
```

Repair missing archive activity details without rerunning full backfill:

```bash
python -m sync.repair_activity_details --start-date 2026-03-18 --end-date 2026-06-14 --output ./local-data/archive --sleep-seconds 1
```

Run incremental sync locally:

```bash
python -m sync.sync_now --output ./local-data/latest
python -m sync.sync_now --output ./local-data/latest --full
```

`sync.sync_now` writes `/archive/sync_state.json` next to the latest directory and augments `latest_sync_status.json` with `run_type`, `dataset_watermarks`, fetched/upserted counts, lookback, and cooldown metadata.

## Supported Deployment Modes

- Local development with `sample-data/`
- TrueNAS self-hosted container behind Cloudflare Tunnel
- Cloud Run plus GCS
- GitHub Actions scheduled sync

## Security Notes

- Do not commit `.env`, Garmin credentials, OAuth tokens, bearer tokens, or encrypted Garmin session files.
- Keep `/app/secrets` persistent and private.
- The MCP server reads prepared JSON; Garmin login happens in the sync process.
- `sync_now` is exposed only as an authenticated MCP tool, not as an unauthenticated HTTP endpoint.

## Tool Error Envelope

MCP tools return structured errors with `error_code`, `message`, and helpful fields such as `param`, `received`, `valid_values`, or `hint`. Common codes include `MISSING_REQUIRED_PARAM`, `INVALID_FIELD_NAME`, and `NO_DATA_FOR_RANGE`.
