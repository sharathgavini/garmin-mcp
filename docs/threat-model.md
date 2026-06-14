# Threat Model

## Assets

- Garmin credentials and session tokens.
- Prepared Garmin fitness JSON.
- MCP bearer token.
- Google Cloud credentials.

## Boundaries

- GitHub Actions sync can access Garmin credentials.
- Cloud Run MCP server cannot access Garmin credentials.
- Cloud Run only reads prepared JSON from GCS.
- ChatGPT reaches Cloud Run over HTTPS through `/mcp`.

## Controls

- `MCP_BEARER_TOKEN` is required for `/mcp`.
- Garmin secrets are stored only as GitHub secrets.
- Garmin session tokens are cached only as AES-256-GCM encrypted `.garmin-session.enc` data.
- Prefer Google Workload Identity Federation over long-lived service account JSON.
- Logs should not include Garmin email, cookies, tokens, authorization headers, or raw secrets.
- JSON is compact and inspectable, avoiding a database for v1.

## Accepted v1 Risks

- One bearer token protects the MCP endpoint.
- No per-tool audit trail.
- No complex rate limiter beyond small request body limits and Cloud Run scaling controls.
- Service account JSON is supported as a fallback when WIF is not yet configured.
