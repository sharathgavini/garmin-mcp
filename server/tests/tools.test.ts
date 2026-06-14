import path from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LocalDataReader } from "../src/data.js";
import { filterByDateRange } from "../src/date.js";
import { createToolHandlers, inputSchemas } from "../src/tools.js";

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
      streams_omitted: true
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
});
