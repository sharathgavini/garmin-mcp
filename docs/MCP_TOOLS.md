# MCP Tool Catalog

This file lists every MCP tool currently registered by the server.

## Latest and Recent Data

### `get_today_summary`

Returns the daily Garmin summary for one date from latest data.

Inputs:

- `date` optional `YYYY-MM-DD`

### `get_range_summary`

Returns compact recent sleep, HRV, stress, body battery, activity, and recovery trends from latest data.

Use archive tools for long historical ranges.

Inputs:

- `start_date`
- `end_date`

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

- Use Garmin MCP and get my sleep for 2026-06-14.
- Use Garmin MCP and get my HRV for 2026-06-14.
- Use Garmin MCP and get my recovery for 2026-06-14.
- For date range tools, `end_date` is optional and defaults to `start_date`.

## Sync and Health

### `sync_now`

Starts an authenticated background sync.

Inputs:

- `days`
- `force_login`
- `activity_streams`
- `include_raw`

### `get_sync_status`

Returns latest sync status and running lock state.

### `health_check`

Returns server status, latest data timestamp, available date range, sync status, and latest activity ID.
