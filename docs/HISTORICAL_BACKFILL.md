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

## Archive Queries

The MCP server reads partitioned archive files for explicit historical ranges. Use archive tools for anything beyond the latest sync window, such as 90-day trends, month-over-month comparisons, or all activities in a season.

Archive-aware MCP tools:

- `get_archive_range_summary`
- `get_activities_by_date_range`
- `get_workouts_by_date_range`
- `get_health_metrics_by_date_range`
- `analyze_training_period`
- `compare_training_periods`

Example prompts:

```text
Use Garmin MCP and summarize my last 3 months of training from the archive.
Use Garmin MCP and get all road biking activities between 2025-10-01 and 2026-06-14.
Use Garmin MCP and compare my cycling volume in May vs June.
Use Garmin MCP and show my HRV trend from October 2025 to today.
Use Garmin MCP and analyze my training period from 2026-05-01 to 2026-06-14.
```

If archive coverage is incomplete, these tools return the requested range, loaded/missing partitions, available archive dates, missing dates, and warnings instead of silently answering from `/app/data/latest`.
