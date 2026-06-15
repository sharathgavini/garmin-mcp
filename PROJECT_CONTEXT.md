# Project Context

Garmin MCP is a self-hosted Garmin data system for ChatGPT, Claude, and other MCP clients.

The intended production setup is TrueNAS with persistent bind mounts:

- `/app/data/latest` for fast current MCP reads
- `/app/data/archive` for historical partitions
- `/app/secrets/.garmin-session.enc` for encrypted Garmin session reuse

The MCP server reads normalized JSON. It does not call Garmin for ordinary read tools. Garmin API access happens through Python sync/backfill commands and authenticated `sync_now`.

Agent clients should start with `get_tool_guide` when routing is unclear, call `get_data_capabilities`, then call `get_system_status` and `audit_data_quality` when data freshness or completeness matters.

Range tools support natural presets such as `last_14_days`, `last_30_days`, and `last_90_days`. Coaching-ready summaries are exposed through `get_recovery_dashboard`, `get_training_load_dashboard`, and `detect_training_anomalies`.

If archive activity streams are healthy but activity details are missing, use `python -m sync.repair_activity_details` instead of rerunning full historical backfill.

Authenticated MCP `sync_now` launches `python -m sync.sync_now`, which is incremental by default and records watermarks in `/app/data/archive/sync_state.json`.
