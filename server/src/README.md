# Server Source

This directory is the TypeScript source for the MCP server.

## File Map

- `index.ts` - process entrypoint.
- `app.ts` - Express application, auth checks, OAuth routes, MCP transport, and tool registration.
- `tools.ts` - all MCP input schemas and tool handlers.
- `data.ts` - local file reader and GCS reader.
- `date.ts` - date helpers.
- `oauth.ts` - single-user OAuth implementation.
- `sports.ts` - sport classification.
- `workouts.ts` - workout filtering, stream shaping, and analysis helpers.
- `syncNow.ts` - authenticated background sync trigger.
- `types.ts` - shared TypeScript types.

## Development Notes

- Add new MCP tools in `tools.ts`.
- Add tool descriptions in `app.ts`.
- Add data-access methods in `data.ts` and `types.ts`.
- Keep latest-data tools and archive-data tools separate.
- Keep full streams unless a caller explicitly requests field filtering or downsampling.
