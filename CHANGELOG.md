# Changelog

## Unreleased

- Added richer range coverage metadata with missing dates and available bounds.
- Added nested capability discovery fields for history, datasets, streams, sports, archive statistics, and last sync.
- Added `get_system_status` for agent-facing sync, archive, dataset, auth, and warning diagnostics.
- Added `partial_stream` metadata to stream completeness responses.
- Documented the recommended `get_data_capabilities` then `get_system_status` agent workflow.
- Added `get_tool_guide`, `audit_data_quality`, `get_metric_inventory`, `get_recovery_dashboard`, `get_training_load_dashboard`, `detect_training_anomalies`, and `get_schema_version`.
- Added natural date-range presets for range-oriented MCP tools.
