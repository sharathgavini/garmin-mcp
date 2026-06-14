# Sample Data

This directory contains redacted Garmin-like JSON fixtures for local server development and tests.

## Purpose

- Run the MCP server without real Garmin credentials.
- Test latest activity tools.
- Test activity stream tools.
- Test ride selection and workout analysis.

## Run Server With Sample Data

```bash
cd server
GARMIN_DATA_MODE=local GARMIN_DATA_DIR=../sample-data MCP_BEARER_TOKEN=dev-token npm run dev
```

## Contents

- `daily.json`, `sleep.json`, `hrv.json`, `stress.json`, `body_battery.json` - latest health fixtures.
- `activities.json` - latest activity summaries.
- `activity_details/` - per-activity detail fixtures.
- `activity_streams/` - per-activity stream fixtures.
- `latest_sync_status.json` - latest sync status fixture.
- `manifest.json` - sample latest manifest.
