import path from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { LocalDataReader } from "../src/data.js";
import { filterByDateRange } from "../src/date.js";
import { createToolHandlers, inputSchemas } from "../src/tools.js";
import { classifySport } from "../src/sports.js";

const sampleDir = path.resolve(process.cwd(), "../sample-data");

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

  it("handles missing activity details", async () => {
    const result = await handlers.get_activity_detail({ activity_id: "does-not-exist" });
    assert.deepEqual(result.structuredContent, {
      activity_id: "does-not-exist",
      detail: null,
      missing: true,
      streams_omitted: true,
      next_tool_hint: "For full Garmin streams, call get_activity_streams."
    });
  });

  it("returns sync status", async () => {
    const result = await handlers.get_sync_status();
    assert.equal(result.structuredContent.status, "success");
    assert.equal(result.structuredContent.latest_activity_id, "sample-walk-1");
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
    const started = await syncHandlers.sync_now({ days: 7, force_login: false, activity_streams: true, include_raw: true });
    assert.equal(started.structuredContent.status, "started");
    assert.equal(spawned.command, "python");
    assert.ok(spawned.args?.includes("--activity-streams"));

    const lock = JSON.parse(await readFile(path.join(root, "sync.lock"), "utf8")) as { job_id: string };
    const again = await syncHandlers.sync_now({ days: 7, force_login: false, activity_streams: true, include_raw: true });
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
    assert.doesNotMatch(appSource, /Strava fallback/i);
  });
});
