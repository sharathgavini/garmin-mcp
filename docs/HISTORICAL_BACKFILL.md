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

## Repair Missing Activity Details

If `audit_data_quality` reports healthy streams but many missing activity detail files, repair only details instead of rerunning full backfill:

```bash
docker exec garmin-mcp python -m sync.repair_activity_details \
  --start-date 2026-03-18 \
  --end-date 2026-06-14 \
  --output /app/data/archive \
  --sleep-seconds 1
```

The repair command reads archive activity partitions, skips existing detail files unless `--force` is passed, writes normalized detail files under `/app/data/archive/activity_details`, writes raw payloads under `/app/data/archive/raw/activity_details` by default, and records `/app/data/archive/activity_detail_repair_status.json`.

Check the latest repair result through MCP with `repair_activity_details_status` or in `get_system_status`.

Raw payloads are written under the archive itself when `--include-raw true`:

```text
/app/data/archive/raw/daily/...
/app/data/archive/raw/activity_details/{activity_id}.json
/app/data/archive/raw/activity_streams/{activity_id}.json
```

## Re-Normalize Sleep and HRV From Raw

If `sleep.json` or `hrv.json` contains only date fields, raw Garmin payloads can be reprocessed without calling Garmin again.

Latest data:

```bash
python -m sync.renormalize \
  --input /app/data/latest/raw \
  --output /app/data/latest \
  --datasets sleep,hrv
```

Archive data:

```bash
python -m sync.renormalize \
  --input /app/data/archive/raw \
  --output /app/data/archive \
  --datasets sleep,hrv
```

After this, sleep records should include duration, stages, sleep stress, SpO2, body battery change, naps, sleep need/alignment, and breathing disruption fields where Garmin provided them. HRV records should include last night average, weekly average, status, baseline fields, and readings where Garmin provided them.

Before rerunning a forced backfill to repair extraction, inspect a known activity first:

```bash
docker exec garmin-mcp python -m sync.inspect_activity \
  --activity-id 23206576686 \
  --output /app/data/debug
```

See [DEBUG_GARMIN_ACTIVITY.md](DEBUG_GARMIN_ACTIVITY.md).

## Archive Queries

The MCP server reads partitioned archive files for explicit historical ranges. Use archive tools for anything beyond the latest sync window, such as 90-day trends, month-over-month comparisons, or all activities in a season.

Archive-aware MCP tools:

- `get_archive_range_summary`
- `get_activities_by_date_range`
- `get_workouts_by_date_range`
- `get_health_metrics_by_date_range`
- `audit_data_quality`
- `get_metric_inventory`
- `get_training_load_dashboard`
- `get_recovery_dashboard`
- `detect_training_anomalies`
- `analyze_training_period`
- `compare_training_periods`

These tools accept `date_range_preset` values such as `last_30_days`, `last_90_days`, `this_month`, `last_month`, and `year_to_date`. Responses include resolved start/end dates so agents do not silently guess date math.

Example prompts:

```text
Use Garmin MCP and summarize my last 3 months of training from the archive.
Use Garmin MCP and get all road biking activities between 2025-10-01 and 2026-06-14.
Use Garmin MCP and compare my cycling volume in May vs June.
Use Garmin MCP and show my HRV trend from October 2025 to today.
Use Garmin MCP and analyze my training period from 2026-05-01 to 2026-06-14.
Use Garmin MCP and audit data quality for the last 90 days.
Use Garmin MCP and show my recovery dashboard for last_14_days.
```

If archive coverage is incomplete, these tools return the requested range, loaded/missing partitions, available archive dates, missing dates, and warnings instead of silently answering from `/app/data/latest`.
