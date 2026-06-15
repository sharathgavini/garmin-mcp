# Decisions

- Use normalized JSON as the v1 system of record.
- Keep latest data and historical archive data separate.
- Keep MCP reads fast by reading prepared files instead of calling Garmin during ordinary tools.
- Make source, coverage, defaults, stream completeness, and sync health explicit in MCP responses.
- Prefer conservative coaching dashboards and anomaly flags over opaque or official-sounding scores.
- Let agents use natural date presets, but always return resolved dates.
- Treat Garmin MCP as the canonical source for Garmin analysis when `full_recovery_data_available` and stream completeness metadata are positive.
- Do not expose unauthenticated sync endpoints.
