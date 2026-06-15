# MCP Tool Catalog

This file lists every MCP tool currently registered by the server.

## Latest and Recent Data

### `get_data_capabilities`

Call this first when an MCP client needs to understand what Garmin data exists before choosing another tool.

Returns:

- Archive history start and end dates
- Latest data coverage
- Supported health datasets
- Supported activity types and sport categories
- Supported stream fields
- Raw data and activity stream availability
- Total activity count and total days available
- Archive statistics for activity, stream, sleep, and HRV coverage

Important response fields:

- `history`: archive and latest date bounds plus total days available
- `health_datasets`: per-dataset availability, record counts, date bounds, and coverage
- `activity_datasets`: activity/detail/stream availability and sampled counts
- `stream_fields_observed`: stream fields actually present in stored Garmin data
- `missing_or_optional_stream_fields`: supported stream fields not observed in the sampled data
- `sport_categories_observed`: normalized sport categories seen in activities
- `archive_stats`: activity counts, sport counts, stream coverage, detail coverage, sleep coverage, and HRV coverage
- `last_sync`: latest sync status file or running lock status

### `get_system_status`

Call this when an MCP client needs to know whether the system is healthy enough to trust for recovery or historical analysis.

Returns:

- Server status
- Latest sync status
- Archive backfill checkpoint status when available
- History coverage
- Available health/activity datasets
- Auth mode summary with secrets redacted
- Warnings for stale latest data, date-only sleep/HRV normalization, missing streams, or running backfill

### `get_tool_guide`

Returns routing guidance so Claude/ChatGPT can choose the correct tool family.

Inputs:

- `intent` optional string

Use this when an agent is unsure whether it needs latest data, archive data, sleep/HRV single-date tools, stream tools, dashboards, or audits. The response explicitly says not to fall back to Strava unless the user asks.

### `audit_data_quality`

Audits local Garmin JSON only. It does not call Garmin.

Inputs:

- `date_range_preset` optional, such as `last_90_days`
- `start_date` optional `YYYY-MM-DD`
- `end_date` optional and nullable
- `datasets` optional
- `source` optional: `latest`, `archive`, or `auto`

Reports missing days, stale data, date-only sleep/HRV normalization, missing activity details, missing/empty streams, and sync status issues with `ok`, `warning`, or `critical` severity.

When activity details are missing, the issue includes a `hint` with the targeted `sync.repair_activity_details` command.

### `repair_activity_details_status`

Returns the latest `/app/data/archive/activity_detail_repair_status.json` contents, including repaired and failed detail counts.

### `get_metric_inventory`

Shows exactly which fields exist in the local dataset.

Inputs:

- `date_range_preset` optional
- `start_date` optional
- `end_date` optional and nullable
- `source` optional

Returns observed fields for health datasets, sleep, HRV, activities, activity details, activity streams, raw payload availability, and optional Garmin physiology fields such as training readiness, acute load, VO2 max, FTP, endurance score, and race predictor.

### Date Presets

Range-oriented tools accept either explicit dates or `date_range_preset`.

Supported presets:

- `today`
- `yesterday`
- `last_7_days`
- `last_14_days`
- `last_30_days`
- `last_90_days`
- `this_week`
- `last_week`
- `this_month`
- `last_month`
- `year_to_date`

Responses include `date_range_preset`, `resolved_start_date`, and `resolved_end_date`.

### `get_today_summary`

Returns the daily Garmin summary for one date from latest data.

Inputs:

- `date` optional `YYYY-MM-DD`

### `get_range_summary`

Returns compact recent sleep, HRV, stress, body battery, activity, and recovery trends from latest data.

Use archive tools for long historical ranges.

All range responses include:

- `requested_start_date`
- `requested_end_date`
- `defaults_applied` when `end_date` was omitted or `null`
- `coverage.days_requested`
- `coverage.days_found`
- `coverage.completeness_percent`
- `coverage.missing_dates`
- `coverage.available_start_date`
- `coverage.available_end_date`
- `source` or `sources_used`

Inputs:

- `start_date`
- `end_date` optional, nullable, defaults to `start_date`

### `get_recent_activities`

Returns recent activity summaries from latest data.

Use `get_activities_by_date_range` for arbitrary historical ranges.

Inputs:

- `days`

### `get_coach_context`

Returns compact recent context optimized for LLM coaching.

Inputs:

- `days`

## Activity Details and Streams

### `get_latest_activity`

Returns the latest synced activity detail.

### `get_activity_detail`

Returns one detailed activity summary without full streams.

Inputs:

- `activity_id`

### `get_activity_streams`

Returns full Garmin time-series streams for a specific activity.

Inputs:

