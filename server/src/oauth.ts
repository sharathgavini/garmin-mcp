import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import express from "express";

type JsonRecord = Record<string, unknown>;

interface OAuthClient {
  client_id: string;
  client_secret?: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  created_at: string;
}

interface AuthorizationCode {
  code: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  expires_at: string;
  used: boolean;
}

interface AccessToken {
  token: string;
  client_id: string;
  expires_at: string;
  scope: string;
}

const CLIENTS_FILE = "oauth-clients.json";
const CODES_FILE = "oauth-codes.json";
const TOKENS_FILE = "oauth-tokens.json";

export class OAuthStore {
  constructor(private readonly secretsDir = process.env.OAUTH_SECRETS_DIR ?? "/app/secrets") {}

  async readClients(): Promise<OAuthClient[]> {
    return this.readArray<OAuthClient>(CLIENTS_FILE);
  }

  async writeClients(clients: OAuthClient[]): Promise<void> {
    await this.writeJson(CLIENTS_FILE, clients);
  }

  async readCodes(): Promise<AuthorizationCode[]> {
    return this.readArray<AuthorizationCode>(CODES_FILE);
  }

  async writeCodes(codes: AuthorizationCode[]): Promise<void> {
    await this.writeJson(CODES_FILE, codes);
  }

  async readTokens(): Promise<AccessToken[]> {
    return this.readArray<AccessToken>(TOKENS_FILE);
  }

  async writeTokens(tokens: AccessToken[]): Promise<void> {
    await this.writeJson(TOKENS_FILE, tokens);
  }

