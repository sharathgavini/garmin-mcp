// MCP tool schemas and handlers.
//
// Keep this file as the source of truth for tool inputs/outputs. Data access,
// stream shaping, and workout calculations are delegated to helper modules
// where possible, but orchestration lives here.
import { z } from "zod";
import { daysAgoIso, filterByDateRange, inclusiveDays, isIsoDate, latestByDate, todayIso } from "./date.js";
import { classifySport } from "./sports.js";
import { syncNow, runningSyncState, type SyncNowOptions } from "./syncNow.js";
import type { GarminDataReader, JsonObject } from "./types.js";
import { allActivities, activityId, analyze, latestWorkout, shapeStream, summarizeWorkout, type StreamSource } from "./workouts.js";

const isoDateSchema = z.string().refine(isIsoDate, "Use YYYY-MM-DD.");
const optionalIsoDateSchema = z.preprocess((value) => (value === null ? undefined : value), isoDateSchema.optional());
const daysSchema = z.number().int().min(1).max(30).default(14);
const workoutDaysSchema = z.number().int().min(1).max(90).default(30);
const streamSourceSchema = z.enum(["latest", "archive", "auto"]).default("auto");
const sportCategorySchema = z.enum(["cycling", "running", "walking", "badminton", "strength", "mobility", "other"]);
const archiveRangeShape = {
  start_date: isoDateSchema,
  end_date: optionalIsoDateSchema
};
const archiveActivityFilterShape = {
  ...archiveRangeShape,
  sport_categories: z.array(sportCategorySchema).optional(),
  activity_types: z.array(z.string()).optional()
};
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
  get_archive_range_summary: archiveActivityFilterShape,
  get_activities_by_date_range: {
    ...archiveActivityFilterShape,
    limit: z.number().int().min(1).max(1000).default(100),
    include_details: z.boolean().default(false),
    include_stream_availability: z.boolean().default(true)
  },
  get_workouts_by_date_range: {
    ...archiveActivityFilterShape,
    limit: z.number().int().min(1).max(1000).default(100),
    include_details: z.boolean().default(false),
    include_stream_availability: z.boolean().default(true)
  },
  get_health_metrics_by_date_range: {
    ...archiveRangeShape,
    metrics: z.array(z.enum(["daily", "sleep", "hrv", "stress", "body_battery"])).optional()
  },
  get_sleep_for_date: {
    date: isoDateSchema,
    source: streamSourceSchema
  },
  get_hrv_for_date: {
    date: isoDateSchema,
    source: streamSourceSchema,
    include_readings: z.boolean().default(false)
  },
  get_recovery_for_date: {
    date: isoDateSchema,
    source: streamSourceSchema,
    include_readings: z.boolean().default(false)
  },
  analyze_training_period: {
    ...archiveActivityFilterShape,
    analysis_focus: z.enum(["general", "cycling", "running", "badminton", "strength", "recovery", "injury_rehab", "sleep_hrv"]).default("general"),
    include_stream_metrics: z.boolean().default(false)
  },
  compare_training_periods: {
    period_a_start: isoDateSchema,
    period_a_end: optionalIsoDateSchema,
    period_b_start: isoDateSchema,
    period_b_end: optionalIsoDateSchema,
    sport_categories: z.array(sportCategorySchema).optional(),
    metrics: z.array(z.enum(["daily", "sleep", "hrv", "stress", "body_battery", "activities"])).optional()
  },
  health_check: {}
};

// These Zod schemas validate everything that enters through MCP before handler logic runs.
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
  get_archive_range_summary: z.object(inputShapes.get_archive_range_summary).refine((input) => input.start_date <= (input.end_date ?? input.start_date), "start_date must be on or before end_date."),
  get_activities_by_date_range: z.object(inputShapes.get_activities_by_date_range).refine((input) => input.start_date <= (input.end_date ?? input.start_date), "start_date must be on or before end_date."),
  get_workouts_by_date_range: z.object(inputShapes.get_workouts_by_date_range).refine((input) => input.start_date <= (input.end_date ?? input.start_date), "start_date must be on or before end_date."),
  get_health_metrics_by_date_range: z.object(inputShapes.get_health_metrics_by_date_range).refine((input) => input.start_date <= (input.end_date ?? input.start_date), "start_date must be on or before end_date."),
  get_sleep_for_date: z.object(inputShapes.get_sleep_for_date),
  get_hrv_for_date: z.object(inputShapes.get_hrv_for_date),
  get_recovery_for_date: z.object(inputShapes.get_recovery_for_date),
  analyze_training_period: z.object(inputShapes.analyze_training_period).refine((input) => input.start_date <= (input.end_date ?? input.start_date), "start_date must be on or before end_date."),
  compare_training_periods: z
    .object(inputShapes.compare_training_periods)
    .refine((input) => input.period_a_start <= (input.period_a_end ?? input.period_a_start), "period_a_start must be on or before period_a_end.")
    .refine((input) => input.period_b_start <= (input.period_b_end ?? input.period_b_start), "period_b_start must be on or before period_b_end."),
  health_check: z.object(inputShapes.health_check)
};

