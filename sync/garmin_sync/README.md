# Garmin Sync Helpers

This package contains smaller helper modules used by the Python sync CLIs.

## Files

- `normalizers.py` - converts Garmin payloads into stable JSON records for MCP tools.
- `write_json.py` - writes JSON files with parent directory creation.
- `upload_gcs.py` - compatibility wrapper for upload code.

## Development Notes

- Normalizers should tolerate missing or unexpected Garmin fields.
- Do not log secrets.
- Preserve raw payloads outside the normalizers so schemas can evolve later.
