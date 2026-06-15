import path from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import request from "supertest";
import { createApp } from "../src/app.js";
import { LocalDataReader } from "../src/data.js";
import { filterByDateRange } from "../src/date.js";
import { createToolHandlers, inputSchemas, inputShapes } from "../src/tools.js";
import { classifySport } from "../src/sports.js";

const sampleDir = path.resolve(process.cwd(), "../sample-data");

async function createArchiveFixture() {
  // Build a throwaway latest/archive tree that mirrors the TrueNAS layout.
  const root = await mkdtemp(path.join(os.tmpdir(), "garmin-archive-"));
  const latest = path.join(root, "latest");
  const archive = path.join(root, "archive");
  await mkdir(latest, { recursive: true });
  await writeFile(path.join(latest, "manifest.json"), "{}");
  await writeFile(path.join(latest, "activities.json"), "[]");

  async function writePartition(dataset: string, year: string, month: string, rows: unknown[]) {
    // Archive readers expect year=YYYY/month=MM partition directories.
    const dir = path.join(archive, dataset, `year=${year}`, `month=${month}`);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${dataset}.json`), JSON.stringify(rows, null, 2));
  }

  await writePartition("activities", "2026", "04", [
    { id: "ride-apr", type: "road biking", date: "2026-04-20", distance_meters: 20000, duration_seconds: 3600, avg_hr: 138 }
  ]);
  await writePartition("activities", "2026", "05", [
    { id: "ride-may", type: "road biking", date: "2026-05-04", distance_meters: 30000, duration_seconds: 4800, avg_hr: 144 },
    { id: "badminton-may", type: "badminton", date: "2026-05-10", duration_seconds: 3600, avg_hr: 132 }
  ]);
  await writePartition("activities", "2026", "06", [
    { id: "run-jun", type: "running", date: "2026-06-02", distance_meters: 6000, duration_seconds: 2100, avg_hr: 151 },
    { id: "ride-jun", type: "road biking", date: "2026-06-14", distance_meters: 42000, duration_seconds: 6600, avg_hr: 146 }
  ]);
  await writePartition("daily", "2026", "05", [
    { date: "2026-05-01", training_readiness: 72, acute_load: 340, resting_hr: 52, recovery_hours: 18 },
    { date: "2026-05-02", training_readiness: 68, acute_load: 360 }
  ]);
  await writePartition("daily", "2026", "06", [{ date: "2026-06-01", training_readiness: 74, acute_load: 380 }]);
  await writePartition("sleep", "2026", "05", [
    {
      date: "2026-05-01",
      data_available: true,
      sleep_start_gmt: "2026-04-30T18:10:00Z",
      sleep_end_gmt: "2026-05-01T01:40:00Z",
      sleep_start_local: "2026-04-30T23:40:00",
      sleep_end_local: "2026-05-01T07:10:00",
      total_sleep_seconds: 27000,
      deep_sleep_seconds: 5400,
      light_sleep_seconds: 14400,
      rem_sleep_seconds: 5400,
      awake_sleep_seconds: 1800,
      sleep_score: 82,
      avg_sleep_stress: 19,
      avg_heart_rate: 51,
      avg_spo2: 97,
      avg_respiration: 14.2,
      body_battery_change: 62,
      naps: [{ start_time_local: "2026-05-01T14:00:00", duration_seconds: 1200 }],
      sleep_need: { baseline_seconds: 28800 },
      sleep_alignment: { status: "aligned" },
      raw_payload_path: "raw/sleep/2026-05-01.json"
    }
  ]);
  await writePartition("hrv", "2026", "05", [
    {
      date: "2026-05-01",
      data_available: true,
      avg_overnight_hrv: 49,
      last_night_avg: 48,
      last_night_5min_high: 68,
      weekly_avg: 51,
      hrv_status: "balanced",
      baseline_balanced_low: 42,
      baseline_balanced_upper: 65,
      reading_count: 2,
      min_hrv: 43,
      max_hrv: 68,
      readings: [
        { hrv_value: 43, reading_time_gmt: "2026-04-30T20:00:00Z", reading_time_local: "2026-05-01T01:30:00" },
        { hrv_value: 68, reading_time_gmt: "2026-04-30T22:00:00Z", reading_time_local: "2026-05-01T03:30:00" }
      ],
      raw_payload_path: "raw/hrv/2026-05-01.json"
    }
  ]);
  await writePartition("stress", "2026", "05", [{ date: "2026-05-01", avg_stress: 31 }]);
  await writePartition("body_battery", "2026", "05", [{ date: "2026-05-01", body_battery_high: 78 }]);
  await mkdir(path.join(archive, "activity_streams"), { recursive: true });
  await writeFile(
    path.join(archive, "activity_streams", "ride-may.json"),
    JSON.stringify({ activity_id: "ride-may", fields: ["offset_seconds", "heart_rate"], samples: [{ offset_seconds: 0, heart_rate: 120 }] })
  );
  return { root, latest };
}

describe("date filtering", () => {
  it("filters inclusive date ranges", () => {
    const rows = [{ date: "2026-06-11" }, { date: "2026-06-12" }, { date: "2026-06-13" }];
    assert.deepEqual(filterByDateRange(rows, "2026-06-12", "2026-06-13"), [
      { date: "2026-06-12" },
      { date: "2026-06-13" }
    ]);
  });
});

describe("input validation", () => {
  it("rejects activity windows over 30 days", () => {
    assert.throws(() => inputSchemas.get_recent_activities.parse({ days: 31 }));
  });

  it("rejects range summaries over 30 days", () => {
    assert.throws(() =>
      inputSchemas.get_range_summary.parse({ start_date: "2026-05-01", end_date: "2026-06-13" })
    );
  });

  it("allows omitted, null, and explicit end_date on latest range summaries", () => {
    const omitted = inputSchemas.get_range_summary.parse({ start_date: "2026-06-13" });
    assert.equal(omitted.end_date, undefined);

    const nulled = inputSchemas.get_range_summary.parse({ start_date: "2026-06-13", end_date: null });
    assert.equal(nulled.end_date, null);

    const explicit = inputSchemas.get_range_summary.parse({ start_date: "2026-06-12", end_date: "2026-06-13" });
    assert.equal(explicit.end_date, "2026-06-13");
  });

  it("allows null end_date on archive range tools and defaults in handlers", () => {
    const parsed = inputSchemas.get_health_metrics_by_date_range.parse({
      start_date: "2026-05-01",
      end_date: null,
      metrics: ["sleep"]
    });
    assert.equal(parsed.start_date, "2026-05-01");
    assert.equal(parsed.end_date, null);
  });

  it("allows omitted end_date on archive range tools", () => {
    const parsed = inputSchemas.get_activities_by_date_range.parse({
      start_date: "2026-05-01"
    });
    assert.equal(parsed.start_date, "2026-05-01");
    assert.equal(parsed.end_date, undefined);
  });

  it("still rejects invalid archive dates", () => {
    assert.throws(() =>
      inputSchemas.get_health_metrics_by_date_range.parse({
        start_date: "2026/05/01",
        end_date: null
      })
    );
  });

  it("rejects invalid end_date types while accepting nullable schema shape", () => {
    for (const endDate of [123, {}, []]) {
      assert.throws(() => inputSchemas.get_range_summary.parse({ start_date: "2026-06-13", end_date: endDate }));
      assert.throws(() => inputSchemas.get_health_metrics_by_date_range.parse({ start_date: "2026-05-01", end_date: endDate }));
    }
    for (const shape of [
      inputShapes.get_range_summary,
      inputShapes.get_archive_range_summary,
      inputShapes.get_health_metrics_by_date_range,
      inputShapes.get_activities_by_date_range,
      inputShapes.get_workouts_by_date_range,
      inputShapes.analyze_training_period
    ]) {
      assert.equal(shape.end_date.safeParse(null).success, true);
      assert.equal(shape.end_date.safeParse(undefined).success, true);
      assert.equal(shape.end_date.safeParse("2026-06-13").success, true);
      assert.equal(shape.end_date.safeParse(123).success, false);
    }
    assert.equal(inputShapes.compare_training_periods.period_a_end.safeParse(null).success, true);
    assert.equal(inputShapes.compare_training_periods.period_b_end.safeParse(null).success, true);
  });
});

describe("tool handlers", () => {
  const handlers = createToolHandlers(new LocalDataReader(sampleDir));

  it("returns today's summary when available", async () => {
    const result = await handlers.get_today_summary({ date: "2026-06-13" });
    assert.deepEqual(
      {
        date: result.structuredContent.date,
        missing: result.structuredContent.missing
      },
      {
      date: "2026-06-13",
      missing: false
      }
    );
  });

  it("defaults null end_date inside get_range_summary handler", async () => {
    const parsed = inputSchemas.get_range_summary.parse({ start_date: "2026-06-13", end_date: null });
    const result = await handlers.get_range_summary(parsed);
    assert.equal(result.structuredContent.requested_start_date, "2026-06-13");
    assert.equal(result.structuredContent.requested_end_date, "2026-06-13");
    assert.deepEqual(result.structuredContent.defaults_applied, { end_date: "start_date" });
    assert.equal(result.structuredContent.end_date, "2026-06-13");
  });

  it("handles missing activity details", async () => {
    const result = await handlers.get_activity_detail({ activity_id: "does-not-exist" });
    assert.equal(result.structuredContent.activity_id, "does-not-exist");
    assert.equal(result.structuredContent.detail, null);
    assert.equal(result.structuredContent.missing, true);
    assert.equal(result.structuredContent.streams_omitted, true);
    assert.equal(result.structuredContent.source, "latest");
    assert.equal(result.structuredContent.streams_available, false);
    assert.equal(result.structuredContent.full_data_available, false);
  });

  it("returns sync status", async () => {
    const result = await handlers.get_sync_status();
    assert.equal(result.structuredContent.status, "success");
    assert.equal(result.structuredContent.latest_activity_id, "sample-walk-1");
    assert.equal(result.structuredContent.source, "latest");
  });

  it("returns data capabilities and archive statistics", async () => {
    const { latest } = await createArchiveFixture();
    const archiveHandlers = createToolHandlers(new LocalDataReader(latest));
    const result = await archiveHandlers.get_data_capabilities();
    assert.deepEqual(result.structuredContent.sources_used, ["archive"]);
    assert.equal(result.structuredContent.history_start, "2026-04-20");
    assert.equal(result.structuredContent.history_end, "2026-06-14");
    assert.deepEqual(result.structuredContent.history, {
      archive_start_date: "2026-04-20",
      archive_end_date: "2026-06-14",
      latest_start_date: null,
      latest_end_date: null,
      total_days_available: 56
    });
    assert.equal(result.structuredContent.sleep, true);
    assert.equal(result.structuredContent.hrv, true);
    assert.equal(result.structuredContent.activity_streams, true);
    assert.ok((result.structuredContent.stream_fields as string[]).includes("heart_rate"));
    assert.ok((result.structuredContent.stream_fields_observed as string[]).includes("heart_rate"));
    assert.ok((result.structuredContent.missing_or_optional_stream_fields as string[]).includes("power_watts"));
    assert.ok((result.structuredContent.sport_categories_observed as string[]).includes("cycling"));
    assert.equal(((result.structuredContent.health_datasets as Record<string, Record<string, unknown>>).sleep).available, true);
    assert.equal(((result.structuredContent.activity_datasets as Record<string, unknown>).activity_streams), true);
    assert.ok(result.structuredContent.last_sync);
    const stats = result.structuredContent.archive_statistics as Record<string, unknown>;
    assert.equal(stats.total_activities, 5);
    assert.equal((stats.activities_by_sport as Record<string, number>).cycling, 3);
    assert.equal((result.structuredContent.archive_stats as Record<string, unknown>).total_activities, 5);
  });

  it("returns system status with dataset and warning metadata", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "garmin-status-"));
    const latest = path.join(root, "latest");
    await mkdir(latest, { recursive: true });
    await writeFile(path.join(latest, "manifest.json"), JSON.stringify({ date_range: { start: "2026-06-01", end: "2026-06-01" } }));
    await writeFile(path.join(latest, "daily.json"), JSON.stringify([{ date: "2026-06-01" }]));
    await writeFile(path.join(latest, "sleep.json"), JSON.stringify([{ date: "2026-06-01" }]));
    await writeFile(path.join(latest, "hrv.json"), JSON.stringify([{ date: "2026-06-01" }]));
    await writeFile(path.join(latest, "stress.json"), JSON.stringify([]));
    await writeFile(path.join(latest, "body_battery.json"), JSON.stringify([]));
    await writeFile(path.join(latest, "activities.json"), JSON.stringify([{ id: "a1", date: "2026-06-01", type: "running" }]));
    const statusHandlers = createToolHandlers(new LocalDataReader(latest));
    const result = await statusHandlers.get_system_status();
    assert.equal(result.structuredContent.server_status, "ok");
    assert.equal((result.structuredContent.auth_mode_summary as Record<string, unknown>).secrets_redacted, true);
    assert.ok((result.structuredContent.available_datasets as Record<string, unknown>).health);
    assert.ok((result.structuredContent.warnings as string[]).some((warning) => warning.includes("sleep normalization")));
    assert.ok((result.structuredContent.warnings as string[]).some((warning) => warning.includes("activity streams")));
  });

  it("returns dataset status and sync completeness diagnostics", async () => {
    const result = await handlers.get_dataset_status();
    assert.equal((result.structuredContent.daily as Record<string, unknown>).latest_date, "2026-06-13");
    assert.equal((result.structuredContent.sleep as Record<string, unknown>).record_count, 2);

    const completeness = await handlers.get_sync_completeness();
    assert.equal(completeness.structuredContent.sync_status, "success");
    assert.equal((completeness.structuredContent.latest_available_dates as Record<string, unknown>).daily, "2026-06-13");
    assert.ok(completeness.structuredContent.sync_completeness);
  });

  it("returns latest activity using sync status", async () => {
    const result = await handlers.get_latest_activity();
    assert.equal(result.structuredContent.activity_id, "sample-walk-1");
    assert.equal(result.structuredContent.missing, false);
  });

  it("classifies core Garmin sport families", () => {
    assert.equal(classifySport("Road Biking"), "cycling");
    assert.equal(classifySport("treadmill running"), "running");
    assert.equal(classifySport("hiking"), "walking");
    assert.equal(classifySport("Badminton"), "badminton");
    assert.equal(classifySport("strength training"), "strength");
    assert.equal(classifySport("mobility rehab"), "mobility");
  });

  it("returns latest ride instead of latest activity overall", async () => {
    const result = await handlers.get_latest_ride({ days: 90 });
    assert.equal(result.structuredContent.activity_id, "sample-ride-1");
    assert.equal((result.structuredContent.summary as Record<string, unknown>).sport_category, "cycling");
    assert.equal(result.structuredContent.has_streams, true);
  });

  it("returns full streams by default and filters/downsamples only when requested", async () => {
    const full = await handlers.get_activity_streams({ activity_id: "sample-ride-1", source: "auto", downsample: false });
    const fullStream = full.structuredContent.stream as { samples: unknown[]; fields: string[] };
    assert.equal(fullStream.samples.length, 6);
    assert.ok(fullStream.fields.includes("power_watts"));
    assert.deepEqual(full.structuredContent.sources_used, ["latest", "archive"]);
    assert.equal(full.structuredContent.streams_available, true);
    assert.equal(full.structuredContent.stream_sample_count, 6);
    assert.equal(full.structuredContent.full_data_available, false);
    assert.equal(full.structuredContent.partial_stream, true);
    assert.ok((full.structuredContent.available_streams as string[]).includes("heart_rate"));
    assert.ok((full.structuredContent.missing_streams as string[]).includes("position_lat"));

    const selected = await handlers.get_activity_streams({
      activity_id: "sample-ride-1",
      source: "auto",
      fields: ["heart_rate"],
      downsample: true,
      max_points: 3
    });
    const selectedStream = selected.structuredContent.stream as { samples: Record<string, unknown>[]; fields: string[]; downsampled: boolean };
    assert.equal(selectedStream.samples.length, 3);
    assert.equal(selectedStream.downsampled, true);
    assert.deepEqual(Object.keys(selectedStream.samples[0]).sort(), ["heart_rate", "offset_seconds"]);
  });

  it("returns the explicit missing stream message", async () => {
    const result = await handlers.get_activity_streams({ activity_id: "missing", source: "auto", downsample: false });
    assert.equal(result.structuredContent.found, false);
    assert.match(String(result.structuredContent.message), /Run sync\/backfill with activity streams enabled/);
    assert.doesNotMatch(String(result.structuredContent.message), /Strava/i);
  });

  it("analyzes stream-derived metrics and raw stream reference", async () => {
    const result = await handlers.analyze_activity({
      activity_id: "sample-ride-1",
      source: "auto",
      analysis_type: "cycling",
      include_streams: false
    });
    assert.equal(result.structuredContent.sport_category, "cycling");
    assert.ok(result.structuredContent.hr_drift);
    assert.deepEqual((result.structuredContent.raw_stream_reference as Record<string, unknown>).recommended_tool, "get_activity_streams");
    assert.equal("streams" in result.structuredContent, false);
  });

  it("can read archive stream files in auto mode", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "garmin-reader-"));
    const latest = path.join(root, "latest");
    const archiveStreams = path.join(root, "archive", "activity_streams");
    await mkdir(path.join(latest, "activity_streams"), { recursive: true });
    await mkdir(archiveStreams, { recursive: true });
    await writeFile(path.join(latest, "manifest.json"), "{}");
    await writeFile(path.join(latest, "activities.json"), "[]");
    await writeFile(
      path.join(archiveStreams, "archive-1.json"),
      JSON.stringify({ activity_id: "archive-1", fields: ["offset_seconds"], samples: [{ offset_seconds: 0 }] })
    );
    const archiveHandlers = createToolHandlers(new LocalDataReader(latest));
    const result = await archiveHandlers.get_activity_streams({ activity_id: "archive-1", source: "auto", downsample: false });
    assert.equal(result.structuredContent.found, true);
  });

  it("starts sync_now and reports running lock state", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "garmin-sync-now-"));
    const spawned: { command?: string; args?: string[] } = {};
    const fakeSpawn = (command: string, args: string[]) => {
      spawned.command = command;
      spawned.args = args;
      const child = new EventEmitter() as EventEmitter & { once: EventEmitter["once"]; unref: () => void };
      child.unref = () => {};
      return child as never;
    };
    const syncHandlers = createToolHandlers(new LocalDataReader(sampleDir), { dataDir: root, spawnProcess: fakeSpawn as never });
    const started = await syncHandlers.sync_now({ days: 7, force_login: false, force_refresh: true, activity_streams: true, include_raw: true });
    assert.equal(started.structuredContent.status, "started");
    assert.equal(started.structuredContent.force_refresh, true);
    assert.equal(spawned.command, "python");
    assert.ok(spawned.args?.includes("--activity-streams"));
    assert.ok(spawned.args?.includes("--activity-details"));
    assert.ok(spawned.args?.includes("--force-refresh"));

    const lock = JSON.parse(await readFile(path.join(root, "sync.lock"), "utf8")) as { job_id: string };
    const again = await syncHandlers.sync_now({ days: 7, force_login: false, force_refresh: false, activity_streams: true, include_raw: true });
    assert.equal(again.structuredContent.status, "already_running");
    assert.equal(again.structuredContent.job_id, lock.job_id);

    const status = await syncHandlers.get_sync_status();
    assert.equal(status.structuredContent.status, "running");
    assert.equal(status.structuredContent.job_id, lock.job_id);
  });

  it("tool descriptions advertise full Garmin streams", async () => {
    const appSource = await readFile(path.resolve(process.cwd(), "src/app.ts"), "utf8");
    assert.match(appSource, /Full Garmin streams are available/);
    assert.match(appSource, /Returns full Garmin ride streams/);
    assert.match(appSource, /For historical ranges beyond latest coverage, use get_archive_range_summary/);
    assert.match(appSource, /For arbitrary historical date ranges, use get_activities_by_date_range/);
    assert.match(appSource, /For long-range history, use archive tools/);
    assert.doesNotMatch(appSource, /Strava fallback/i);
  });

  it("MCP tools/list advertises nullable optional end_date", async () => {
    const app = createApp({ reader: new LocalDataReader(sampleDir), bearerToken: "dev-token" });
    const response = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer dev-token")
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
      .expect(200);
    const event = response.text.split("\n").find((line) => line.startsWith("data:"));
    assert.ok(event);
    const payload = JSON.parse(event.slice("data:".length)) as { result: { tools: Array<{ name: string; inputSchema: Record<string, unknown> }> } };
    const tools = payload.result.tools;
    const rangeTool = tools.find((tool) => tool.name === "get_range_summary");
    assert.ok(rangeTool);
    const schema = rangeTool.inputSchema as { required?: string[]; properties?: Record<string, unknown> };
    assert.equal(schema.required?.includes("end_date"), false);
    assert.match(JSON.stringify(schema.properties?.end_date), /null/);
  });

  it("MCP tools/call accepts null end_date and applies the single-day default", async () => {
    const app = createApp({ reader: new LocalDataReader(sampleDir), bearerToken: "dev-token" });
    const response = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer dev-token")
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "get_range_summary",
          arguments: { start_date: "2026-06-13", end_date: null }
        }
      })
      .expect(200);
    const event = response.text.split("\n").find((line) => line.startsWith("data:"));
    assert.ok(event);
    const payload = JSON.parse(event.slice("data:".length)) as { result: { structuredContent: Record<string, unknown> } };
    assert.equal(payload.result.structuredContent.requested_end_date, "2026-06-13");
    assert.deepEqual(payload.result.structuredContent.defaults_applied, { end_date: "start_date" });
  });

  it("selects month partitions and filters archive dates across months", async () => {
    const { latest } = await createArchiveFixture();
    const reader = new LocalDataReader(latest);
    const result = await reader.readArchiveCollection("activities", "2026-04-25", "2026-06-14");
    assert.deepEqual(result.coverage.requested_partitions, [
      "activities/year=2026/month=04/activities.json",
      "activities/year=2026/month=05/activities.json",
      "activities/year=2026/month=06/activities.json"
    ]);
    assert.equal(result.rows.length, 4);
    assert.equal(result.coverage.available_start_date, "2026-05-04");
    assert.equal(result.coverage.available_end_date, "2026-06-14");
  });

  it("reports missing archive partitions and coverage warnings", async () => {
    const { latest } = await createArchiveFixture();
    const reader = new LocalDataReader(latest);
    const result = await reader.readArchiveCollection("sleep", "2026-05-01", "2026-06-14");
    assert.ok(result.coverage.missing_partitions.includes("sleep/year=2026/month=06/sleep.json"));
    assert.ok(result.coverage.warnings.length > 0);
  });

  it("gets archive activities across three months with sport filtering", async () => {
    const { latest } = await createArchiveFixture();
    const archiveHandlers = createToolHandlers(new LocalDataReader(latest));
    const result = await archiveHandlers.get_activities_by_date_range({
      start_date: "2026-04-01",
      end_date: "2026-06-30",
      sport_categories: ["cycling"],
      limit: 100,
      include_details: false,
      include_stream_availability: true
    });
    assert.equal(result.structuredContent.total_matches, 3);
    assert.equal(result.structuredContent.source, "archive");
    assert.equal((result.structuredContent.coverage as Record<string, unknown>).days_requested, 91);
    assert.equal((result.structuredContent.coverage as Record<string, unknown>).days_found, 3);
    assert.equal((result.structuredContent.coverage as Record<string, unknown>).completeness_percent, 3.3);
    assert.equal((result.structuredContent.coverage as Record<string, unknown>).available_start_date, "2026-04-20");
    assert.equal((result.structuredContent.coverage as Record<string, unknown>).available_end_date, "2026-06-14");
    assert.ok(((result.structuredContent.coverage as Record<string, unknown>).missing_dates as string[]).includes("2026-04-01"));
    const activities = result.structuredContent.activities as Array<Record<string, unknown>>;
    assert.deepEqual(activities.map((activity) => activity.id), ["ride-jun", "ride-may", "ride-apr"]);
    assert.equal(activities.find((activity) => activity.id === "ride-may")?.has_streams, true);
  });

  it("gets health metrics by archive date range", async () => {
    const { latest } = await createArchiveFixture();
    const archiveHandlers = createToolHandlers(new LocalDataReader(latest));
    const result = await archiveHandlers.get_health_metrics_by_date_range({
      start_date: "2026-05-01",
      end_date: "2026-06-01",
      metrics: ["daily", "hrv"]
    });
    const metrics = result.structuredContent.metrics as Record<string, { records: unknown[]; coverage: { warnings: string[] } }>;
    assert.equal(metrics.daily.records.length, 3);
    assert.equal(metrics.hrv.records.length, 1);
    assert.ok(metrics.hrv.coverage.warnings.length > 0);
  });

  it("gets single-day health metrics when end_date is null", async () => {
    const { latest } = await createArchiveFixture();
    const archiveHandlers = createToolHandlers(new LocalDataReader(latest));
    const parsed = inputSchemas.get_health_metrics_by_date_range.parse({
      start_date: "2026-05-01",
      end_date: null,
      metrics: ["sleep", "hrv"]
    });
    const result = await archiveHandlers.get_health_metrics_by_date_range(parsed);
    assert.equal(result.structuredContent.requested_start_date, "2026-05-01");
    assert.equal(result.structuredContent.requested_end_date, "2026-05-01");
    assert.deepEqual(result.structuredContent.defaults_applied, { end_date: "start_date" });
    assert.equal((result.structuredContent.coverage as Record<string, unknown>).days_requested, 1);
    assert.equal((result.structuredContent.coverage as Record<string, unknown>).days_found, 1);
    assert.equal((result.structuredContent.coverage as Record<string, unknown>).completeness_percent, 100);
    assert.deepEqual((result.structuredContent.coverage as Record<string, unknown>).missing_dates, []);
    const metrics = result.structuredContent.metrics as Record<string, { records: Array<Record<string, unknown>> }>;
    assert.equal(metrics.sleep.records[0].total_sleep_seconds, 27000);
    assert.equal(metrics.hrv.records[0].last_night_avg, 48);
  });

  it("gets normalized sleep for one date", async () => {
    const { latest } = await createArchiveFixture();
    const archiveHandlers = createToolHandlers(new LocalDataReader(latest));
    const result = await archiveHandlers.get_sleep_for_date({
      date: "2026-05-01",
      source: "archive"
    });
    assert.equal(result.structuredContent.found, true);
    assert.equal(result.structuredContent.sleep_duration_seconds, 27000);
    assert.equal(result.structuredContent.deep_sleep_seconds, 5400);
    assert.equal(result.structuredContent.sleep_score, 82);
    assert.equal(result.structuredContent.avg_spo2, 97);
    assert.equal(result.structuredContent.body_battery_change, 62);
  });

  it("gets normalized HRV for one date and keeps readings optional", async () => {
    const { latest } = await createArchiveFixture();
    const archiveHandlers = createToolHandlers(new LocalDataReader(latest));
    const result = await archiveHandlers.get_hrv_for_date({
      date: "2026-05-01",
      source: "archive",
      include_readings: false
    });
    assert.equal(result.structuredContent.found, true);
    assert.equal(result.structuredContent.last_night_avg, 48);
    assert.equal(result.structuredContent.hrv_status, "balanced");
    assert.equal(result.structuredContent.reading_count, 2);
    assert.equal("readings" in result.structuredContent, false);

    const withReadings = await archiveHandlers.get_hrv_for_date({
      date: "2026-05-01",
      source: "archive",
      include_readings: true
    });
    assert.equal((withReadings.structuredContent.readings as unknown[]).length, 2);
  });

  it("combines recovery signals for one date", async () => {
    const { latest } = await createArchiveFixture();
    const archiveHandlers = createToolHandlers(new LocalDataReader(latest));
    const result = await archiveHandlers.get_recovery_for_date({
      date: "2026-05-01",
      source: "archive",
      include_readings: false
    });
    assert.equal((result.structuredContent.sleep as Record<string, unknown>).sleep_score, 82);
    assert.equal((result.structuredContent.hrv as Record<string, unknown>).last_night_avg, 48);
    assert.equal(result.structuredContent.resting_hr, 52);
    assert.equal(result.structuredContent.avg_stress, 31);
    assert.equal((result.structuredContent.body_battery as Record<string, unknown>).body_battery_high, 78);
    assert.equal(result.structuredContent.full_recovery_data_available, true);
    assert.deepEqual(result.structuredContent.missing, []);
  });

  it("reports missing recovery readiness fields", async () => {
    const { latest } = await createArchiveFixture();
    const archiveHandlers = createToolHandlers(new LocalDataReader(latest));
    const result = await archiveHandlers.get_recovery_for_date({
      date: "2026-05-02",
      source: "archive",
      include_readings: false
    });
    assert.equal(result.structuredContent.full_recovery_data_available, false);
    assert.ok((result.structuredContent.missing as string[]).includes("sleep_score"));
    assert.ok((result.structuredContent.missing as string[]).includes("overnight_hrv"));
  });

  it("summarizes and compares archive training periods", async () => {
    const { latest } = await createArchiveFixture();
    const archiveHandlers = createToolHandlers(new LocalDataReader(latest));
    const summary = await archiveHandlers.get_archive_range_summary({
      start_date: "2026-05-01",
      end_date: "2026-06-30",
      sport_categories: ["cycling"]
    });
    assert.equal(summary.structuredContent.total_distance_meters, 72000);
    assert.deepEqual((summary.structuredContent.activity_counts_by_sport_category as Record<string, number>).cycling, 2);

    const analysis = await archiveHandlers.analyze_training_period({
      start_date: "2026-05-01",
      end_date: "2026-06-30",
      sport_categories: ["cycling"],
      analysis_focus: "cycling",
      include_stream_metrics: true
    });
    assert.equal((analysis.structuredContent.activity_volume as Record<string, unknown>).activity_count, 2);
    assert.equal((analysis.structuredContent.stream_metrics as Record<string, unknown>).streams_found, 1);

    const comparison = await archiveHandlers.compare_training_periods({
      period_a_start: "2026-05-01",
      period_a_end: "2026-05-31",
      period_b_start: "2026-06-01",
      period_b_end: "2026-06-30",
      sport_categories: ["cycling"]
    });
    assert.deepEqual((comparison.structuredContent.distance_changes as Record<string, unknown>).change, 12000);
    assert.ok(Array.isArray(comparison.structuredContent.warnings));
  });
});
