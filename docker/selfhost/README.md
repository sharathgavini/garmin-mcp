# Self-Hosted Docker Runtime

This directory contains scripts copied into the self-hosted Docker image.

## Files

- `entrypoint.sh` - starts scheduled sync and the MCP server.
- `run-sync.sh` - runs the latest Garmin sync with raw payloads, activity details, and activity streams enabled.
- `crontab` - supercronic schedule. Default is daily at 6 AM container time.

## Manual Sync

```bash
docker exec garmin-mcp python -m sync.main --days 30 --output /app/data/latest --include-raw true --activity-details true --activity-streams true
```
