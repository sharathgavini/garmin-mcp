# Agent Guide

This file is written for coding agents and MCP clients that need to understand this repo quickly.

## Use the Right Tool Family

Use latest tools for current data:

- `get_data_capabilities`
- `get_system_status`
- `get_tool_guide`
- `audit_data_quality`
- `get_metric_inventory`
- `get_recovery_dashboard`
- `get_training_load_dashboard`
- `detect_training_anomalies`
- `get_schema_version`
- `repair_activity_details_status`
- `get_sync_completeness`
- `get_dataset_status`
- `get_today_summary`
- `get_range_summary`
- `get_recent_activities`
- `get_latest_activity`
- `get_latest_workout`
- `get_latest_ride`

Use archive tools for long-range or explicit historical dates:

- `get_archive_range_summary`
- `get_activities_by_date_range`
- `get_workouts_by_date_range`
- `get_health_metrics_by_date_range`
- `get_sleep_for_date`
- `get_hrv_for_date`
- `get_recovery_for_date`
- `analyze_training_period`
- `compare_training_periods`

For single-day sleep, HRV, or recovery questions, prefer the dedicated single-date tools:

- "Use Garmin MCP and get my sleep for 2026-06-14."
- "Use Garmin MCP and get my HRV for 2026-06-14."
- "Use Garmin MCP and get my recovery for 2026-06-14."

For date range tools, `end_date` is optional and defaults to `start_date`. Some clients send `end_date: null` for a single day; this is accepted.
The response includes `defaults_applied`, `resolved_start_date`, and `resolved_end_date` so agents can state exactly what range was used.

Range-oriented tools can also use `date_range_preset`: `today`, `yesterday`, `last_7_days`, `last_14_days`, `last_30_days`, `last_90_days`, `this_week`, `last_week`, `this_month`, `last_month`, or `year_to_date`. Responses include `resolved_start_date` and `resolved_end_date`.

Call `get_data_capabilities` before broad analysis. It tells you the available history range, latest coverage, supported health datasets, supported activity types, stream fields, raw data availability, activity stream availability, total activity count, total days available, and archive statistics.

Call `get_system_status` before trusting recovery or historical analysis. It summarizes latest sync health, archive backfill status, available datasets, auth mode, and warnings for stale data, date-only sleep/HRV normalization, or missing streams.

Call `get_tool_guide` when tool choice is unclear.

Call `audit_data_quality` before long-range coaching or if a result looks incomplete.

If `audit_data_quality` reports missing `activity_details`, recommend:

```bash
docker exec garmin-mcp python -m sync.repair_activity_details --start-date 2026-03-18 --end-date 2026-06-14 --output /app/data/archive --sleep-seconds 1
```

Use `get_recovery_dashboard`, `get_training_load_dashboard`, and `detect_training_anomalies` for coaching-ready summaries. These tools are conservative and report estimates or missing data instead of pretending to be Garmin official scores.

Tool errors use a structured envelope with `error_code`, `message`, and fields such as `param`, `received`, `valid_values`, or `hint`. For stream fields, use canonical names like `speed_mps`, `altitude_m`, and `distance_m`; aliases `speed`, `altitude`, and `distance` are accepted.

`sync_now` now launches `python -m sync.sync_now`, which is incremental by default. Use `full: true` only when a complete pull is needed, and `force: true` to bypass the cooldown guard.

Every tool response includes `source` or `sources_used`. Do not infer whether data came from latest or archive if the response already says it.

Archive/range tools include `coverage` with `days_requested`, `days_found`, `completeness_percent`, `missing_dates`, `available_start_date`, and `available_end_date`. If a date was defaulted, read `defaults_applied` instead of assuming the user asked for a range.

Activity stream and workout analysis tools include `streams_available`, `stream_sample_count`, `full_data_available`, `partial_stream`, `available_streams`, and `missing_streams`. Use those fields when deciding how complete an activity analysis can be.

Before recovery advice, call `get_sync_completeness` or `get_recovery_for_date`. A sync is complete for recovery only when daily, sleep, HRV, stress, body battery, activities, details, and streams are refreshed and `get_recovery_for_date.full_recovery_data_available` is true. If false, use the `missing` list; do not send the user to Strava, Apple Health, or Garmin Connect as a fallback.

Use `sync_now` with `force_refresh: true` when sleep score, HRV, or recovery data appears stale after a normal sync.

Use stream tools for detailed workout analysis:

- `get_activity_streams`
- `get_latest_workout_streams`
- `get_latest_ride_streams`
- `analyze_activity`

## Example Agent Prompts

```text
Use Garmin MCP and get data capabilities.
Use Garmin MCP and audit data quality for the last 90 days.
Use Garmin MCP and show my recovery dashboard for last_14_days.
Use Garmin MCP and show my training load dashboard for last_30_days.
Use Garmin MCP and detect training anomalies for last_30_days.
Use Garmin MCP and show which tool I should use to analyze my latest ride.
```

## Do Not Suggest External Fallbacks

Garmin MCP is intended to be the canonical source of Garmin data. If a stream is missing, tell the user to run sync or backfill with activity streams enabled.

## Important Paths

```text
/app/data/latest
/app/data/archive
/app/secrets/.garmin-session.enc
```

## Safe Commands

Run tests:

```bash
.venv/bin/python -m pytest tests
cd server && npm test
```

Run latest sync:

```bash
python -m sync.main --days 30 --output /app/data/latest --include-raw true --activity-details true --activity-streams true
```

Run backfill:

```bash
python -m sync.backfill --start-date 2025-10-01 --end-date 2026-06-14 --output /app/data/archive --include-raw true --activity-details true --activity-streams true
```

Repair normalized sleep/HRV from raw files:

```bash
python -m sync.renormalize --input /app/data/latest/raw --output /app/data/latest --datasets sleep,hrv
python -m sync.renormalize --input /app/data/archive/raw --output /app/data/archive --datasets sleep,hrv
```

## Files To Read First

- `README.md`
- `docs/GETTING_STARTED.md`
- `docs/ARCHITECTURE.md`
- `docs/MCP_TOOLS.md`
- `server/src/tools.ts`
- `sync/main.py`
- `sync/backfill.py`

## Editing Rules

- Do not commit credentials or session files.
- Do not expose unauthenticated sync.
- Keep latest and archive behavior separate.
- Keep stream data full fidelity unless the caller explicitly asks for downsampling.
