# Sync Directory

This directory contains Python code that fetches Garmin data and writes JSON files for the MCP server.

## What It Does

- Restores or creates an encrypted Garmin session.
- Fetches latest health data and activities.
- Runs historical backfills.
- Preserves raw Garmin payloads.
- Normalizes Garmin data for MCP tools.
- Extracts and normalizes activity streams.
- Writes manifests, sync status, and backfill checkpoints.
- Uploads generated JSON to GCS when requested.

## Important Files

- `main.py` - latest sync CLI.
- `backfill.py` - historical archive backfill CLI.
- `activity_streams.py` - tolerant activity stream extraction and normalization.
- `session_manager.py` - Garmin login/session restore and encrypted session file handling.
- `crypto.py` - encryption helpers.
- `coach_context.py` - compact recent coaching context generator.
- `gcs_upload.py` - GCS upload helper.
- `sync_garmin.py` - wrapper entrypoint used by workflow-style sync.
- `garmin_sync/normalizers.py` - normalizers for daily, sleep, HRV, stress, body battery, activities, and details.

## Commands

Latest sync:

```bash
python -m sync.main --days 30 --output ./local-data/latest --include-raw true --activity-details true --activity-streams true
```

Historical backfill:

```bash
python -m sync.backfill --start-date 2025-10-01 --end-date 2026-06-14 --output ./local-data/archive --include-raw true --activity-details true --activity-streams true
```

Dry-run GCS upload:

```bash
python -m sync.main --days 7 --output ./local-data/latest --dry-run-upload
```
