# OAuth Setup

This server supports a minimal single-user OAuth flow for remote MCP clients such as ChatGPT or Claude. This is not Garmin OAuth. It only authenticates your MCP clients to your private Garmin MCP server.

Existing static bearer auth still works through `MCP_BEARER_TOKEN`.

## Environment

Add these to `.env.selfhost`:

```env
OAUTH_ISSUER=https://garmin.sharathgavini.com
OAUTH_ADMIN_PASSWORD=...
OAUTH_TOKEN_TTL_SECONDS=2592000
MCP_BEARER_TOKEN=...
```

Generate an admin password:

```bash
python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(32))
PY
```

Restart the container:

```bash
docker compose --env-file .env.selfhost up -d --build
```

## Metadata

Test authorization server metadata:

```bash
curl https://garmin.sharathgavini.com/.well-known/oauth-authorization-server
```

Test protected resource metadata:

```bash
curl https://garmin.sharathgavini.com/.well-known/oauth-protected-resource
```

## Dynamic Client Registration

Remote MCP clients may register themselves. You can test registration manually:

```bash
curl -X POST https://garmin.sharathgavini.com/oauth/register \
  -H "Content-Type: application/json" \
  -d '{"redirect_uris":["https://example.com/callback"],"grant_types":["authorization_code"],"response_types":["code"],"token_endpoint_auth_method":"none"}'
```

The response includes `client_id`. Public PKCE clients can use `token_endpoint_auth_method: "none"`.

## Authorization

The authorization endpoint is:

```text
https://garmin.sharathgavini.com/oauth/authorize
```

It requires:

- `response_type=code`
- `client_id`
- `redirect_uri`
- `state`
- `code_challenge`
- `code_challenge_method=S256`

Approval shows a small password form. Use `OAUTH_ADMIN_PASSWORD` to approve. Authorization codes expire after 5 minutes and are single-use.

## Token Exchange

The token endpoint is:

```text
https://garmin.sharathgavini.com/oauth/token
```

It supports only:

```text
grant_type=authorization_code
```

Access tokens last 30 days by default and are stored in:

```text
/app/secrets/oauth-tokens.json
```

## Test Static Bearer Auth

The old auth path remains supported:

```bash
curl -X POST https://garmin.sharathgavini.com/mcp \
  -H "Authorization: Bearer $MCP_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## Rotate OAuth Tokens

Delete the token store and restart or let clients reauthorize:

```bash
docker exec garmin-mcp rm -f /app/secrets/oauth-tokens.json
```

Registered clients remain in:

```text
/app/secrets/oauth-clients.json
```

## Security Notes

- `/healthz` remains public.
- `/mcp` accepts either `MCP_BEARER_TOKEN` or an OAuth access token issued by this server.
- OAuth is single-user and requires `OAUTH_ADMIN_PASSWORD` for approval.
- PKCE S256 is required.
- Unknown redirect URIs are rejected.
- Authorization codes are single-use and short-lived.
- Do not expose `/app/secrets`.
