# Next Steps

Recommended next validation steps:

1. Run a fresh TrueNAS sync into `/app/data/latest`.
2. Call `get_data_capabilities` from ChatGPT or Claude.
3. Call `get_system_status` and resolve any warnings.
4. Run `audit_data_quality` for `last_90_days`.
5. If `activity_details` are missing, run `docker exec garmin-mcp python -m sync.repair_activity_details --start-date 2026-03-18 --end-date 2026-06-14 --output /app/data/archive --sleep-seconds 1`.
6. Verify `get_recovery_for_date` reports `full_recovery_data_available: true` for the latest completed sleep date.
7. Validate `get_recovery_dashboard`, `get_training_load_dashboard`, and `detect_training_anomalies`.
8. Run historical backfill with activity details and streams enabled if archive stream coverage is incomplete.

Useful commands:

```bash
docker exec garmin-mcp python -m sync.main --days 30 --output /app/data/latest --include-raw true --activity-details true --activity-streams true
docker exec garmin-mcp python -m sync.backfill --start-date 2025-10-01 --end-date 2026-06-14 --output /app/data/archive --include-raw true --activity-details true --activity-streams true
```
