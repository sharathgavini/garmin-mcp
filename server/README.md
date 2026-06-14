# Server Directory

This directory contains the TypeScript MCP HTTP server.

## What It Does

- Serves `GET /healthz`.
- Serves authenticated MCP requests at `POST /mcp`.
- Supports bearer token auth and single-user OAuth.
- Reads Garmin JSON from local disk or GCS.
- Registers all MCP tools.
- Implements workout, stream, archive, and sync status logic.

## Important Files

- `src/index.ts` - starts the HTTP server.
- `src/app.ts` - builds the Express app, installs auth, and registers MCP tools.
- `src/tools.ts` - schemas and handlers for every MCP tool.
- `src/data.ts` - local and GCS data readers.
- `src/oauth.ts` - OAuth metadata, registration, authorization, token issuing, and token validation.
- `src/workouts.ts` - workout filtering, stream shaping, and analysis helpers.
- `src/syncNow.ts` - background sync tool implementation.
- `src/sports.ts` - Garmin activity type to sport category mapping.
- `tests/` - Node tests for tools and OAuth.

## Commands

Install dependencies:

```bash
npm install
```

Run tests:

```bash
npm test
```

Run locally with sample data:

```bash
GARMIN_DATA_MODE=local GARMIN_DATA_DIR=../sample-data MCP_BEARER_TOKEN=dev-token npm run dev
```

Check health:

```bash
curl http://localhost:3000/healthz
```
