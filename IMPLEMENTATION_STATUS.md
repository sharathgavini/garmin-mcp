# Implementation Status

Current core capabilities:

- Real Garmin sync with encrypted session reuse
- Latest normalized JSON under `/app/data/latest`
- Historical archive partitions under `/app/data/archive`
- Activity details and activity streams when sync/backfill is run with those options
- OAuth and bearer-token protected MCP HTTP server
- Agent-facing data capability discovery through `get_data_capabilities`
- Agent-facing health/freshness diagnostics through `get_system_status`
- Agent tool routing through `get_tool_guide`
- Local data-quality auditing through `audit_data_quality`
- Field inventory through `get_metric_inventory`
- Recovery and training-load dashboards
- Conservative anomaly detection
- Natural date presets on range-oriented tools
- Targeted archive activity-detail repair via `python -m sync.repair_activity_details`
- Structured stream field errors and aliases for `get_activity_streams`
- Incremental `sync_now` wrapper via `python -m sync.sync_now` with cooldown, lookback, sync state, and watermark status
- Archive partition manifests and weekly/monthly rollups via `python -m sync.archive_maintenance`
- Field projection on archive range and health tools
- Manifest-backed per-dataset capability discovery through `get_data_capabilities.datasets`
- Normalized `schema_version` fields plus version-gated `sync.renormalize --since-version`
- Retry/backoff around Garmin API reads in sync and backfill paths
- Resumable activity-detail repair using `activity_detail_repair_status.json`
- Validation guardrails on normalized latest, archive, detail, and stream writes with `validation_rejections.json`
- Canonical unit and timezone metadata on normalized rows and archive rollups
- Garmin-preferred source rules for duplicate external activity metrics
- Nullable/optional date-range `end_date` schemas for single-day queries
- Single-date sleep, HRV, and recovery tools

Part 5 incremental `sync_now` is wired into Part 4 maintenance: delta runs write `sync_checkpoint.json`, update `partition_manifest.json`, run manifest verification, and rely on the same schema-versioned normalized rows that full sync/backfill writes.

Current deployment preference:

- Manual TrueNAS deployment behind the existing Cloudflare Tunnel
- Cloud Run/GCS support remains in the repo but is not the primary deployment path
