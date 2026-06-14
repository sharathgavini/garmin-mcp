# Getting Started

This guide is for a new user who wants to run Garmin MCP locally, understand the files, and eventually deploy it on TrueNAS.

## What This Project Does

Garmin MCP lets an AI client ask questions about your Garmin data through MCP tools.

Examples:

```text
Use Garmin MCP and summarize my last 3 months of training from the archive.
Use Garmin MCP and analyze my latest ride using full Garmin streams.
Use Garmin MCP and show my HRV trend from October 2025 to today.
```

## The Big Picture

```text
Garmin Connect
  -> Python sync
  -> /app/data/latest and /app/data/archive JSON files
  -> TypeScript MCP server
  -> ChatGPT or Claude
```

## Local Development Setup

From the repo root:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r sync/requirements.txt
pip install -r requirements-dev.txt
```

Install server dependencies:

```bash
cd server
npm install
```

Run tests:

```bash
cd ..
.venv/bin/python -m pytest tests
cd server
npm test
```

Run the MCP server against sample data:

```bash
cd server
GARMIN_DATA_MODE=local GARMIN_DATA_DIR=../sample-data MCP_BEARER_TOKEN=dev-token npm run dev
```

Check health:

```bash
curl http://localhost:3000/healthz
```

## Real Garmin Sync

Create `.env` in the repo root:

```text
GARMIN_EMAIL=...
GARMIN_PASSWORD=...
GARMIN_SESSION_KEY=...
GARMIN_SESSION_FILE=./local-secrets/.garmin-session.enc
```

Generate a session key:

```bash
python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(32))
PY
```

Run latest sync:

```bash
python -m sync.main \
  --days 30 \
  --output ./local-data/latest \
  --include-raw true \
  --activity-details true \
  --activity-streams true
```

Run archive backfill:

```bash
python -m sync.backfill \
  --start-date 2025-10-01 \
  --end-date 2026-06-14 \
  --output ./local-data/archive \
  --include-raw true \
  --activity-details true \
  --activity-streams true
```

## TrueNAS Path

Use [TRUENAS_DEPLOYMENT.md](TRUENAS_DEPLOYMENT.md) when you are ready to run the container on TrueNAS behind Cloudflare Tunnel.

The important mount paths are:

```text
/mnt/scg_pool_1/apps/garmin-mcp/data    -> /app/data
/mnt/scg_pool_1/apps/garmin-mcp/secrets -> /app/secrets
```

## Where To Look Next

- Tool list: [MCP_TOOLS.md](MCP_TOOLS.md)
- Architecture: [ARCHITECTURE.md](ARCHITECTURE.md)
- Design choices: [DESIGN.md](DESIGN.md)
- Agent notes: [AGENTS.md](AGENTS.md)
