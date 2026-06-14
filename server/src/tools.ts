import { z } from "zod";
import { daysAgoIso, filterByDateRange, inclusiveDays, isIsoDate, latestByDate, todayIso } from "./date.js";
import { syncNow, runningSyncState, type SyncNowOptions } from "./syncNow.js";
import type { GarminDataReader, JsonObject } from "./types.js";
import { allActivities, activityId, analyze, latestWorkout, shapeStream, summarizeWorkout, type StreamSource } from "./workouts.js";

const isoDateSchema = z.string().refine(isIsoDate, "Use YYYY-MM-DD.");
const daysSchema = z.number().int().min(1).max(30).default(14);
const workoutDaysSchema = z.number().int().min(1).max(90).default(30);
const streamSourceSchema = z.enum(["latest", "archive", "auto"]).default("auto");
const sportCategorySchema = z.enum(["cycling", "running", "walking", "badminton", "strength", "mobility", "other"]);
const workoutFilterShape = {
  activity_types: z.array(z.string()).optional(),
  exclude_activity_types: z.array(z.string()).optional(),
  sport_categories: z.array(sportCategorySchema).optional(),
  days: workoutDaysSchema
};
const streamOptionsShape = {
  fields: z.array(z.string()).optional(),
  downsample: z.boolean().default(false),
  max_points: z.number().int().min(1).nullable().optional()
};

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
  sync_now: {
    days: z.number().int().min(1).max(30).default(7),
    force_login: z.boolean().default(false),
    activity_streams: z.boolean().default(true),
    include_raw: z.boolean().default(true)
  },
  get_latest_workout: workoutFilterShape,
  get_latest_workout_summary: workoutFilterShape,
  get_latest_workout_streams: {
    ...workoutFilterShape,
    ...streamOptionsShape
  },
  get_activity_streams: {
    activity_id: z.string().min(1),
    source: streamSourceSchema,
    ...streamOptionsShape
  },
  analyze_activity: {
    activity_id: z.string().min(1),
    analysis_type: z.enum(["general", "cycling", "running", "walking", "badminton", "strength", "mobility", "rehab"]).default("general"),
    include_streams: z.boolean().default(true),
    source: streamSourceSchema
  },
  analyze_latest_workout: {
    activity_types: z.array(z.string()).optional(),
    sport_categories: z.array(sportCategorySchema).optional(),
    analysis_type: z.enum(["general", "cycling", "running", "walking", "badminton", "strength", "mobility", "rehab"]).default("general"),
    days: workoutDaysSchema,
    include_streams: z.boolean().default(true)
  },
  get_latest_ride: {
    days: workoutDaysSchema
  },
  get_latest_ride_summary: {
    days: workoutDaysSchema
  },
  get_latest_ride_streams: {
    days: workoutDaysSchema,
    ...streamOptionsShape
  },
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
  sync_now: z.object(inputShapes.sync_now),
  get_latest_workout: z.object(inputShapes.get_latest_workout),
  get_latest_workout_summary: z.object(inputShapes.get_latest_workout_summary),
  get_latest_workout_streams: z.object(inputShapes.get_latest_workout_streams),
  get_activity_streams: z.object(inputShapes.get_activity_streams),
  analyze_activity: z.object(inputShapes.analyze_activity),
  analyze_latest_workout: z.object(inputShapes.analyze_latest_workout),
  get_latest_ride: z.object(inputShapes.get_latest_ride),
  get_latest_ride_summary: z.object(inputShapes.get_latest_ride_summary),
  get_latest_ride_streams: z.object(inputShapes.get_latest_ride_streams),
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

