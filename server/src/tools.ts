import { z } from "zod";
import { daysAgoIso, filterByDateRange, inclusiveDays, isIsoDate, latestByDate, todayIso } from "./date.js";
import type { GarminDataReader, JsonObject } from "./types.js";

const isoDateSchema = z.string().refine(isIsoDate, "Use YYYY-MM-DD.");
const daysSchema = z.number().int().min(1).max(30).default(14);

export const inputShapes = {
  get_today_summary: {
    date: isoDateSchema.optional()
  },
  get_range_summary: {
    start_date: isoDateSchema,
    end_date: isoDateSchema
  },
  get_recent_activities: {
    days: daysSchema
  },
  get_activity_detail: {
    activity_id: z.string().min(1)
  },
  get_coach_context: {
    days: daysSchema
  },
  get_sync_status: {},
  get_latest_activity: {},
  health_check: {}
};

export const inputSchemas = {
  get_today_summary: z.object(inputShapes.get_today_summary),
  get_range_summary: z
    .object(inputShapes.get_range_summary)
    .refine((input) => input.start_date <= input.end_date, "start_date must be on or before end_date.")
    .refine((input) => inclusiveDays(input.start_date, input.end_date) <= 30, "Date range cannot exceed 30 days."),
  get_recent_activities: z.object(inputShapes.get_recent_activities),
  get_activity_detail: z.object(inputShapes.get_activity_detail),
  get_coach_context: z.object(inputShapes.get_coach_context),
  get_sync_status: z.object(inputShapes.get_sync_status),
  get_latest_activity: z.object(inputShapes.get_latest_activity),
  health_check: z.object(inputShapes.health_check)
};

export type ToolName = keyof typeof inputSchemas;

function ok(data: JsonObject): { content: Array<{ type: "text"; text: string }>; structuredContent: JsonObject } {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data
  };
}

function missingCollection(collection: string): JsonObject[] {
  return [{ warning: `${collection} data is unavailable` }];
}

async function safeCollection(reader: GarminDataReader, collection: string): Promise<JsonObject[]> {
  try {
    return await reader.readCollection(collection);
  } catch {
    return missingCollection(collection);
  }
}

