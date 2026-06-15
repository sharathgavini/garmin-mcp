# Project Context

Garmin MCP is a self-hosted Garmin data system for ChatGPT, Claude, and other MCP clients.

The intended production setup is TrueNAS with persistent bind mounts:

- `/app/data/latest` for fast current MCP reads
- `/app/data/archive` for historical partitions
- `/app/secrets/.garmin-session.enc` for encrypted Garmin session reuse

The MCP server reads normalized JSON. It does not call Garmin for ordinary read tools. Garmin API access happens through Python sync/backfill commands and authenticated `sync_now`.

Agent clients should start with `get_data_capabilities`, then call `get_system_status` when data freshness or completeness matters.