- `activity_id`
- `source`: `latest`, `archive`, or `auto`
- `fields` optional
- `downsample` optional
- `max_points` optional

Canonical stream fields include `heart_rate`, `cadence`, `speed_mps`, `power_watts`, `altitude_m`, `distance_m`, `latitude`, `longitude`, and `temperature`. Aliases `speed`, `altitude`, `elevation`, and `distance` are accepted and mapped to canonical names. Unknown fields return `INVALID_FIELD_NAME`.

## Workout Tools

### `get_latest_workout`

Returns the latest matching workout without full streams.

Inputs:

- `activity_types` optional
- `exclude_activity_types` optional
- `sport_categories` optional
- `days` optional

### `get_latest_workout_summary`

Returns summary fields for the latest matching workout.

### `get_latest_workout_streams`

Returns full Garmin streams for the latest matching workout.

### `analyze_activity`

Returns structured analysis-ready data for one activity.

Inputs:

- `activity_id`
- `analysis_type`
- `include_streams`
- `source`

### `analyze_latest_workout`

Finds the latest matching workout and returns analysis-ready data.

## Ride Convenience Tools

### `get_latest_ride`

Returns the newest cycling activity.

### `get_latest_ride_summary`

Returns summary fields for the newest cycling activity.

### `get_latest_ride_streams`

Returns full Garmin streams for the newest cycling activity.

## Archive Tools

Archive date inputs use `YYYY-MM-DD`. For single-day queries, callers may provide only `start_date`; `end_date` is optional and defaults to `start_date`. This also works when an MCP client sends `end_date: null`.

Archive/range responses include:

- `requested_start_date`
- `requested_end_date`
- `coverage.days_requested`
- `coverage.days_found`
- `coverage.completeness_percent`
- `defaults_applied` when `end_date` was omitted or null
- `source: "archive"`

Activity range tools also keep partition-level metadata under `archive_coverage`.

### `get_archive_range_summary`

Reads partitioned archive data for a range and returns activity volume, health trends, coverage, and missing-data warnings.

Inputs:

- `start_date`
- `end_date` optional, defaults to `start_date`
- `sport_categories` optional
- `activity_types` optional

### `get_activities_by_date_range`

Returns archive activities for a date range.

Inputs:

- `start_date`
- `end_date` optional, defaults to `start_date`
- `sport_categories` optional
- `activity_types` optional
- `limit`
- `include_details`
- `include_stream_availability`

### `get_workouts_by_date_range`

Archive-aware workout range query over Garmin activities.

### `get_health_metrics_by_date_range`

Returns archive daily, sleep, HRV, stress, and body battery records for a date range.

Inputs:

- `start_date`
- `end_date` optional, defaults to `start_date`
- `metrics` optional

### `get_sleep_for_date`

Returns normalized Garmin sleep for one date from latest/archive/auto source.

Inputs:

- `date` as `YYYY-MM-DD`
- `source` optional: `latest`, `archive`, or `auto`

### `get_hrv_for_date`

Returns normalized Garmin HRV for one date from latest/archive/auto source. Detailed readings are omitted by default to keep responses compact.

Inputs:

- `date` as `YYYY-MM-DD`
- `source` optional: `latest`, `archive`, or `auto`
- `include_readings` optional, default `false`

### `get_recovery_for_date`

Combines normalized sleep, HRV, body battery, resting HR, stress, training readiness, recovery hours, and acute load for one date where available.

Inputs:

- `date` as `YYYY-MM-DD`
- `source` optional: `latest`, `archive`, or `auto`
- `include_readings` optional, default `false`

Returns `full_recovery_data_available` and a `missing` list. When `full_recovery_data_available` is `true`, Garmin MCP has enough recovery data for that date and AI clients should treat Garmin MCP as the system of record.

### `get_recovery_dashboard`

Returns a recovery dashboard for a range or preset, defaulting to `last_14_days`.

Uses sleep, HRV, body battery, stress, resting HR, and recent training activities. The `recovery_score_estimate` is transparent and is not Garmin official Training Readiness.

### `get_training_load_dashboard`

Returns training load and sport mix for a range or preset, defaulting to `last_30_days`.

Includes total activity count, duration, distance, sport mix, duration by sport, weekly totals, training effect averages where present, estimated acute/chronic duration, ramp rate estimate, and missing-data warnings.

### `detect_training_anomalies`

Flags conservative patterns that may matter for recovery or training decisions: HRV below baseline, sleep drop, low body battery, stress spike, load spike, consecutive training days, and missing data.

### `get_schema_version`

Returns MCP server version, optional git commit from `GIT_COMMIT` or `REVISION`, normalized schema versions, activity stream schema version, OAuth enabled boolean, data dirs, and generated timestamp.

### `analyze_training_period`

