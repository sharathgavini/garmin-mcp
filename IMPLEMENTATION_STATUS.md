# Implementation Status

Current core capabilities:

- Real Garmin sync with encrypted session reuse
- Latest normalized JSON under `/app/data/latest`
- Historical archive partitions under `/app/data/archive`
- Activity details and activity streams when sync/backfill is run with those options
- OAuth and bearer-token protected MCP HTTP server
- Agent-facing data capability discovery through `get_data_capabilities`
- Agent-facing health/freshness diagnostics through `get_system_status`
- Nullable/optional date-range `end_date` schemas for single-day queries
- Single-date sleep, HRV, and recovery tools

Current deployment preference:

- Manual TrueNAS deployment behind the existing Cloudflare Tunnel
- Cloud Run/GCS support remains in the repo but is not the primary deployment path
