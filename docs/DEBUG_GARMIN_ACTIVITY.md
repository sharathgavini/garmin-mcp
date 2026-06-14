# Debug Garmin Activity Extraction

Use the activity inspector before rerunning a full historical backfill. It shows exactly which Garmin library methods exist, which activity payloads can be fetched, what keys they contain, and whether stream samples can be extracted.

## Run In TrueNAS Container

```bash
docker exec garmin-mcp python -m sync.inspect_activity \
  --activity-id 23206576686 \
  --output /app/data/debug
```

This writes:

```text
/app/data/debug/activity_23206576686/
  raw_activity_detail.json
  raw_activity_streams.json
  raw_activity_splits.json
  raw_activity_laps.json
  raw_activity_graphs.json
  raw_activity_typed_splits.json
  raw_activity_weather.json
  raw_activity_polyline.json
  client_method_inventory.txt
  client_method_inventory.json
  key_inventory.txt
  key_inventory.json
  stream_inventory.json
  summary.json
```

Unavailable endpoints are written as JSON placeholders with method/error metadata so the inspection continues.

## Read The Output On TrueNAS

```bash
cat /mnt/scg_pool_1/apps/garmin-mcp/data/debug/activity_23206576686/summary.json
cat /mnt/scg_pool_1/apps/garmin-mcp/data/debug/activity_23206576686/key_inventory.txt
cat /mnt/scg_pool_1/apps/garmin-mcp/data/debug/activity_23206576686/client_method_inventory.txt
```

## What To Look For

- `summary.json`: quick status, normalized detail, checked payloads, stream fields.
- `client_method_inventory.json`: Garmin client methods that look activity/stream-related.
- `key_inventory.txt`: nested keys in fetched payloads.
- `stream_inventory.json`: row-based and column-based stream extraction result.
- `raw_*.json`: raw endpoint responses or error placeholders.

If `heart_rate` or `cadence` is missing, inspect `checked_payloads` and the raw files before assuming Garmin did not expose those fields.

## After Verification

Only after the inspector shows extraction is working, rerun the historical backfill with `--force`:

```bash
nohup docker exec garmin-mcp python -m sync.backfill \
  --start-date 2025-10-01 \
  --end-date 2026-06-14 \
  --output /app/data/archive \
  --chunk-days 7 \
  --sleep-seconds 2 \
  --include-raw true \
  --activity-details true \
  --activity-streams true \
  --force \
  > /mnt/scg_pool_1/apps/garmin-mcp/data/exports/backfill-fixed-extraction.log 2>&1 &
```
