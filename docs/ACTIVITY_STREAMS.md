# Activity Streams

Garmin MCP stores Garmin as the canonical source of truth. Daily sync and historical backfill preserve both normalized MCP-friendly files and raw Garmin payloads.

Activity stream files live at:

```text
/app/data/latest/activity_streams/{activity_id}.json
/app/data/archive/activity_streams/{activity_id}.json
```

Each file stores full time-series samples when Garmin provides them: heart rate, cadence, speed, power, elevation, distance, GPS, temperature, laps, and splits. Missing fields are recorded in the `availability` block instead of being invented.

Daily full sync:

```bash
docker exec garmin-mcp python -m sync.main \
  --days 30 \
  --output /app/data/latest \
  --include-raw true \
  --activity-details true \
  --activity-streams true
```

Use `get_activity_streams`, `get_latest_workout_streams`, or `get_latest_ride_streams` for full stream retrieval. Streams are not downsampled unless `downsample=true` is requested.

## Extraction Diagnostics

Stream files now include:

- `extraction_status`
- `checked_payloads`
- `availability.partial_stream`
- `availability.recommendation`

If a stream file has `sample_count=0`, run:

```bash
docker exec garmin-mcp python -m sync.inspect_activity \
  --activity-id ACTIVITY_ID \
  --output /app/data/debug
```

See [DEBUG_GARMIN_ACTIVITY.md](DEBUG_GARMIN_ACTIVITY.md).
