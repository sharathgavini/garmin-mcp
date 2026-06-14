# Garmin MCP

Remote MCP server for ChatGPT access to prepared Garmin Connect data.

This project keeps Garmin login/session material out of the MCP server. A scheduled GitHub Actions sync prepares compact JSON files, uploads them to Google Cloud Storage, and a Cloud Run MCP server reads only those prepared files.

## Repository Layout

- `sync/` - Python sync skeleton, normalizers, and GCS uploader.
- `server/` - TypeScript MCP server, tools, data readers, and Dockerfile.
- `.github/workflows/` - daily sync and Cloud Run deployment workflows.
- `docs/` - setup, deployment, ChatGPT connector, threat model, and troubleshooting.
- `sample-data/` - redacted JSON fixtures for local development and tests.
- `tests/` - Python normalizer tests.

## Quick Start

```bash
cd server
npm install
npm test
GARMIN_DATA_MODE=local GARMIN_DATA_DIR=../sample-data MCP_BEARER_TOKEN=dev-token npm run dev
```

The local server exposes:

- `GET /healthz`
- `POST /mcp` with `Authorization: Bearer dev-token`

See [docs/setup.md](docs/setup.md) and [docs/deployment.md](docs/deployment.md).

For TrueNAS/self-hosted deployment behind Cloudflare Tunnel, see [docs/TRUENAS_DEPLOYMENT.md](docs/TRUENAS_DEPLOYMENT.md).

For ChatGPT/Claude remote connector OAuth setup, see [docs/OAUTH_SETUP.md](docs/OAUTH_SETUP.md).
