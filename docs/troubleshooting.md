# Troubleshooting

## `/mcp` returns 401

Check that the connector sends `Authorization: Bearer ...` and that it matches the `MCP_BEARER_TOKEN` Cloud Run environment variable or secret.

## `/healthz` returns 503

The server cannot read `manifest.json`. Confirm `GCS_BUCKET`, Cloud Run service account permissions, and that the sync workflow uploaded `latest/manifest.json`.

## Sync fails at Garmin login

Garmin may require MFA or session refresh. For v1, rerun manually after confirming the account can log in. Do not print Garmin cookies, tokens, auth headers, or passwords in workflow logs.

## Sync repeatedly performs full login

Confirm `GARMIN_SESSION_KEY` is configured and stable. If the key changes, the cached `.garmin-session.enc` file cannot be decrypted and the sync will safely fall back to a full login.

Use `python -m sync.main --force-login --days 30 --output sync-output` to intentionally refresh the encrypted session.

## Tool returns missing data

Garmin fields vary by device and account. Normalizers tolerate missing fields and omit nulls, so some fields may be absent until the adapter is tuned for your account payloads.

## GCS upload fails locally

Run `gcloud auth application-default login` and confirm `GCS_BUCKET` points to an existing bucket. Use `--dry-run-upload` to inspect object paths before contacting GCS.

## Server cannot read from GCS

Confirm `GARMIN_DATA_MODE=gcs`, `GCS_BUCKET`, and `GCS_PREFIX` match the uploaded object paths. The server expects `manifest.json` at `gs://$GCS_BUCKET/$GCS_PREFIX/manifest.json`.