  private async readArray<T>(file: string): Promise<T[]> {
    try {
      const raw = await fs.readFile(path.join(this.secretsDir, file), "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }

  private async writeJson(file: string, value: unknown): Promise<void> {
    await fs.mkdir(this.secretsDir, { recursive: true, mode: 0o700 });
    const target = path.join(this.secretsDir, file);
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temp, target);
    try {
      await fs.chmod(target, 0o600);
    } catch {
      // chmod can fail on some mounted filesystems; the file still remains usable.
    }
  }
}

export class OAuthService {
  constructor(
    private readonly store = new OAuthStore(),
    private readonly issuer = process.env.OAUTH_ISSUER ?? "http://localhost:3000",
    private readonly tokenTtlSeconds = Number(process.env.OAUTH_TOKEN_TTL_SECONDS ?? 2592000)
  ) {}

  metadata(): JsonRecord {
    return {
      issuer: this.issuer,
      authorization_endpoint: `${this.issuer}/oauth/authorize`,
      token_endpoint: `${this.issuer}/oauth/token`,
      registration_endpoint: `${this.issuer}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post"]
    };
  }

  protectedResourceMetadata(): JsonRecord {
    return {
      resource: this.issuer,
      authorization_servers: [this.issuer],
      bearer_methods_supported: ["header"],
      scopes_supported: ["mcp"]
    };
  }

  async registerClient(input: JsonRecord): Promise<OAuthClient> {
    const redirectUris = Array.isArray(input.redirect_uris) ? input.redirect_uris.filter(isString) : [];
    if (redirectUris.length === 0) {
      throw oauthError(400, "invalid_client_metadata");
    }

    const grantTypes = arrayOrDefault(input.grant_types, ["authorization_code"]);
    const responseTypes = arrayOrDefault(input.response_types, ["code"]);
    if (!grantTypes.includes("authorization_code") || !responseTypes.includes("code")) {
      throw oauthError(400, "invalid_client_metadata");
    }

    const tokenEndpointAuthMethod = isString(input.token_endpoint_auth_method)
      ? input.token_endpoint_auth_method
      : "none";
    if (!["none", "client_secret_post"].includes(tokenEndpointAuthMethod)) {
      throw oauthError(400, "invalid_client_metadata");
    }

    const client: OAuthClient = {
      client_id: randomToken(24),
      redirect_uris: redirectUris,
      grant_types: grantTypes,
      response_types: responseTypes,
      token_endpoint_auth_method: tokenEndpointAuthMethod,
      created_at: new Date().toISOString()
    };
    if (tokenEndpointAuthMethod === "client_secret_post") {
      client.client_secret = randomToken(32);
    }

    const clients = await this.store.readClients();
    clients.push(client);
    await this.store.writeClients(clients);
    return client;
  }

  async getClient(clientId: string): Promise<OAuthClient | null> {
    const clients = await this.store.readClients();
    return clients.find((client) => client.client_id === clientId) ?? null;
  }

  async createAuthorizationCode(input: {
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
  }): Promise<string> {
    const code = randomToken(32);
    const codes = await this.store.readCodes();
    codes.push({
      code,
      client_id: input.clientId,
      redirect_uri: input.redirectUri,
      code_challenge: input.codeChallenge,
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      used: false
    });
    await this.store.writeCodes(codes);
    return code;
  }

  async exchangeCode(input: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<{ access_token: string; token_type: "Bearer"; expires_in: number; scope: "mcp" }> {
    const codes = await this.store.readCodes();
    const codeRecord = codes.find((candidate) => candidate.code === input.code);
    if (!codeRecord || codeRecord.used || new Date(codeRecord.expires_at).getTime() <= Date.now()) {
      throw oauthError(400, "invalid_grant");
    }
    if (codeRecord.client_id !== input.clientId || codeRecord.redirect_uri !== input.redirectUri) {
      throw oauthError(400, "invalid_grant");
    }
    if (pkceChallenge(input.codeVerifier) !== codeRecord.code_challenge) {
      throw oauthError(400, "invalid_grant");
    }

    codeRecord.used = true;
    await this.store.writeCodes(codes);

    const token = randomToken(32);
    const tokens = await this.store.readTokens();
    tokens.push({
      token,
      client_id: input.clientId,
      expires_at: new Date(Date.now() + this.tokenTtlSeconds * 1000).toISOString(),
      scope: "mcp"
    });
    await this.store.writeTokens(tokens);
    return {
      access_token: token,
      token_type: "Bearer",
      expires_in: this.tokenTtlSeconds,
      scope: "mcp"
    };
  }

  async isValidAccessToken(token: string): Promise<boolean> {
    const tokens = await this.store.readTokens();
    return tokens.some((candidate) => candidate.token === token && new Date(candidate.expires_at).getTime() > Date.now());
  }
}

export function installOAuthRoutes(app: express.Express, oauth: OAuthService): void {
  app.get("/.well-known/oauth-authorization-server", (_req, res) => {
    res.json(oauth.metadata());
  });
  app.get("/oauth/metadata", (_req, res) => {
    res.json(oauth.metadata());
  });
  app.get("/.well-known/oauth-protected-resource", (_req, res) => {
    res.json(oauth.protectedResourceMetadata());
  });

  app.post("/oauth/register", async (req, res, next) => {
    try {
      const client = await oauth.registerClient(req.body ?? {});
      res.status(201).json(client);
    } catch (error) {
      next(error);
    }
  });

  app.get("/oauth/authorize", async (req, res, next) => {
    try {
      const params = parseAuthorizeParams(req.query);
      const validation = await validateAuthorizeRequest(oauth, params);
      if (!validation.ok) {
        res.status(400).send("Invalid authorization request.");
        return;
      }
      res.type("html").send(renderApprovalPage(params, Boolean(req.query.failed)));
    } catch (error) {
      next(error);
    }
  });

  app.post("/oauth/authorize", express.urlencoded({ extended: false }), async (req, res, next) => {
    try {
      const params = parseAuthorizeParams(req.body);
      const validation = await validateAuthorizeRequest(oauth, params);
      if (!validation.ok) {
        res.status(400).send("Invalid authorization request.");
        return;
      }
      if (!process.env.OAUTH_ADMIN_PASSWORD || req.body.admin_password !== process.env.OAUTH_ADMIN_PASSWORD) {
        await delay(500);
        res.status(401).type("html").send(renderApprovalPage(params, true));
        return;
      }
      const code = await oauth.createAuthorizationCode({
        clientId: params.client_id,
        redirectUri: params.redirect_uri,
        codeChallenge: params.code_challenge
      });
      const redirectUrl = new URL(params.redirect_uri);
      redirectUrl.searchParams.set("code", code);
      if (params.state) {
        redirectUrl.searchParams.set("state", params.state);
      }
      res.redirect(302, redirectUrl.toString());
    } catch (error) {
      next(error);
    }
  });

  app.post("/oauth/token", express.urlencoded({ extended: false }), async (req, res, next) => {
    try {
      if (req.body.grant_type !== "authorization_code") {
        throw oauthError(400, "unsupported_grant_type");
      }
      const token = await oauth.exchangeCode({
        code: String(req.body.code ?? ""),
        clientId: String(req.body.client_id ?? ""),
        redirectUri: String(req.body.redirect_uri ?? ""),
        codeVerifier: String(req.body.code_verifier ?? "")
      });
      res.json(token);
    } catch (error) {
      next(error);
    }
  });
}

function parseAuthorizeParams(source: JsonRecord): {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  state?: string;
  code_challenge: string;
  code_challenge_method: string;
} {
  return {
    response_type: String(source.response_type ?? ""),
    client_id: String(source.client_id ?? ""),
    redirect_uri: String(source.redirect_uri ?? ""),
    state: source.state === undefined ? undefined : String(source.state),
    code_challenge: String(source.code_challenge ?? ""),
    code_challenge_method: String(source.code_challenge_method ?? "")
  };
}

async function validateAuthorizeRequest(
  oauth: OAuthService,
  params: ReturnType<typeof parseAuthorizeParams>
): Promise<{ ok: boolean }> {
  if (
    params.response_type !== "code" ||
    params.code_challenge_method !== "S256" ||
    !params.code_challenge ||
    !params.client_id ||
    !params.redirect_uri
  ) {
    return { ok: false };
  }
  const client = await oauth.getClient(params.client_id);
  if (!client || !client.redirect_uris.includes(params.redirect_uri)) {
    return { ok: false };
  }
  return { ok: true };
}

function renderApprovalPage(params: ReturnType<typeof parseAuthorizeParams>, failed: boolean): string {
  const hidden = Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(String(value))}">`)
    .join("\n");
  return `<!doctype html>
<html>
<head><title>Approve Garmin MCP</title></head>
<body>
  <h1>Approve Garmin MCP access</h1>
  ${failed ? "<p>Approval failed.</p>" : ""}
  <form method="post" action="/oauth/authorize">
    ${hidden}
    <label>Admin password <input type="password" name="admin_password" autocomplete="current-password"></label>
    <button type="submit">Approve</button>
  </form>
</body>
</html>`;
}

export function pkceChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

function randomToken(bytes: number): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

function arrayOrDefault(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const strings = value.filter(isString);
  return strings.length > 0 ? strings : fallback;
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function oauthError(status: number, error: string): Error & { status?: number; oauthError?: string } {
  const err = new Error("OAuth error") as Error & { status?: number; oauthError?: string };
  err.status = status;
  err.oauthError = error;
  return err;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const escapes: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    };
    return escapes[char];
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