export type ToolName = keyof typeof inputSchemas;

function ok(data: JsonObject): { content: Array<{ type: "text"; text: string }>; structuredContent: JsonObject } {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data
  };
}

type DateRangeInput = { start_date: string; end_date?: string; [key: string]: unknown };

function requestedRange(input: DateRangeInput): { startDate: string; endDate: string; requested_start_date: string; requested_end_date: string } {
  const endDate = input.end_date ?? input.start_date;
  return {
    startDate: input.start_date,
    endDate,
    requested_start_date: input.start_date,
    requested_end_date: endDate
  };
}

function compareRange(input: { period_a_start: string; period_a_end?: string; period_b_start: string; period_b_end?: string }) {
  return {
    periodAStart: input.period_a_start,
    periodAEnd: input.period_a_end ?? input.period_a_start,
    periodBStart: input.period_b_start,
    periodBEnd: input.period_b_end ?? input.period_b_start
  };
}

// Latest readers may not have every collection during first setup, so latest tools degrade with warnings.
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

// Activity range filters are shared by archive tools and keep sport/category matching consistent.
function filterActivities(rows: JsonObject[], input: { sport_categories?: string[]; activity_types?: string[] }): JsonObject[] {
  const types = (input.activity_types ?? []).map((item) => item.toLowerCase());
  return rows.filter((activity) => {
    const type = String(activity.type ?? activity.activity_type ?? activity.activityType ?? "").toLowerCase();
    const category = classifySport(type);
    if (types.length && !types.some((item) => type.includes(item))) {
      return false;
    }
    if (input.sport_categories?.length && !input.sport_categories.includes(category)) {
      return false;
    }
    return true;
  });
}

// Numeric summary helpers intentionally accept multiple key names because Garmin payloads vary.
function sumNumber(rows: JsonObject[], keys: string[]): number {
  return rows.reduce((sum, row) => {
    for (const key of keys) {
      const value = row[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        return sum + value;
      }
    }
    return sum;
  }, 0);
}

