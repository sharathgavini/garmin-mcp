# Workout Analysis

Garmin MCP exposes Garmin-native workout tools so remote clients do not need another activity source for detailed analysis.

Core tools:

- `get_latest_workout`
- `get_latest_workout_summary`
- `get_latest_workout_streams`
- `get_activity_streams`
- `analyze_activity`
- `analyze_latest_workout`
- `get_latest_ride`
- `get_latest_ride_summary`
- `get_latest_ride_streams`
- `get_activities_by_date_range`
- `get_workouts_by_date_range`
- `analyze_training_period`
- `compare_training_periods`
- `get_training_load_dashboard`
- `detect_training_anomalies`
- `get_tool_guide`

Sport categories are normalized to cycling, running, walking, badminton, strength, mobility, or other. Ride tools filter to cycling so a newer walk or mobility session does not hide the latest ride.

`analyze_activity` returns summary data, stream availability, HR distribution, HR drift, stop/start count, cadence consistency, speed consistency, warmup/cooldown signals, recovery load estimate, power/HR relation when power exists, laps/splits, and a `raw_stream_reference` pointing back to `get_activity_streams`.

If stream output is empty or partial, the MCP response includes extraction status, checked payloads when available, missing fields, and a recommendation to run `sync.inspect_activity`.

Canonical stream field names include `heart_rate`, `cadence`, `speed_mps`, `power_watts`, `altitude_m`, `distance_m`, `latitude`, `longitude`, and `temperature`. Accepted aliases include `speed` -> `speed_mps`, `altitude`/`elevation` -> `altitude_m`, and `distance` -> `distance_m`. Invalid field names return `INVALID_FIELD_NAME` with valid values.

For overview queries, pass `resolution_seconds` to `get_activity_streams`, `get_latest_workout_streams`, or `get_latest_ride_streams`. This keeps roughly one sample per N seconds and preserves first/last samples. Leave it unset for full-resolution streams.

For cycling cadence and pedaling analysis, pass `pedaling_only: true` to `get_activity_streams`. This drops samples whose cadence is zero or below `min_cadence_rpm` so coasting does not dilute sustained-pedaling stats. The default threshold is 30 rpm. Filtering happens before `resolution_seconds` decimation, and entire samples are removed by index so heart rate, speed, power, distance, and timestamps stay aligned.

For archive range tools, pass `fields` to project only the columns needed for the answer. Omitting `fields` returns the full existing response shape.

If activity details are missing but activity streams exist, run targeted repair:

```bash
docker exec garmin-mcp python -m sync.repair_activity_details \
  --start-date 2026-03-18 \
  --end-date 2026-06-14 \
  --output /app/data/archive \
  --sleep-seconds 1
```

For coaching summaries, use `get_training_load_dashboard` before writing advice. It reports sport mix, weekly totals, acute/chronic duration estimates, ramp rate estimate, and missing-data warnings. Use `detect_training_anomalies` for conservative flags such as load spikes, too many consecutive training days, poor recovery before hard efforts, or missing data.

Example prompts:

```text
Use Garmin MCP and get my latest workout summary.
Use Garmin MCP and get my latest ride streams.
Use Garmin MCP and analyze my latest badminton session.
Use Garmin MCP, sync now with activity streams, then analyze my latest workout.
Use Garmin MCP and summarize my last 3 months of training from the archive.
Use Garmin MCP and get all road biking activities between 2025-10-01 and 2026-06-14.
Use Garmin MCP and compare my cycling volume in May vs June.
Use Garmin MCP and show my HRV trend from October 2025 to today.
Use Garmin MCP and analyze my training period from 2026-05-01 to 2026-06-14.
Use Garmin MCP and show my training load dashboard for last_30_days.
Use Garmin MCP and detect training anomalies for last_30_days.
Use Garmin MCP and show which tool I should use to analyze my latest ride.
```