export function createToolHandlers(reader: GarminDataReader) {
  async function readSyncStatus(): Promise<JsonObject> {
    try {
      return await reader.readJson<JsonObject>("latest/latest_sync_status.json");
    } catch {
      try {
        return await reader.readJson<JsonObject>("latest_sync_status.json");
      } catch {
        return {
          status: "unknown",
          missing: true
        };
      }
    }
  }

  return {
    async get_today_summary(input: z.infer<typeof inputSchemas.get_today_summary>) {
      const date = input.date ?? todayIso();
      const daily = await safeCollection(reader, "daily");
      const summary = daily.find((row) => row.date === date) ?? null;
      return ok({ date, summary, missing: summary === null });
    },

    async get_range_summary(input: z.infer<typeof inputSchemas.get_range_summary>) {
      const [daily, sleep, hrv, stress, bodyBattery, activities] = await Promise.all([
        safeCollection(reader, "daily"),
        safeCollection(reader, "sleep"),
        safeCollection(reader, "hrv"),
        safeCollection(reader, "stress"),
        safeCollection(reader, "body_battery"),
        safeCollection(reader, "activities")
      ]);

      const { start_date, end_date } = input;
      const dailyRange = filterByDateRange(daily, start_date, end_date);
      const readiness = dailyRange
        .map((row) => ({
          date: row.date,
          training_readiness: row.training_readiness,
          acute_load: row.acute_load,
          recovery_hours: row.recovery_hours
        }))
        .filter((row) => row.training_readiness || row.acute_load || row.recovery_hours);

      return ok({
        start_date,
        end_date,
        sleep_trend: filterByDateRange(sleep, start_date, end_date),
        hrv_trend: filterByDateRange(hrv, start_date, end_date),
        stress_trend: filterByDateRange(stress, start_date, end_date),
        body_battery_trend: filterByDateRange(bodyBattery, start_date, end_date),
        activities_summary: filterByDateRange(activities, start_date, end_date),
        training_load_recovery_notes: readiness
      });
    },

    async get_recent_activities(input: z.infer<typeof inputSchemas.get_recent_activities>) {
      const endDate = todayIso();
      const startDate = daysAgoIso(input.days - 1);
      const activities = await safeCollection(reader, "activities");
      return ok({
        days: input.days,
        activities: filterByDateRange(activities, startDate, endDate).map((activity) => ({
          id: activity.id,
          type: activity.type,
          date: activity.date,
          distance_meters: activity.distance_meters,
          duration_seconds: activity.duration_seconds,
          avg_hr: activity.avg_hr,
          calories: activity.calories,
          training_effect: activity.training_effect
        }))
      });
    },

    async get_activity_detail(input: z.infer<typeof inputSchemas.get_activity_detail>) {
      const detail = await reader.readActivityDetail(input.activity_id);
      return ok({
        activity_id: input.activity_id,
        detail,
        missing: detail === null,
        streams_omitted: true
      });
    },

    async get_coach_context(input: z.infer<typeof inputSchemas.get_coach_context>) {
      if (input.days === 14) {
        try {
          return ok(await reader.readJson<JsonObject>("latest/coach_context_14d.json"));
        } catch {
          try {
            return ok(await reader.readJson<JsonObject>("coach_context_14d.json"));
          } catch {
            // Fall through to dynamic compact context.
          }
        }
      }

      const endDate = todayIso();
      const startDate = daysAgoIso(input.days - 1);
      const [daily, sleep, hrv, stress, bodyBattery, activities] = await Promise.all([
        safeCollection(reader, "daily"),
        safeCollection(reader, "sleep"),
        safeCollection(reader, "hrv"),
        safeCollection(reader, "stress"),
        safeCollection(reader, "body_battery"),
        safeCollection(reader, "activities")
      ]);
      const latestDaily = latestByDate(filterByDateRange(daily, startDate, endDate));

      return ok({
        days: input.days,
        date_range: { start: startDate, end: endDate },
        sleep: filterByDateRange(sleep, startDate, endDate),
        hrv: filterByDateRange(hrv, startDate, endDate),
        stress: filterByDateRange(stress, startDate, endDate),
        body_battery: filterByDateRange(bodyBattery, startDate, endDate),
        activities: filterByDateRange(activities, startDate, endDate),
        acute_load: latestDaily?.acute_load ?? null,
        recovery_signals: latestDaily?.recovery_hours ? [`Recovery hours currently ${latestDaily.recovery_hours}.`] : [],
        injury_notes: []
      });
    },

    async get_sync_status() {
      return ok(await readSyncStatus());
    },

    async get_latest_activity() {
      const status = await readSyncStatus();
      const latestActivityId = status.latest_activity_id;
      if (typeof latestActivityId === "string" && latestActivityId.length > 0) {
        const detail = await reader.readActivityDetail(latestActivityId);
        return ok({
          activity_id: latestActivityId,
          detail,
          missing: detail === null,
          source: "latest_sync_status"
        });
      }

      const activities = await safeCollection(reader, "activities");
      const latestActivity = latestByDate(activities);
      if (latestActivity?.id && typeof latestActivity.id === "string") {
        const detail = await reader.readActivityDetail(latestActivity.id);
        return ok({
          activity_id: latestActivity.id,
          detail: detail ?? latestActivity,
          missing: false,
          source: "activities"
        });
      }

      return ok({
        activity_id: null,
        detail: null,
        missing: true
      });
    },

    async health_check() {
      const manifest = await reader.readManifest();
      const syncStatus = await readSyncStatus();
      return ok({
        status: "ok",
        latest_data_timestamp: manifest.generated_at ?? null,
        available_date_range: manifest.date_range ?? null,
        sync_status: syncStatus?.status ?? null,
        latest_activity_id: syncStatus?.latest_activity_id ?? null
      });
    }
  };
}