function avgNumber(rows: JsonObject[], keys: string[]): number | null {
  const values: number[] = [];
  for (const row of rows) {
    for (const key of keys) {
      const value = row[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        values.push(value);
        break;
      }
    }
  }
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function countsBySport(rows: JsonObject[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const activity of rows) {
    const category = classifySport(activity.type ?? activity.activity_type ?? activity.activityType);
    counts[category] = (counts[category] ?? 0) + 1;
  }
  return counts;
}

// Build the compact activity shape returned by range tools without embedding full streams.
function compactActivity(activity: JsonObject, detail: JsonObject | null, stream: JsonObject | null): JsonObject {
  return {
    id: activity.id ?? activity.activity_id ?? activity.activityId,
    type: activity.type ?? activity.activity_type ?? activity.activityType,
    sport_category: classifySport(activity.type ?? activity.activity_type ?? activity.activityType),
    date: activity.date ?? activity.start_time ?? activity.startTimeLocal ?? activity.startTimeGMT,
    distance_meters: activity.distance_meters ?? activity.distanceMeters ?? activity.distance,
    duration_seconds: activity.duration_seconds ?? activity.durationSeconds ?? activity.elapsedDuration,
    avg_hr: activity.avg_hr ?? activity.averageHR ?? activity.averageHeartRate,
    calories: activity.calories,
    training_effect: activity.training_effect ?? activity.trainingEffect,
    detail: detail ?? undefined,
    has_streams: stream !== null,
    stream_available_fields: Array.isArray(stream?.fields) ? stream.fields : []
  };
}

// Health summaries return averages opportunistically; missing metrics remain null instead of being invented.
function healthSummary(rows: JsonObject[], metric: string): JsonObject {
  return {
    metric,
    record_count: rows.length,
    date_range: rows.length ? { start: rows[0].date ?? null, end: rows[rows.length - 1].date ?? null } : null,
    averages: {
      hrv: avgNumber(rows, ["avg_overnight_hrv", "last_night_avg", "hrv", "avg_hrv", "weekly_avg"]),
      sleep_score: avgNumber(rows, ["sleep_score", "overall_score"]),
      total_sleep_seconds: avgNumber(rows, ["total_sleep_seconds"]),
      avg_sleep_stress: avgNumber(rows, ["avg_sleep_stress"]),
      avg_sleep_hr: avgNumber(rows, ["avg_heart_rate"]),
      avg_spo2: avgNumber(rows, ["avg_spo2"]),
      stress: avgNumber(rows, ["avg_stress", "stress_avg", "stress"]),
      body_battery: avgNumber(rows, ["body_battery_high", "max_body_battery", "body_battery"]),
      training_readiness: avgNumber(rows, ["training_readiness"])
    }
  };
}

// Period summaries are deliberately structured for LLM interpretation rather than final coaching advice.
function periodSummary(activities: JsonObject[], metrics: Record<string, JsonObject[]>): JsonObject {
  const totalDuration = sumNumber(activities, ["duration_seconds", "durationSeconds", "elapsedDuration"]);
  const totalDistance = sumNumber(activities, ["distance_meters", "distanceMeters", "distance"]);
  return {
    activity_volume: {
      activity_count: activities.length,
      total_duration_seconds: totalDuration,
      total_distance_meters: totalDistance,
      counts_by_sport_category: countsBySport(activities)
    },
    frequency: {
      active_days: new Set(activities.map((activity) => String(activity.date ?? "").slice(0, 10)).filter(Boolean)).size
    },
    sport_distribution: countsBySport(activities),
    sleep_hrv_recovery_context: {
      sleep: healthSummary(metrics.sleep ?? [], "sleep"),
      hrv: healthSummary(metrics.hrv ?? [], "hrv"),
      stress: healthSummary(metrics.stress ?? [], "stress"),
      body_battery: healthSummary(metrics.body_battery ?? [], "body_battery")
    },
    consistency: {
      activities_per_week_estimate: activities.length
    },
    load_spikes: [],
    intensity_distribution: {
      avg_hr: avgNumber(activities, ["avg_hr", "averageHR", "averageHeartRate"]),
      max_hr: avgNumber(activities, ["max_hr", "maxHR", "maxHeartRate"])
    }
  };
}

function delta(a: unknown, b: unknown): JsonObject {
  if (typeof a !== "number" || typeof b !== "number") {
    return { period_a: a ?? null, period_b: b ?? null, change: null, percent_change: null };
  }
  return {
    period_a: a,
    period_b: b,
    change: b - a,
    percent_change: a === 0 ? null : ((b - a) / a) * 100
  };
}

function recoveryAverage(summary: JsonObject, metric: string, key: string): unknown {
  const context = summary.sleep_hrv_recovery_context as JsonObject | undefined;
  const section = context?.[metric] as JsonObject | undefined;
  const averages = section?.averages as JsonObject | undefined;
  return averages?.[key] ?? null;
}

function firstNumber(row: JsonObject | null, keys: string[]): number | null {
  if (!row) {
    return null;
  }
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function shapedSleep(date: string, source: string, row: JsonObject | null): JsonObject {
  return {
    date,
    source,
    found: row !== null,
    data_available: row?.data_available ?? (row !== null ? true : false),
    sleep_duration_seconds: firstNumber(row, ["total_sleep_seconds"]),
    sleep_start_gmt: row?.sleep_start_gmt ?? null,
    sleep_end_gmt: row?.sleep_end_gmt ?? null,
    sleep_start_local: row?.sleep_start_local ?? null,
    sleep_end_local: row?.sleep_end_local ?? null,
    deep_sleep_seconds: firstNumber(row, ["deep_sleep_seconds"]),
    light_sleep_seconds: firstNumber(row, ["light_sleep_seconds"]),
    rem_sleep_seconds: firstNumber(row, ["rem_sleep_seconds"]),
    awake_sleep_seconds: firstNumber(row, ["awake_sleep_seconds"]),
    sleep_score: firstNumber(row, ["sleep_score", "overall_score"]),
    sleep_score_qualifier: row?.sleep_score_qualifier ?? null,
    avg_sleep_stress: firstNumber(row, ["avg_sleep_stress"]),
    avg_heart_rate: firstNumber(row, ["avg_heart_rate"]),
    lowest_spo2: firstNumber(row, ["lowest_spo2"]),
    avg_spo2: firstNumber(row, ["avg_spo2"]),
    avg_respiration: firstNumber(row, ["avg_respiration"]),
    lowest_respiration: firstNumber(row, ["lowest_respiration"]),
    highest_respiration: firstNumber(row, ["highest_respiration"]),
    body_battery_change: firstNumber(row, ["body_battery_change"]),
    nap_time_seconds: firstNumber(row, ["nap_time_seconds"]),
    naps: row?.naps ?? [],
    sleep_need: row?.sleep_need ?? null,
    sleep_alignment: row?.sleep_alignment ?? null,
    breathing_disruption_severity: row?.breathing_disruption_severity ?? null,
    raw_payload_path: row?.raw_payload_path ?? null,
    missing_fields: row?.missing_fields ?? [],
    extraction_notes: row?.extraction_notes ?? []
  };
}

function shapedHrv(date: string, source: string, row: JsonObject | null, includeReadings: boolean): JsonObject {
  const readings = Array.isArray(row?.readings) ? row.readings : [];
  const result: JsonObject = {
    date,
    source,
    found: row !== null,
    data_available: row?.data_available ?? (row !== null ? true : false),
    avg_overnight_hrv: firstNumber(row, ["avg_overnight_hrv"]),
    last_night_avg: firstNumber(row, ["last_night_avg"]),
    last_night_5min_high: firstNumber(row, ["last_night_5min_high"]),
    weekly_avg: firstNumber(row, ["weekly_avg"]),
    hrv_status: row?.hrv_status ?? row?.status ?? null,
    feedback_phrase: row?.feedback_phrase ?? null,
    baseline_balanced_low: firstNumber(row, ["baseline_balanced_low"]),
    baseline_balanced_upper: firstNumber(row, ["baseline_balanced_upper"]),
    baseline_low_upper: firstNumber(row, ["baseline_low_upper"]),
    reading_count: firstNumber(row, ["reading_count"]) ?? readings.length,
    min_hrv: firstNumber(row, ["min_hrv"]),
    max_hrv: firstNumber(row, ["max_hrv"]),
    readings_included: includeReadings,
    raw_payload_path: row?.raw_payload_path ?? null
  };
  if (includeReadings) {
    result.readings = readings;
  }
  return result;
}

function streamExtractionNotice(stream: JsonObject | null): JsonObject {
  if (!stream) {
    return {};
  }
  const fields = Array.isArray(stream.fields) ? stream.fields.map(String) : [];
  const availability = stream.availability && typeof stream.availability === "object" ? (stream.availability as JsonObject) : {};
  const missing = Array.isArray(availability.missing_fields) ? availability.missing_fields : [];
  const sampleCount = typeof stream.sample_count === "number" ? stream.sample_count : 0;
  if (sampleCount === 0) {
    return {
      extraction_status: stream.extraction_status ?? "no_samples_found",
      checked_payloads: stream.checked_payloads ?? [],
      recommendation: "Run inspect_activity for this activity to diagnose Garmin payload availability."
    };
  }
  if (missing.length > 0) {
    return {
      partial_stream: true,
      available_fields: fields,
      missing_fields: missing,
      recommendation: "Run inspect_activity for this activity to diagnose Garmin payload availability."
    };
  }
  return {
    extraction_status: stream.extraction_status ?? "ok"
  };
}

export function createToolHandlers(reader: GarminDataReader, options: SyncNowOptions = {}) {
  // Sync status first checks for an active local lock so users can poll after sync_now.
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

  // Stream lookup supports latest/archive/auto, with local readers checking latest first for auto.
  async function streamFor(activity_id: string, source: StreamSource = "auto") {
    return reader.readActivityStream(activity_id, source);
  }

  async function collectionRowForDate(collection: string, date: string, source: StreamSource = "auto") {
    if (source === "latest" || source === "auto") {
      const rows = await safeCollection(reader, collection);
      const row = rows.find((item) => item.date === date) ?? null;
      if (row || source === "latest") {
        return { row, source: "latest" };
      }
    }
    const result = await reader.readArchiveCollection(collection, date, date);
    return { row: result.rows.find((item) => item.date === date) ?? null, source: "archive", coverage: result.coverage };
  }

  // Shared latest-workout lookup for generic workout tools.
  async function latestMatching(input: z.infer<typeof inputSchemas.get_latest_workout>) {
    const activity = latestWorkout(await allActivities(reader), input);
    const id = activity ? activityId(activity) : null;
    const stream = id ? await streamFor(id) : null;
    return { activity, id, stream };
  }

  // Shared stream response for latest workout and latest ride stream tools.
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
      extraction: streamExtractionNotice(stream),
      stream: shapeStream(stream, input)
    });
  }

  // Archive helpers load only the month partitions needed for the requested date range.
  async function archiveMetrics(startDate: string, endDate: string, metrics = ["daily", "sleep", "hrv", "stress", "body_battery"]) {
    const entries = await Promise.all(metrics.map(async (metric) => [metric, await reader.readArchiveCollection(metric, startDate, endDate)] as const));
    return Object.fromEntries(entries);
  }

  async function archiveActivities(input: z.infer<typeof inputSchemas.get_activities_by_date_range>) {
    const { startDate, endDate } = requestedRange(input);
    const result = await reader.readArchiveCollection("activities", startDate, endDate);
    const activities = filterActivities(result.rows, input).sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
    return { result, activities };
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
        extraction: streamExtractionNotice(stream),
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

    async get_archive_range_summary(input: z.infer<typeof inputSchemas.get_archive_range_summary>) {
      const range = requestedRange(input);
      const [{ result: activityResult, activities }, metrics] = await Promise.all([
        archiveActivities({ ...input, limit: 1000, include_details: false, include_stream_availability: false }),
        archiveMetrics(range.startDate, range.endDate)
      ]);
      const coverage = {
        activities: activityResult.coverage,
        daily: metrics.daily.coverage,
        sleep: metrics.sleep.coverage,
        hrv: metrics.hrv.coverage,
        stress: metrics.stress.coverage,
        body_battery: metrics.body_battery.coverage
      };
      return ok({
        requested_start_date: range.requested_start_date,
        requested_end_date: range.requested_end_date,
        date_range: { start: range.startDate, end: range.endDate },
        dataset_coverage: coverage,
        missing_date_warnings: Object.fromEntries(Object.entries(coverage).map(([name, item]) => [name, item.warnings])),
        activity_counts_by_sport_category: countsBySport(activities),
        total_duration_seconds: sumNumber(activities, ["duration_seconds", "durationSeconds", "elapsedDuration"]),
        total_distance_meters: sumNumber(activities, ["distance_meters", "distanceMeters", "distance"]),
        sleep_trend_summary: healthSummary(metrics.sleep.rows, "sleep"),
        hrv_trend_summary: healthSummary(metrics.hrv.rows, "hrv"),
        stress_trend_summary: healthSummary(metrics.stress.rows, "stress"),
        body_battery_trend_summary: healthSummary(metrics.body_battery.rows, "body_battery"),
        training_recovery_notes: filterByDateRange(metrics.daily.rows, range.startDate, range.endDate).map((row) => ({
          date: row.date,
          training_readiness: row.training_readiness,
          acute_load: row.acute_load,
          recovery_hours: row.recovery_hours
        }))
      });
    },

    async get_activities_by_date_range(input: z.infer<typeof inputSchemas.get_activities_by_date_range>) {
      const range = requestedRange(input);
      const { result, activities } = await archiveActivities(input);
      const limited = activities.slice(0, input.limit);
      const enriched = await Promise.all(
        limited.map(async (activity) => {
          const id = activityId(activity);
          const [detail, stream] = await Promise.all([
            input.include_details && id ? reader.readActivityDetail(id) : Promise.resolve(null),
            input.include_stream_availability && id ? streamFor(id, "archive") : Promise.resolve(null)
          ]);
          return compactActivity(activity, detail, stream);
        })
      );
      return ok({
        requested_start_date: range.requested_start_date,
        requested_end_date: range.requested_end_date,
        date_range: { start: range.startDate, end: range.endDate },
        total_matches: activities.length,
        returned: enriched.length,
        limit: input.limit,
        coverage: result.coverage,
        activities: enriched
      });
    },

    async get_workouts_by_date_range(input: z.infer<typeof inputSchemas.get_workouts_by_date_range>) {
      const range = requestedRange(input);
      const { result, activities } = await archiveActivities(input);
      const limited = activities.slice(0, input.limit);
      const enriched = await Promise.all(
        limited.map(async (activity) => {
          const id = activityId(activity);
          const [detail, stream] = await Promise.all([
            input.include_details && id ? reader.readActivityDetail(id) : Promise.resolve(null),
            input.include_stream_availability && id ? streamFor(id, "archive") : Promise.resolve(null)
          ]);
          return compactActivity(activity, detail, stream);
        })
      );
      return ok({
        requested_start_date: range.requested_start_date,
        requested_end_date: range.requested_end_date,
        date_range: { start: range.startDate, end: range.endDate },
        total_matches: activities.length,
        returned: enriched.length,
        limit: input.limit,
        coverage: result.coverage,
        workouts: enriched
      });
    },

    async get_health_metrics_by_date_range(input: z.infer<typeof inputSchemas.get_health_metrics_by_date_range>) {
      const range = requestedRange(input);
      const metrics = input.metrics ?? ["daily", "sleep", "hrv", "stress", "body_battery"];
      const results = await archiveMetrics(range.startDate, range.endDate, metrics);
      return ok({
        requested_start_date: range.requested_start_date,
        requested_end_date: range.requested_end_date,
        date_range: { start: range.startDate, end: range.endDate },
        metrics: Object.fromEntries(Object.entries(results).map(([name, result]) => [name, { records: result.rows, coverage: result.coverage }])),
        warnings: Object.fromEntries(Object.entries(results).map(([name, result]) => [name, result.coverage.warnings]))
      });
    },

    async get_sleep_for_date(input: z.infer<typeof inputSchemas.get_sleep_for_date>) {
      const result = await collectionRowForDate("sleep", input.date, input.source);
      return ok(shapedSleep(input.date, result.source, result.row));
    },

    async get_hrv_for_date(input: z.infer<typeof inputSchemas.get_hrv_for_date>) {
      const result = await collectionRowForDate("hrv", input.date, input.source);
      return ok(shapedHrv(input.date, result.source, result.row, input.include_readings));
    },

    async get_recovery_for_date(input: z.infer<typeof inputSchemas.get_recovery_for_date>) {
      const [sleepResult, hrvResult, dailyResult, stressResult, bodyBatteryResult] = await Promise.all([
        collectionRowForDate("sleep", input.date, input.source),
        collectionRowForDate("hrv", input.date, input.source),
        collectionRowForDate("daily", input.date, input.source),
        collectionRowForDate("stress", input.date, input.source),
        collectionRowForDate("body_battery", input.date, input.source)
      ]);
      const daily = dailyResult.row;
      const stress = stressResult.row;
      const bodyBattery = bodyBatteryResult.row;
      return ok({
        date: input.date,
        source: {
          sleep: sleepResult.source,
          hrv: hrvResult.source,
          daily: dailyResult.source,
          stress: stressResult.source,
          body_battery: bodyBatteryResult.source
        },
        sleep: shapedSleep(input.date, sleepResult.source, sleepResult.row),
        hrv: shapedHrv(input.date, hrvResult.source, hrvResult.row, input.include_readings),
        body_battery: bodyBattery ?? null,
        resting_hr: daily?.resting_hr ?? daily?.restingHeartRate ?? null,
        training_readiness: daily?.training_readiness ?? null,
        recovery_hours: daily?.recovery_hours ?? null,
        acute_load: daily?.acute_load ?? null,
        stress: stress ?? null,
        avg_stress: stress?.avg_stress ?? stress?.stress_avg ?? stress?.stress ?? null
      });
    },

    async analyze_training_period(input: z.infer<typeof inputSchemas.analyze_training_period>) {
      const range = requestedRange(input);
      const [{ result: activityResult, activities }, metrics] = await Promise.all([
        archiveActivities({ ...input, limit: 1000, include_details: false, include_stream_availability: false }),
        archiveMetrics(range.startDate, range.endDate)
      ]);
      let streamMetrics: JsonObject | null = null;
      if (input.include_stream_metrics) {
        const streams = await Promise.all(activities.slice(0, 100).map(async (activity) => {
          const id = activityId(activity);
          return id ? streamFor(id, "archive") : null;
        }));
        streamMetrics = {
          activities_checked: Math.min(activities.length, 100),
          streams_found: streams.filter(Boolean).length,
          available_fields: [...new Set(streams.flatMap((stream) => (Array.isArray(stream?.fields) ? stream.fields.map(String) : [])))]
        };
      }
      return ok({
        requested_start_date: range.requested_start_date,
        requested_end_date: range.requested_end_date,
        date_range: { start: range.startDate, end: range.endDate },
        analysis_focus: input.analysis_focus,
        ...periodSummary(activities, Object.fromEntries(Object.entries(metrics).map(([name, result]) => [name, result.rows]))),
        stream_metrics: streamMetrics,
        missing_data_warnings: [
          ...activityResult.coverage.warnings,
          ...Object.values(metrics).flatMap((result) => result.coverage.warnings)
        ]
      });
    },

    async compare_training_periods(input: z.infer<typeof inputSchemas.compare_training_periods>) {
      const ranges = compareRange(input);
      const metrics = input.metrics ?? ["daily", "sleep", "hrv", "stress", "body_battery", "activities"];
      async function readPeriod(start: string, end: string) {
        const activityData = await reader.readArchiveCollection("activities", start, end);
        const activities = filterActivities(activityData.rows, { sport_categories: input.sport_categories });
        const healthMetricNames = metrics.filter((metric) => metric !== "activities");
        const health = await archiveMetrics(start, end, healthMetricNames);
        return { activities, health, activityCoverage: activityData.coverage, summary: periodSummary(activities, Object.fromEntries(Object.entries(health).map(([name, result]) => [name, result.rows]))) };
      }
      const [a, b] = await Promise.all([readPeriod(ranges.periodAStart, ranges.periodAEnd), readPeriod(ranges.periodBStart, ranges.periodBEnd)]);
      const aVolume = a.summary.activity_volume as JsonObject;
      const bVolume = b.summary.activity_volume as JsonObject;
      return ok({
        requested_period_a_start: ranges.periodAStart,
        requested_period_a_end: ranges.periodAEnd,
        requested_period_b_start: ranges.periodBStart,
        requested_period_b_end: ranges.periodBEnd,
        period_a: { start: ranges.periodAStart, end: ranges.periodAEnd },
        period_b: { start: ranges.periodBStart, end: ranges.periodBEnd },
        activity_count_changes: delta(aVolume.activity_count, bVolume.activity_count),
        duration_changes: delta(aVolume.total_duration_seconds, bVolume.total_duration_seconds),
        distance_changes: delta(aVolume.total_distance_meters, bVolume.total_distance_meters),
        sleep_hrv_changes: {
          sleep_score: delta(recoveryAverage(a.summary, "sleep", "sleep_score"), recoveryAverage(b.summary, "sleep", "sleep_score")),
          hrv: delta(recoveryAverage(a.summary, "hrv", "hrv"), recoveryAverage(b.summary, "hrv", "hrv"))
        },
        stress_body_battery_changes: {
          stress: delta(recoveryAverage(a.summary, "stress", "stress"), recoveryAverage(b.summary, "stress", "stress")),
          body_battery: delta(recoveryAverage(a.summary, "body_battery", "body_battery"), recoveryAverage(b.summary, "body_battery", "body_battery"))
        },
        sport_specific_differences: {
          period_a: aVolume.counts_by_sport_category,
          period_b: bVolume.counts_by_sport_category
        },
        recovery_differences: {
          period_a: a.summary.sleep_hrv_recovery_context,
          period_b: b.summary.sleep_hrv_recovery_context
        },
        warnings: [
          ...a.activityCoverage.warnings,
          ...b.activityCoverage.warnings,
          ...Object.values(a.health).flatMap((result) => result.coverage.warnings),
          ...Object.values(b.health).flatMap((result) => result.coverage.warnings)
        ]
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
