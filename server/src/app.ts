// Express application wiring for the Garmin MCP server.
//
// This file owns HTTP concerns: CORS, JSON parsing, OAuth routes, bearer/OAuth
// authorization, health checks, and MCP tool registration. Business logic stays
// in tools/data/workout helper modules so the transport remains thin.
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
  // Dependency injection keeps tests fast and lets production choose env-based readers.
  const app = express();
  const bearerToken = options.bearerToken ?? process.env.MCP_BEARER_TOKEN;
  const oauth = options.oauth ?? new OAuthService();
  const reader = options.reader ?? createDataReader();
  const handlers = createToolHandlers(reader);

  app.disable("x-powered-by");
  app.use(cors({ origin: false }));
  app.use(express.json({ limit: "1mb" }));

  installOAuthRoutes(app, oauth);

  // Every MCP request must carry either the configured bearer token or a valid OAuth access token.
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

  // MCP clients discover behavior from these descriptions, so they intentionally steer long-range
  // questions toward archive tools and detailed workout questions toward stream tools.
  function registerTools(server: McpServer) {
    const toolDescriptions: Record<ToolName, string> = {
      get_today_summary: "Return the daily Garmin summary for one date.",
      get_range_summary: "Return compact sleep, HRV, stress, body battery, activity, and recovery trends for a recent date range. Reads latest/recent data only. For historical ranges beyond latest coverage, use get_archive_range_summary.",
      get_recent_activities: "Return recent Garmin activity summaries. Reads latest/recent data only. For arbitrary historical date ranges, use get_activities_by_date_range. Full Garmin streams are available via get_activity_streams, get_latest_workout_streams, get_latest_ride_streams, and analyze_activity.",
      get_activity_detail: "Return one detailed Garmin activity summary. Full Garmin streams are available via get_activity_streams, get_latest_workout_streams, get_latest_ride_streams, and analyze_activity.",
      get_coach_context: "Return compact Garmin context optimized for recent coaching context. For long-range history, use archive tools.",
      get_sync_status: "Return the latest Garmin sync status written by the sync job, including running sync_now lock state when present.",
      get_data_capabilities: "Return Garmin MCP data capabilities and coverage: archive history bounds, latest coverage, supported health datasets, sports, stream fields, raw data availability, activity stream availability, total activity count, total days available, and archive statistics. Call this first when an AI client needs to know what data exists.",
      get_latest_activity: "Return the latest synced Garmin activity detail. Full Garmin streams are available via get_activity_streams, get_latest_workout_streams, get_latest_ride_streams, and analyze_activity.",
      sync_now: "Start an authenticated background Garmin sync that stores normalized data, raw payloads, and activity streams.",
      get_latest_workout: "Return the latest matching Garmin workout summary with stream availability. For full Garmin streams, call get_latest_workout_streams or get_activity_streams.",
      get_latest_workout_summary: "Return analysis-ready summary fields for the latest matching Garmin workout, including stream availability.",
      get_latest_workout_streams: "Returns full Garmin time-series streams for deep workout analysis. Use this instead of external activity sources when detailed HR/cadence/speed/power/elevation data is needed.",
      get_activity_streams: "Return full Garmin time-series streams for a specific activity from latest or archive storage, with optional field filtering or explicit downsampling.",
      analyze_activity: "Return structured Garmin workout analysis using summary data plus full streams when available, including HR drift, cadence/speed consistency, intensity distribution, laps, and raw stream references.",
      analyze_latest_workout: "Find the latest matching Garmin workout and return structured stream-derived analysis.",
      get_latest_ride: "Return the newest Garmin cycling activity, not the newest activity overall, with stream availability.",
      get_latest_ride_summary: "Return summary fields for the newest Garmin cycling activity with stream availability and ride stream hint.",
      get_latest_ride_streams: "Returns full Garmin ride streams for deep cycling analysis including HR, cadence, speed, power if available, elevation, distance, and GPS if available. Use this instead of external services for detailed ride analysis.",
      get_archive_range_summary: "Read partitioned Garmin archive data for a date range and return coverage, missing-data warnings, activity volume, and health trend summaries. Dates use YYYY-MM-DD. For single-day queries, provide only start_date; end_date is optional and defaults to start_date.",
      get_activities_by_date_range: "Read Garmin archive activities for start_date/end_date with sport filters, optional details, and stream availability. Dates use YYYY-MM-DD. For single-day queries, provide only start_date; end_date is optional and defaults to start_date.",
      get_workouts_by_date_range: "Archive-aware workout range query over Garmin activities, with sport filters, optional details, and stream availability. Dates use YYYY-MM-DD. For single-day queries, provide only start_date; end_date is optional and defaults to start_date.",
      get_health_metrics_by_date_range: "Read partitioned Garmin archive daily, sleep, HRV, stress, and body battery records with coverage warnings. Dates use YYYY-MM-DD. For single-day queries, provide only start_date; end_date is optional and defaults to start_date.",
      get_sleep_for_date: "Return normalized Garmin sleep for one date. Input date uses YYYY-MM-DD. Source defaults to auto and checks latest data first, then archive.",
      get_hrv_for_date: "Return normalized Garmin HRV for one date. Input date uses YYYY-MM-DD. Source defaults to auto and checks latest data first, then archive. HRV readings are omitted unless include_readings is true.",
      get_recovery_for_date: "Return one-date recovery context combining sleep, HRV, body battery, resting HR, stress, training readiness, recovery hours, and acute load where available. Input date uses YYYY-MM-DD.",
      analyze_training_period: "Analyze a Garmin archive training period with activity volume, sport distribution, health/recovery context, consistency, and optional stream metrics. Dates use YYYY-MM-DD. For single-day queries, provide only start_date; end_date is optional and defaults to start_date.",
      compare_training_periods: "Compare two Garmin archive periods for activity volume, sleep/HRV, stress/body battery, sport differences, recovery differences, and missing-data warnings. Dates use YYYY-MM-DD. Each period end date is optional and defaults to that period's start date.",
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

  // The MCP SDK transport handles the JSON-RPC request body once auth has passed.
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

  // Convert validation/auth errors into stable HTTP responses and hide unexpected internals.
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