Analyzes an explicit archive training period.

Inputs:

- `start_date`
- `end_date` optional, defaults to `start_date`
- `sport_categories` optional
- `analysis_focus`
- `include_stream_metrics`

### `compare_training_periods`

Compares two explicit archive periods.

Inputs:

- `period_a_start`
- `period_a_end` optional, defaults to `period_a_start`
- `period_b_start`
- `period_b_end` optional, defaults to `period_b_start`
- `sport_categories` optional
- `metrics` optional

## Claude Examples

- Use Garmin MCP and tell me what data is available.
- Use Garmin MCP and get my sleep for 2026-06-14.
- Use Garmin MCP and get my HRV for 2026-06-14.
- Use Garmin MCP and get my recovery for 2026-06-14.
- For date range tools, `end_date` is optional and defaults to `start_date`.
- Use Garmin MCP and audit data quality for the last 90 days.
- Use Garmin MCP and show my recovery dashboard for last_14_days.
- Use Garmin MCP and detect training anomalies for last_30_days.

## ChatGPT Examples

- First call `get_data_capabilities` and `get_system_status`, then analyze my latest ride using Garmin data only.
- Use Garmin MCP and show which tool I should use to analyze my latest ride.
- Use Garmin MCP to compare my cycling volume from 2026-05-01 to 2026-05-31 against 2026-06-01 to 2026-06-15.
- Use Garmin MCP to check whether full streams are available before analyzing cadence, heart rate, speed, or power.
- Use Garmin MCP and show my training load dashboard for last_30_days.

## MCP Inspector Examples

List tools, then call:

```json
{
  "name": "get_data_capabilities",
  "arguments": {}
}
```

System status query:

```json
{
  "name": "get_system_status",
  "arguments": {}
}
```

Single-day health query:

```json
{
  "name": "get_health_metrics_by_date_range",
  "arguments": {
    "start_date": "2026-06-14",
    "end_date": null,
    "metrics": ["sleep", "hrv"]
  }
}
```

Stream completeness query:

```json
{
  "name": "get_activity_streams",
  "arguments": {
    "activity_id": "your-activity-id",
    "source": "auto",
    "downsample": false
  }
}
```

## Source and Completeness

`latest` is the fast recent dataset used by daily sync. `archive` is the partitioned historical dataset used for long-range backfill. Tools include `source` or `sources_used` so clients do not need to infer where data came from.

## Error Envelope

Structured tool errors include:

- `error: true`
- `error_code`
- `message`
- `param` when a parameter caused the error
- `received`
- `valid_values` or `hint`

Common `error_code` values:

- `INVALID_FIELD_NAME`
- `NO_DATA_FOR_RANGE`

Stream tools include:

- `streams_available`
- `stream_sample_count`
- `full_data_available`
- `partial_stream`
- `available_streams`
- `missing_streams`

AI clients should not fall back to Strava or other services just because a field is missing. They should report missing Garmin fields and, when useful, ask the user to run sync/backfill with activity streams enabled.

## Sync and Health

### `sync_now`

Starts an authenticated background sync.

Inputs:

- `days`
- `force_login`
- `force_refresh`
- `activity_streams`
- `include_raw`

Successful sync means the command completed and wrote normalized JSON. Complete sync means the latest files include daily, sleep, HRV, stress, body battery, activities, details, and streams where Garmin exposes them. `force_refresh: true` asks the sync job to refresh all health datasets, activity summaries, details, streams, and raw payloads instead of relying on existing local assumptions.

### `get_sync_status`

Returns latest sync status and running lock state.

The status includes:

- `sync_completeness`
- `latest_available_dates`
- `stale_dataset_warnings`
- `sync_health_score`
- `activity_stream_coverage`

### `get_sync_completeness`

Returns current sync completeness diagnostics from latest files and status metadata.

### `get_dataset_status`

Returns latest date and record count for daily, sleep, HRV, stress, body battery, and activities.

## Sync Completeness Definitions

Daily is complete when latest sync has daily summary fields such as steps, calories, intensity minutes, and resting heart rate.

Recovery is complete when sleep score, duration, stages, naps, sleep need/alignment, breathing disruption, overnight respiration, overnight SpO2, overnight stress, and body battery change are normalized when Garmin provides them.

HRV is complete when overnight HRV, status, baseline-related values, readings, and weekly HRV are normalized when Garmin provides them.

A stale dataset is sleep or HRV trailing the daily dataset by more than one day. Stale datasets appear in `stale_dataset_warnings`.

Recovery readiness is exposed by `get_recovery_for_date.full_recovery_data_available`. If false, inspect `missing` before giving recovery advice.

### `health_check`

Returns server status, latest data timestamp, available date range, sync status, and latest activity ID.
