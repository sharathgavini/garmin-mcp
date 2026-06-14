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

Sport categories are normalized to cycling, running, walking, badminton, strength, mobility, or other. Ride tools filter to cycling so a newer walk or mobility session does not hide the latest ride.

`analyze_activity` returns summary data, stream availability, HR distribution, HR drift, stop/start count, cadence consistency, speed consistency, warmup/cooldown signals, recovery load estimate, power/HR relation when power exists, laps/splits, and a `raw_stream_reference` pointing back to `get_activity_streams`.

Example prompts:

```text
Use Garmin MCP and get my latest workout summary.
Use Garmin MCP and get my latest ride streams.
Use Garmin MCP and analyze my latest badminton session.
Use Garmin MCP, sync now with activity streams, then analyze my latest workout.
```
