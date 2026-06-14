import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import request from "supertest";
import { createApp } from "../src/app.js";
import { OAuthService, OAuthStore, pkceChallenge } from "../src/oauth.js";
import { LocalDataReader } from "../src/data.js";

const sampleDir = path.resolve(process.cwd(), "../sample-data");

async function testApp() {
  const secretsDir = await mkdtemp(path.join(os.tmpdir(), "garmin-oauth-"));
  const oauth = new OAuthService(new OAuthStore(secretsDir), "https://garmin.sharathgavini.com", 2592000);
  const app = createApp({
    oauth,
    bearerToken: "static-token",
    reader: new LocalDataReader(sampleDir),
    installAuthProbe: true
  });
  return { app, secretsDir, oauth };
}

async function register(app: Awaited<ReturnType<typeof testApp>>["app"], redirectUri = "https://example.com/callback") {
  const response = await request(app)
    .post("/oauth/register")
    .send({
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none"
    })
    .expect(201);
  return response.body as { client_id: string; redirect_uris: string[] };
}

describe("oauth metadata", () => {
  it("serves authorization server metadata", async () => {
    const { app } = await testApp();
    const response = await request(app).get("/.well-known/oauth-authorization-server").expect(200);

    assert.equal(response.body.issuer, "https://garmin.sharathgavini.com");
    assert.equal(response.body.authorization_endpoint, "https://garmin.sharathgavini.com/oauth/authorize");
    assert.deepEqual(response.body.code_challenge_methods_supported, ["S256"]);
  });
});

describe("dynamic client registration", () => {
  it("registers a public PKCE client", async () => {
    const { app } = await testApp();
    const client = await register(app);

    assert.ok(client.client_id);
    assert.deepEqual(client.redirect_uris, ["https://example.com/callback"]);
  });
});

describe("authorization endpoint", () => {
  it("rejects invalid client", async () => {
    const { app } = await testApp();

    await request(app)
      .get("/oauth/authorize")
      .query({
        response_type: "code",
        client_id: "missing",
        redirect_uri: "https://example.com/callback",
        code_challenge: "challenge",
        code_challenge_method: "S256"
      })
      .expect(400);
  });

  it("rejects invalid redirect uri", async () => {
    const { app } = await testApp();
    const client = await register(app);

    await request(app)
      .get("/oauth/authorize")
      .query({
        response_type: "code",
        client_id: client.client_id,
        redirect_uri: "https://evil.example/callback",
        code_challenge: "challenge",
        code_challenge_method: "S256"
      })
      .expect(400);
  });

  it("requires admin password before approval", async () => {
    const previous = process.env.OAUTH_ADMIN_PASSWORD;
    process.env.OAUTH_ADMIN_PASSWORD = "correct-password";
    try {
      const { app } = await testApp();
      const client = await register(app);

      await request(app)
        .post("/oauth/authorize")
        .type("form")
        .send({
          response_type: "code",
          client_id: client.client_id,
          redirect_uri: "https://example.com/callback",
          code_challenge: "challenge",
          code_challenge_method: "S256",
          admin_password: "wrong-password"
        })
        .expect(401);
    } finally {
      if (previous === undefined) {
        delete process.env.OAUTH_ADMIN_PASSWORD;
      } else {
        process.env.OAUTH_ADMIN_PASSWORD = previous;
      }
    }
  });
});

describe("token endpoint", () => {
  it("validates PKCE and rejects reused code", async () => {
    const previous = process.env.OAUTH_ADMIN_PASSWORD;
    process.env.OAUTH_ADMIN_PASSWORD = "correct-password";
    try {
      const { app } = await testApp();
      const client = await register(app);
      const verifier = "test-verifier";
      const authorizeResponse = await request(app)
        .post("/oauth/authorize")
        .type("form")
        .send({
          response_type: "code",
          client_id: client.client_id,
          redirect_uri: "https://example.com/callback",
          code_challenge: pkceChallenge(verifier),
          code_challenge_method: "S256",
          admin_password: "correct-password"
        })
        .expect(302);
      const location = new URL(authorizeResponse.header.location);
      const code = location.searchParams.get("code");
      assert.ok(code);

      await request(app)
        .post("/oauth/token")
        .type("form")
        .send({
          grant_type: "authorization_code",
          code,
          redirect_uri: "https://example.com/callback",
          client_id: client.client_id,
          code_verifier: "wrong-verifier"
        })
        .expect(400);

      const tokenResponse = await request(app)
        .post("/oauth/token")
        .type("form")
        .send({
          grant_type: "authorization_code",
          code,
          redirect_uri: "https://example.com/callback",
          client_id: client.client_id,
          code_verifier: verifier
        })
        .expect(200);
      assert.equal(tokenResponse.body.token_type, "Bearer");
      assert.equal(tokenResponse.body.scope, "mcp");

      await request(app)
        .post("/oauth/token")
        .type("form")
        .send({
          grant_type: "authorization_code",
          code,
          redirect_uri: "https://example.com/callback",
          client_id: client.client_id,
          code_verifier: verifier
        })
        .expect(400);
    } finally {
      if (previous === undefined) {
        delete process.env.OAUTH_ADMIN_PASSWORD;
      } else {
        process.env.OAUTH_ADMIN_PASSWORD = previous;
      }
    }
  });

  it("rejects expired code", async () => {
    const { app, secretsDir } = await testApp();
    const client = await register(app);
    await writeFile(
      path.join(secretsDir, "oauth-codes.json"),
      JSON.stringify([
        {
          code: "expired-code",
          client_id: client.client_id,
          redirect_uri: "https://example.com/callback",
          code_challenge: pkceChallenge("verifier"),
          expires_at: "2000-01-01T00:00:00.000Z",
          used: false
        }
      ])
    );

    await request(app)
      .post("/oauth/token")
      .type("form")
      .send({
        grant_type: "authorization_code",
        code: "expired-code",
        redirect_uri: "https://example.com/callback",
        client_id: client.client_id,
        code_verifier: "verifier"
      })
      .expect(400);
  });
});

describe("mcp auth", () => {
  it("accepts static bearer token and rejects invalid token", async () => {
    const { app } = await testApp();
    await request(app).post("/__test/auth-probe").set("Authorization", "Bearer static-token").send({}).expect(200);
    await request(app).post("/__test/auth-probe").set("Authorization", "Bearer nope").send({}).expect(401);
  });

  it("accepts OAuth access token", async () => {
    const { app, secretsDir } = await testApp();
    await writeFile(
      path.join(secretsDir, "oauth-tokens.json"),
      JSON.stringify([
        {
          token: "oauth-token",
          client_id: "client",
          expires_at: "2999-01-01T00:00:00.000Z",
          scope: "mcp"
        }
      ])
    );

    await request(app).post("/__test/auth-probe").set("Authorization", "Bearer oauth-token").send({}).expect(200);
  });
});
