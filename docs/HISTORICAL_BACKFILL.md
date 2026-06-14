# Historical Backfill

Historical backfill stores partitioned archive data under `/app/data/archive` and keeps `/app/data/latest` fast for MCP reads.

Detached full historical backfill:

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
  > /mnt/scg_pool_1/apps/garmin-mcp/data/exports/backfill-full.log 2>&1 &
```

Resume:

```bash
docker exec garmin-mcp python -m sync.backfill \
  --start-date 2025-10-01 \
  --end-date 2026-06-14 \
  --output /app/data/archive \
  --include-raw true \
  --activity-details true \
  --activity-streams true
```

Backfill writes `backfill_checkpoint.json` after each chunk. Existing activity details and stream files are skipped unless `--force` is passed, which keeps reruns safe for long Garmin histories.
