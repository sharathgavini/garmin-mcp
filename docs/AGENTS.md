# Agent Guide

This file is written for coding agents and MCP clients that need to understand this repo quickly.

## Use the Right Tool Family

Use latest tools for current data:

- `get_data_capabilities`
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

Call `get_data_capabilities` before broad analysis. It tells you the available history range, latest coverage, supported health datasets, supported activity types, stream fields, raw data availability, activity stream availability, total activity count, total days available, and archive statistics.

Every tool response includes `source` or `sources_used`. Do not infer whether data came from latest or archive if the response already says it.

Archive/range tools include `coverage` with `days_requested`, `days_found`, and `completeness_percent`. If a date was defaulted, read `defaults_applied` instead of assuming the user asked for a range.

Activity stream and workout analysis tools include `streams_available`, `stream_sample_count`, `full_data_available`, `available_streams`, and `missing_streams`. Use those fields when deciding how complete an activity analysis can be.

Use stream tools for detailed workout analysis:

- `get_activity_streams`
- `get_latest_workout_streams`
- `get_latest_ride_streams`
- `analyze_activity`

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
