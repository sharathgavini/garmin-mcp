# Changelog

## Unreleased

- Added richer range coverage metadata with missing dates and available bounds.
- Added nested capability discovery fields for history, datasets, streams, sports, archive statistics, and last sync.
- Added `get_system_status` for agent-facing sync, archive, dataset, auth, and warning diagnostics.
- Added `partial_stream` metadata to stream completeness responses.
- Documented the recommended `get_data_capabilities` then `get_system_status` agent workflow.
- Added `get_tool_guide`, `audit_data_quality`, `get_metric_inventory`, `get_recovery_dashboard`, `get_training_load_dashboard`, `detect_training_anomalies`, and `get_schema_version`.
- Added natural date-range presets for range-oriented MCP tools.
- Added targeted `sync.repair_activity_details` CLI and MCP repair status exposure.
- Added structured `INVALID_FIELD_NAME` and `NO_DATA_FOR_RANGE` responses plus stream field aliases.
- Added incremental `sync.sync_now` wrapper with sync state, cooldown-light runs, lookback windows, and per-dataset watermark status.
- Documented null `end_date` defaulting to `start_date` for single-day range safety.
- Added `resolution_seconds` stream decimation for lightweight workout overview queries.
- Added archive partition manifests, weekly/monthly rollups, field projection, and cheap capability metadata from archive indexes.