export function createToolHandlers(reader: GarminDataReader, options: SyncNowOptions = {}) {
  async function readSyncStatus(): Promise<JsonObject> {
    const dataDir = options.dataDir ?? process.env.GARMIN_DATA_DIR ?? process.env.SERVER_DATA_DIR;
    if (dataDir) {
      const running = await runningSyncState(dataDir);
      if (running) {
        return running;
      }
    }
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

  async function streamFor(activity_id: string, source: StreamSource = "auto") {
    return reader.readActivityStream(activity_id, source);
  }

  async function latestMatching(input: z.infer<typeof inputSchemas.get_latest_workout>) {
    const activity = latestWorkout(await allActivities(reader), input);
    const id = activity ? activityId(activity) : null;
    const stream = id ? await streamFor(id) : null;
    return { activity, id, stream };
  }

  async function latestStreamResponse(input: z.infer<typeof inputSchemas.get_latest_workout_streams>, filter = {}) {
    const activity = latestWorkout(await allActivities(reader), { ...input, ...filter });
    const id = activity ? activityId(activity) : null;
    const stream = id ? await streamFor(id) : null;
    if (!activity || !id) {
      return ok({ found: false, message: "No matching Garmin workout found." });
    }
    if (!stream) {
      return ok({
        found: false,
        activity_id: id,
        message: "No Garmin stream file found for activity_id. Run sync/backfill with activity streams enabled. Garmin MCP currently has only summary/detail data for this activity."
      });
    }
    return ok({
      found: true,
      activity_summary: summarizeWorkout(activity, stream),
      stream: shapeStream(stream, input)
    });
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
        streams_omitted: true,
        next_tool_hint: "For full Garmin streams, call get_activity_streams."
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
          source: "latest_sync_status",
          next_tool_hint: "For full Garmin streams, call get_activity_streams or get_latest_workout_streams."
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
          source: "activities",
          next_tool_hint: "For full Garmin streams, call get_activity_streams or get_latest_workout_streams."
        });
      }

      return ok({
        activity_id: null,
        detail: null,
        missing: true
      });
    },

    async sync_now(input: z.infer<typeof inputSchemas.sync_now>) {
      return ok(await syncNow(input, options));
    },

    async get_latest_workout(input: z.infer<typeof inputSchemas.get_latest_workout>) {
      const { activity, id, stream } = await latestMatching(input);
      return ok({
        found: activity !== null,
        activity_id: id,
        activity,
        summary: summarizeWorkout(activity, stream),
        has_streams: stream !== null,
        stream_available_fields: Array.isArray(stream?.fields) ? stream.fields : [],
        next_tool_hint: "For full Garmin streams, call get_latest_workout_streams or get_activity_streams."
      });
    },

    async get_latest_workout_summary(input: z.infer<typeof inputSchemas.get_latest_workout_summary>) {
      const { activity, stream } = await latestMatching(input);
      return ok(summarizeWorkout(activity, stream));
    },

    async get_latest_workout_streams(input: z.infer<typeof inputSchemas.get_latest_workout_streams>) {
      return latestStreamResponse(input);
    },

    async get_activity_streams(input: z.infer<typeof inputSchemas.get_activity_streams>) {
      const stream = await streamFor(input.activity_id, input.source);
      if (!stream) {
        return ok({
          found: false,
          activity_id: input.activity_id,
          message: "No Garmin stream file found for activity_id. Run sync/backfill with activity streams enabled. Garmin MCP currently has only summary/detail data for this activity."
        });
      }
      return ok({
        found: true,
        activity_id: input.activity_id,
        stream: shapeStream(stream, input)
      });
    },

    async analyze_activity(input: z.infer<typeof inputSchemas.analyze_activity>) {
      const stream = await streamFor(input.activity_id, input.source);
      const activities = await allActivities(reader);
      const activity = activities.find((item) => activityId(item) === input.activity_id) ?? (await reader.readActivityDetail(input.activity_id));
      return ok({
        analysis_type: input.analysis_type,
        ...analyze(activity, stream, input.include_streams)
      });
    },

    async analyze_latest_workout(input: z.infer<typeof inputSchemas.analyze_latest_workout>) {
      const activity = latestWorkout(await allActivities(reader), input);
      const id = activity ? activityId(activity) : null;
      const stream = id ? await streamFor(id) : null;
      return ok({
        analysis_type: input.analysis_type,
        activity_id: id,
        ...analyze(activity, stream, input.include_streams)
      });
    },

    async get_latest_ride(input: z.infer<typeof inputSchemas.get_latest_ride>) {
      const activity = latestWorkout(await allActivities(reader), { days: input.days, sport_categories: ["cycling"] });
      const id = activity ? activityId(activity) : null;
      const stream = id ? await streamFor(id) : null;
      return ok({
        found: activity !== null,
        activity_id: id,
        activity,
        summary: summarizeWorkout(activity, stream),
        has_streams: stream !== null,
        stream_available_fields: Array.isArray(stream?.fields) ? stream.fields : [],
        hint: "For full Garmin ride streams, call get_latest_ride_streams."
      });
    },

    async get_latest_ride_summary(input: z.infer<typeof inputSchemas.get_latest_ride_summary>) {
      const activity = latestWorkout(await allActivities(reader), { days: input.days, sport_categories: ["cycling"] });
      const id = activity ? activityId(activity) : null;
      const stream = id ? await streamFor(id) : null;
      return ok({ ...summarizeWorkout(activity, stream), next_tool_hint: "For full Garmin ride streams, call get_latest_ride_streams." });
    },

    async get_latest_ride_streams(input: z.infer<typeof inputSchemas.get_latest_ride_streams>) {
      return latestStreamResponse({ ...input, sport_categories: ["cycling"] });
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
