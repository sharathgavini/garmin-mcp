import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import express from "express";
import { z } from "zod";
import { createDataReader } from "./data.js";
import { installOAuthRoutes, OAuthService } from "./oauth.js";
import { createToolHandlers, inputSchemas, inputShapes, type ToolName } from "./tools.js";
import type { GarminDataReader } from "./types.js";

export function createApp(
  options: { reader?: GarminDataReader; oauth?: OAuthService; bearerToken?: string; installAuthProbe?: boolean } = {}
) {
  const app = express();
  const bearerToken = options.bearerToken ?? process.env.MCP_BEARER_TOKEN;
  const oauth = options.oauth ?? new OAuthService();
  const reader = options.reader ?? createDataReader();
  const handlers = createToolHandlers(reader);

  app.disable("x-powered-by");
  app.use(cors({ origin: false }));
  app.use(express.json({ limit: "1mb" }));

  installOAuthRoutes(app, oauth);

  async function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
    const header = req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (bearerToken && token === bearerToken) {
      next();
      return;
    }
    if (token && (await oauth.isValidAccessToken(token))) {
      next();
      return;
    }
    res.status(401).json({ error: "Unauthorized" });
  }

  function registerTools(server: McpServer) {
    const toolDescriptions: Record<ToolName, string> = {
      get_today_summary: "Return the daily Garmin summary for one date.",
      get_range_summary: "Return compact sleep, HRV, stress, body battery, activity, and recovery trends for a date range.",
      get_recent_activities: "Return recent activity summaries, capped at 30 days.",
      get_activity_detail: "Return one detailed activity summary without second-by-second streams.",
      get_coach_context: "Return compact Garmin context optimized for LLM coaching.",
      get_sync_status: "Return the latest Garmin sync status written by the sync job.",
      get_latest_activity: "Return the latest synced activity detail.",
      health_check: "Return server status, latest data timestamp, and available date range."
    };

    for (const name of Object.keys(inputSchemas) as ToolName[]) {
      server.registerTool(
        name,
        {
          description: toolDescriptions[name],
          inputSchema: inputShapes[name]
        },
        async (input: unknown) => {
          const parsed = inputSchemas[name].parse(input);
          return handlers[name](parsed as never);
        }
      );
    }
  }

  app.get("/healthz", async (_req, res) => {
    try {
      const result = await handlers.health_check();
      res.json(result.structuredContent);
    } catch (error) {
      res.status(503).json({ status: "error", message: (error as Error).message });
    }
  });

  if (options.installAuthProbe) {
    app.post("/__test/auth-probe", requireAuth, (_req, res) => {
      res.json({ ok: true });
    });
  }

  app.post("/mcp", requireAuth, async (req, res) => {
    const server = new McpServer({
      name: "garmin-mcp",
      version: "0.1.0"
    });
    registerTools(server);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid input", issues: error.issues });
      return;
    }
    const oauthError = error as { status?: number; oauthError?: string };
    if (oauthError.oauthError) {
      res.status(oauthError.status ?? 400).json({ error: oauthError.oauthError });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
