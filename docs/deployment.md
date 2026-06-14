# Deployment Guide

## Google Cloud

Create:

- A GCS bucket for prepared Garmin JSON.
- An Artifact Registry Docker repository.
- A Cloud Run service account with read access to the bucket.
- A GitHub Actions deployment identity.

Workload Identity Federation is preferred. A service account JSON key is supported for v1 through `GCP_SERVICE_ACCOUNT_JSON`, but should be rotated and removed once WIF is configured.

## GitHub Variables

- `GCP_PROJECT_ID`
- `GCP_REGION`
- `ARTIFACT_REPOSITORY`
- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_SERVICE_ACCOUNT`

## GitHub Secrets

- `GCS_BUCKET`
- `MCP_BEARER_TOKEN`
- `GARMIN_EMAIL`
- `GARMIN_PASSWORD`
- `GARMIN_SESSION_KEY`
- `GCP_SERVICE_ACCOUNT_JSON` only if not using WIF

Generate `GARMIN_SESSION_KEY` as 32 random bytes encoded with base64:

```bash
python - <<'PY'
import base64, os
print(base64.b64encode(os.urandom(32)).decode())
PY
```

## Cloud Run

The server listens on `process.env.PORT` and exposes:

- `/healthz`
- `/mcp`

The MCP endpoint is intentionally unauthenticated at Cloud Run ingress but protected by an application bearer token. This keeps ChatGPT connector setup simple while avoiding public anonymous access to Garmin data.

## Local GCS Validation

Authenticate locally with Application Default Credentials:

```bash
gcloud auth application-default login
```

Run a dry-run upload first:

```bash
source .venv/bin/activate
python -m sync.main --days 7 --output ./local-data --dry-run-upload
```

Then upload normalized JSON to GCS:

```bash
export GCS_BUCKET=your-bucket-name
export GCS_PREFIX=latest
python -m sync.main --days 7 --output ./local-data --upload-gcs
```

Only `*.json` files from the output directory are uploaded. The sync does not upload `.env`, `.garmin-session.enc`, logs, raw Garmin payloads, or credentials.

Validate that the local MCP server reads from GCS:

```bash
cd server
GARMIN_DATA_MODE=gcs \
GCS_BUCKET=your-bucket-name \
GCS_PREFIX=latest \
MCP_BEARER_TOKEN=dev-token \
npm run dev
```

In another terminal:

```bash
curl http://localhost:3000/healthz
```

The response should include the real Garmin manifest date range, `sync_status`, and `latest_activity_id`.
