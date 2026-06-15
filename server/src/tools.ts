// MCP tool schemas and handlers.
//
// Keep this file as the source of truth for tool inputs/outputs. Data access,
// stream shaping, and workout calculations are delegated to helper modules
// where possible, but orchestration lives here.
import { z } from "zod";
import { daysAgoIso, filterByDateRange, inclusiveDays, isIsoDate, latestByDate, todayIso } from "./date.js";
import { classifySport } from "./sports.js";
import { syncNow, runningSyncState, type SyncNowOptions } from "./syncNow.js";
import type { GarminDataReader, JsonObject, Manifest } from "./types.js";
import { allActivities, activityId, analyze, expectedStreamFields, latestWorkout, normalizeRequestedStreamFields, shapeStream, streamCompleteness, streamFieldAliases, summarizeWorkout, type StreamSource } from "./workouts.js";

const isoDateSchema = z.string().refine(isIsoDate, "Use YYYY-MM-DD.");
// Claude and MCP Inspector may send null for single-day range end dates; the
// schema must advertise nullability instead of only fixing it in handlers.
const optionalIsoDateSchema = isoDateSchema.nullable().optional();
const daysSchema = z.number().int().min(1).max(30).default(14);
const workoutDaysSchema = z.number().int().min(1).max(90).default(30);
const streamSourceSchema = z.enum(["latest", "archive", "auto"]).default("auto");
const sportCategorySchema = z.enum(["cycling", "running", "walking", "badminton", "strength", "mobility", "other"]);
const dateRangePresetSchema = z.enum(["today", "yesterday", "last_7_days", "last_14_days", "last_30_days", "last_90_days", "this_week", "last_week", "this_month", "last_month", "year_to_date"]);
const archiveRangeShape = {
  start_date: isoDateSchema.optional(),
  end_date: optionalIsoDateSchema
};
const presetRangeShape = {
  ...archiveRangeShape,
  date_range_preset: dateRangePresetSchema.optional()
};
const archiveActivityFilterShape = {
  ...presetRangeShape,
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
  max_points: z.number().int().min(1).nullable().optional(),
  resolution_seconds: z.number().int().min(1).nullable().optional()
};

export const inputShapes = {
  get_today_summary: {
    date: isoDateSchema.optional()
  },
  get_range_summary: {
    ...presetRangeShape
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
  get_data_capabilities: {},
  get_system_status: {},
  get_tool_guide: {
    intent: z.string().optional()
  },
  audit_data_quality: {
    ...presetRangeShape,
    datasets: z.array(z.enum(["daily", "sleep", "hrv", "stress", "body_battery", "activities", "activity_details", "activity_streams"])).optional(),
    source: streamSourceSchema
  },
  get_metric_inventory: {
    ...presetRangeShape,
    source: streamSourceSchema
  },
  get_recovery_dashboard: {
    ...presetRangeShape
  },
  get_training_load_dashboard: {
    ...presetRangeShape,
    sport_categories: z.array(sportCategorySchema).optional()
  },
  detect_training_anomalies: {
    ...presetRangeShape,
    focus: z.enum(["general", "recovery", "injury", "cycling", "running", "badminton", "strength"]).default("general")
  },
  get_schema_version: {},
  repair_activity_details_status: {},
  get_latest_activity: {},
  sync_now: {
    days: z.number().int().min(1).max(30).default(7),
    force_login: z.boolean().default(false),
    force_refresh: z.boolean().default(false),
    full: z.boolean().default(false),
    force: z.boolean().default(false),
    lookback_days: z.number().int().min(0).max(14).default(2),
    min_interval_minutes: z.number().int().min(0).max(1440).default(5),
    activity_streams: z.boolean().default(true),
    include_raw: z.boolean().default(true)
  },
  get_sync_completeness: {},
  get_dataset_status: {},
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
    period_a_start: isoDateSchema.optional(),
    period_a_end: optionalIsoDateSchema,
    period_a_preset: dateRangePresetSchema.optional(),
    period_b_start: isoDateSchema,
    period_b_end: optionalIsoDateSchema,
    period_b_preset: dateRangePresetSchema.optional(),
    sport_categories: z.array(sportCategorySchema).optional(),
    metrics: z.array(z.enum(["daily", "sleep", "hrv", "stress", "body_battery", "activities"])).optional()
  },
  health_check: {}
};

function hasRangeInput(input: { start_date?: string; date_range_preset?: string }): boolean {
  return Boolean(input.start_date || input.date_range_preset);
}

function orderedRangeInput(input: { start_date?: string; end_date?: string | null }): boolean {
  return !input.start_date || input.start_date <= (input.end_date ?? input.start_date);
}

function presetRangeSchema<T extends z.ZodRawShape>(shape: T, maxDays?: number): z.ZodTypeAny {
  let schema: z.ZodTypeAny = z.object(shape)
    .refine(hasRangeInput, "Provide start_date or date_range_preset.")
    .refine(orderedRangeInput, "start_date must be on or before end_date.");
  if (maxDays) {
    schema = schema.refine((input) => {
      if (!input.start_date) {
        return true;
      }
      return inclusiveDays(input.start_date, input.end_date ?? input.start_date) <= maxDays;
    }, `Date range cannot exceed ${maxDays} days.`);
  }
  return schema;
}

// These Zod schemas validate everything that enters through MCP before handler logic runs.
export const inputSchemas = {
  get_today_summary: z.object(inputShapes.get_today_summary),
  get_range_summary: presetRangeSchema(inputShapes.get_range_summary, 30),
  get_recent_activities: z.object(inputShapes.get_recent_activities),
  get_activity_detail: z.object(inputShapes.get_activity_detail),
  get_coach_context: z.object(inputShapes.get_coach_context),
  get_sync_status: z.object(inputShapes.get_sync_status),
  get_data_capabilities: z.object(inputShapes.get_data_capabilities),
  get_system_status: z.object(inputShapes.get_system_status),
  get_tool_guide: z.object(inputShapes.get_tool_guide),
  audit_data_quality: presetRangeSchema(inputShapes.audit_data_quality),
  get_metric_inventory: z.object(inputShapes.get_metric_inventory),
  get_recovery_dashboard: presetRangeSchema(inputShapes.get_recovery_dashboard),
  get_training_load_dashboard: presetRangeSchema(inputShapes.get_training_load_dashboard),
  detect_training_anomalies: presetRangeSchema(inputShapes.detect_training_anomalies),
  get_schema_version: z.object(inputShapes.get_schema_version),
  repair_activity_details_status: z.object(inputShapes.repair_activity_details_status),
  get_latest_activity: z.object(inputShapes.get_latest_activity),
  sync_now: z.object(inputShapes.sync_now),
  get_sync_completeness: z.object(inputShapes.get_sync_completeness),
  get_dataset_status: z.object(inputShapes.get_dataset_status),
  get_latest_workout: z.object(inputShapes.get_latest_workout),
  get_latest_workout_summary: z.object(inputShapes.get_latest_workout_summary),
  get_latest_workout_streams: z.object(inputShapes.get_latest_workout_streams),
  get_activity_streams: z.object(inputShapes.get_activity_streams),
  analyze_activity: z.object(inputShapes.analyze_activity),
  analyze_latest_workout: z.object(inputShapes.analyze_latest_workout),
  get_latest_ride: z.object(inputShapes.get_latest_ride),
  get_latest_ride_summary: z.object(inputShapes.get_latest_ride_summary),
  get_latest_ride_streams: z.object(inputShapes.get_latest_ride_streams),
  get_archive_range_summary: presetRangeSchema(inputShapes.get_archive_range_summary),
  get_activities_by_date_range: presetRangeSchema(inputShapes.get_activities_by_date_range),
  get_workouts_by_date_range: presetRangeSchema(inputShapes.get_workouts_by_date_range),
  get_health_metrics_by_date_range: presetRangeSchema(inputShapes.get_health_metrics_by_date_range),
  get_sleep_for_date: z.object(inputShapes.get_sleep_for_date),
  get_hrv_for_date: z.object(inputShapes.get_hrv_for_date),
  get_recovery_for_date: z.object(inputShapes.get_recovery_for_date),
  analyze_training_period: presetRangeSchema(inputShapes.analyze_training_period),
  compare_training_periods: z
    .object(inputShapes.compare_training_periods)
    .refine((input) => Boolean(input.period_a_start || input.period_a_preset), "Provide period_a_start or period_a_preset.")
    .refine((input) => Boolean(input.period_b_start || input.period_b_preset), "Provide period_b_start or period_b_preset.")
    .refine((input) => !input.period_a_start || input.period_a_start <= (input.period_a_end ?? input.period_a_start), "period_a_start must be on or before period_a_end.")
    .refine((input) => !input.period_b_start || input.period_b_start <= (input.period_b_end ?? input.period_b_start), "period_b_start must be on or before period_b_end."),
  health_check: z.object(inputShapes.health_check)
};

export type ToolName = keyof typeof inputSchemas;

function ok(data: JsonObject): { content: Array<{ type: "text"; text: string }>; structuredContent: JsonObject } {
  // Every MCP response gets source metadata unless the handler supplied richer source data.
  const structuredContent = "source" in data || "sources_used" in data ? data : { source: "latest", ...data };
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent
  };
}

function toolError(error_code: string, message: string, extra: JsonObject = {}) {
  return ok({ error: true, error_code, message, ...extra });
}

type DateRangePreset = z.infer<typeof dateRangePresetSchema>;
type DateRangeInput = { start_date?: string; end_date?: string | null; date_range_preset?: DateRangePreset; [key: string]: unknown };
const healthDatasets = ["daily", "sleep", "hrv", "stress", "body_battery"];

function localDateParts(date = new Date()): { year: number; month: number; day: number } {
  const timeZone = process.env.TZ || "Asia/Kolkata";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value)
  };
}

function localIsoFromDate(date: Date): string {
  const timeZone = process.env.TZ || "Asia/Kolkata";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

function addDaysIso(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function resolveDateRangePreset(preset: DateRangePreset, now = new Date()): { startDate: string; endDate: string } {
  const today = localIsoFromDate(now);
  const parts = localDateParts(now);
  const current = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const weekday = current.getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  if (preset === "today") return { startDate: today, endDate: today };
  if (preset === "yesterday") {
    const yesterday = addDaysIso(today, -1);
    return { startDate: yesterday, endDate: yesterday };
  }
  if (preset === "last_7_days") return { startDate: addDaysIso(today, -6), endDate: today };
  if (preset === "last_14_days") return { startDate: addDaysIso(today, -13), endDate: today };
  if (preset === "last_30_days") return { startDate: addDaysIso(today, -29), endDate: today };
  if (preset === "last_90_days") return { startDate: addDaysIso(today, -89), endDate: today };
  if (preset === "this_week") return { startDate: addDaysIso(today, mondayOffset), endDate: today };
  if (preset === "last_week") {
    const endDate = addDaysIso(today, mondayOffset - 1);
    return { startDate: addDaysIso(endDate, -6), endDate };
  }
  if (preset === "this_month") return { startDate: `${parts.year}-${String(parts.month).padStart(2, "0")}-01`, endDate: today };
  if (preset === "last_month") {
    const firstThisMonth = new Date(Date.UTC(parts.year, parts.month - 1, 1));
    firstThisMonth.setUTCDate(0);
    const year = firstThisMonth.getUTCFullYear();
    const month = String(firstThisMonth.getUTCMonth() + 1).padStart(2, "0");
    const endDate = firstThisMonth.toISOString().slice(0, 10);
    return { startDate: `${year}-${month}-01`, endDate };
  }
  return { startDate: `${parts.year}-01-01`, endDate: today };
}

function requestedRange(input: DateRangeInput, defaultPreset?: DateRangePreset): { startDate: string; endDate: string; requested_start_date: string | null; requested_end_date: string; defaults_applied: JsonObject; date_range_preset: string | null; resolved_start_date: string; resolved_end_date: string } {
  // Defaulting happens after validation so handlers never silently collapse ranges.
  const preset = input.date_range_preset ?? defaultPreset;
  const presetRange = preset ? resolveDateRangePreset(preset) : null;
  const startDate = input.start_date ?? presetRange?.startDate;
  if (!startDate) {
    throw new Error("Provide start_date or date_range_preset.");
  }
  const endDate = input.end_date ?? presetRange?.endDate ?? startDate;
  return {
    startDate,
    endDate,
    requested_start_date: input.start_date ?? null,
    requested_end_date: endDate,
    defaults_applied: {
      ...(input.date_range_preset ? { date_range_preset: "resolved_to_dates" } : {}),
      ...(!input.start_date && preset ? { start_date: "date_range_preset" } : {}),
      ...(input.end_date == null ? { end_date: input.start_date ? "start_date" : "date_range_preset" } : {})
    },
    date_range_preset: preset ?? null,
    resolved_start_date: startDate,
    resolved_end_date: endDate
  };
}

function compareRange(input: { period_a_start?: string; period_a_end?: string | null; period_a_preset?: DateRangePreset; period_b_start?: string; period_b_end?: string | null; period_b_preset?: DateRangePreset }) {
  const periodA = requestedRange({ start_date: input.period_a_start, end_date: input.period_a_end, date_range_preset: input.period_a_preset });
  const periodB = requestedRange({ start_date: input.period_b_start, end_date: input.period_b_end, date_range_preset: input.period_b_preset });
  return {
    periodAStart: periodA.startDate,
    periodAEnd: periodA.endDate,
    periodBStart: periodB.startDate,
    periodBEnd: periodB.endDate,
    defaults_applied: {
      ...(input.period_a_end == null ? { period_a_end: input.period_a_start ? "period_a_start" : "period_a_preset" } : {}),
      ...(input.period_b_end == null ? { period_b_end: input.period_b_start ? "period_b_start" : "period_b_preset" } : {})
    },
    period_a_preset: input.period_a_preset ?? null,
    period_b_preset: input.period_b_preset ?? null
  };
}

function rowDate(row: JsonObject): string | null {
  const value = row.date ?? row.start_time ?? row.startTimeLocal ?? row.startTimeGMT;
  return typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : null;
}

function dateBounds(rows: JsonObject[]): { start: string | null; end: string | null } {
  const dates = rows.map(rowDate).filter((date): date is string => date !== null).sort();
  return { start: dates[0] ?? null, end: dates[dates.length - 1] ?? null };
}

function eachDate(startDate: string, endDate: string): string[] {
  if (!isIsoDate(startDate) || !isIsoDate(endDate) || startDate > endDate) {
    return [];
  }
  const dates: string[] = [];
  const current = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

function datasetRecordStatus(rows: JsonObject[]): JsonObject {
  return {
    latest_date: dateBounds(rows).end,
    record_count: rows.length
  };
}

function dateCoverage(startDate: string, endDate: string, rows: JsonObject[]): JsonObject {
  const daysRequested = inclusiveDays(startDate, endDate);
  const dates = new Set(rows.map(rowDate).filter((date): date is string => date !== null));
  const sortedDates = [...dates].sort();
  const missingDates = eachDate(startDate, endDate).filter((date) => !dates.has(date));
  const daysFound = dates.size;
  return {
    days_requested: daysRequested,
    days_found: daysFound,
    completeness_percent: daysRequested > 0 ? Math.round((daysFound / daysRequested) * 10000) / 100 : 0,
    missing_dates: missingDates.slice(0, 100),
    missing_dates_truncated: Math.max(0, missingDates.length - 100),
    available_start_date: sortedDates[0] ?? null,
    available_end_date: sortedDates[sortedDates.length - 1] ?? null
  };
}

function rangeMetadata(range: ReturnType<typeof requestedRange>, rows: JsonObject[]): JsonObject {
  return {
    requested_start_date: range.requested_start_date,
    requested_end_date: range.requested_end_date,
    date_range_preset: range.date_range_preset,
    resolved_start_date: range.resolved_start_date,
    resolved_end_date: range.resolved_end_date,
    coverage: dateCoverage(range.startDate, range.endDate, rows),
    defaults_applied: range.defaults_applied,
    source: "archive"
  };
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.map((value) => String(value ?? "")).filter(Boolean))].sort();
}

function rowsAreDateOnly(rows: JsonObject[]): boolean {
  return rows.length > 0 && rows.every((row) => Object.keys(row).every((key) => ["date", "source", "data_available"].includes(key)));
}

function datasetCoverage(name: string, rows: JsonObject[], historyStart: string | null, historyEnd: string | null): JsonObject {
  return {
    dataset: name,
    available: rows.length > 0,
    record_count: rows.length,
    date_bounds: dateBounds(rows),
    coverage: historyStart && historyEnd ? dateCoverage(historyStart, historyEnd, rows) : null,
    date_only_normalization: rowsAreDateOnly(rows)
  };
}

function recoveryReadiness(sleep: JsonObject | null, hrv: JsonObject | null, stress: JsonObject | null, bodyBattery: JsonObject | null): JsonObject {
  // This is the AI-facing recovery contract: if any required signal is absent,
  // clients should say what is missing instead of pretending recovery is complete.
  const missing: string[] = [];
  if (!firstNumber(sleep, ["sleep_score", "score"])) missing.push("sleep_score");
  if (!firstNumber(sleep, ["total_sleep_seconds"])) missing.push("sleep_duration");
  if (!firstNumber(sleep, ["deep_sleep_seconds"])) missing.push("deep_sleep");
  if (!firstNumber(sleep, ["light_sleep_seconds"])) missing.push("light_sleep");
  if (!firstNumber(sleep, ["rem_sleep_seconds"])) missing.push("rem_sleep");
  if (!firstNumber(sleep, ["avg_sleep_stress"])) missing.push("overnight_stress");
  if (!firstNumber(sleep, ["avg_spo2"])) missing.push("overnight_spo2");
  if (!firstNumber(sleep, ["avg_respiration"])) missing.push("overnight_respiration");
  if (!firstNumber(sleep, ["body_battery_change", "body_battery_recharge"])) missing.push("body_battery_change");
  if (!firstNumber(hrv, ["avg_overnight_hrv", "last_night_avg", "overnight_avg"])) missing.push("overnight_hrv");
  if (!hrv?.hrv_status && !hrv?.status) missing.push("hrv_status");
  if (!firstNumber(hrv, ["baseline_balanced_low", "baseline_balanced_upper", "baseline_low_upper"])) missing.push("hrv_baseline");
  if (!firstNumber(hrv, ["weekly_avg", "seven_day_avg"])) missing.push("weekly_hrv");
  if (!stress) missing.push("daily_stress");
  if (!bodyBattery) missing.push("body_battery");
  return {
    full_recovery_data_available: missing.length === 0,
    missing
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
  // Activity filters support both raw Garmin type strings and normalized sport buckets.
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

function maxSeverity(issues: Array<{ severity: string }>): string {
  if (issues.some((issue) => issue.severity === "critical")) return "critical";
  if (issues.some((issue) => issue.severity === "warning")) return "warning";
  return "ok";
}

function observedFields(rows: JsonObject[]): string[] {
  return uniqueStrings(rows.flatMap((row) => Object.keys(row)));
}

function fieldPresence(rows: JsonObject[], fields: string[]): JsonObject {
  return Object.fromEntries(fields.map((field) => [field, rows.some((row) => row[field] !== undefined)]));
}

function average(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
}

function minNumber(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return present.length ? Math.min(...present) : null;
}

function maxNumber(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return present.length ? Math.max(...present) : null;
}

function weekKey(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((value.getTime() - yearStart.getTime()) / (24 * 60 * 60 * 1000)) + 1) / 7);
  return `${value.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function durationBySport(rows: JsonObject[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const activity of rows) {
    const category = classifySport(activity.type ?? activity.activity_type ?? activity.activityType);
    totals[category] = (totals[category] ?? 0) + (firstNumber(activity, ["duration_seconds", "durationSeconds", "elapsedDuration"]) ?? 0);
  }
  return totals;
}

function weeklyActivityTotals(rows: JsonObject[]): JsonObject[] {
  const totals = new Map<string, { week: string; activity_count: number; duration_seconds: number; distance_meters: number }>();
  for (const row of rows) {
    const date = rowDate(row);
    if (!date) continue;
    const key = weekKey(date);
    const current = totals.get(key) ?? { week: key, activity_count: 0, duration_seconds: 0, distance_meters: 0 };
    current.activity_count += 1;
    current.duration_seconds += firstNumber(row, ["duration_seconds", "durationSeconds", "elapsedDuration"]) ?? 0;
    current.distance_meters += firstNumber(row, ["distance_meters", "distanceMeters", "distance"]) ?? 0;
    totals.set(key, current);
  }
  return [...totals.values()].sort((a, b) => a.week.localeCompare(b.week));
}

function dataFreshnessHours(latestDate: string | null): number | null {
  if (!latestDate) return null;
  return Math.max(0, Math.round(((Date.parse(`${todayIso()}T00:00:00Z`) - Date.parse(`${latestDate}T00:00:00Z`)) / (60 * 60 * 1000)) * 10) / 10);
}

function missingDaysForRows(startDate: string, endDate: string, rows: JsonObject[]): string[] {
  const dates = new Set(rows.map(rowDate).filter((date): date is string => date !== null));
  return eachDate(startDate, endDate).filter((date) => !dates.has(date));
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
  // Use averages only as summaries; detailed rows remain available to the caller.
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
  // Period summaries are broad enough for comparison without dumping every raw row.
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
  // Surface extraction problems in natural-language-friendly fields for MCP clients.
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
    // Single-date tools prefer latest data, then fall back to archive when source is auto.
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
    const fieldCheck = normalizeRequestedStreamFields(input.fields);
    if (fieldCheck.invalid_fields.length > 0) {
      return toolError("INVALID_FIELD_NAME", "One or more requested stream fields are not valid.", {
        param: "fields",
        received: fieldCheck.invalid_fields,
        valid_values: fieldCheck.valid_values,
        hint: "Use canonical stream fields or accepted aliases such as speed, altitude, and distance."
      });
    }
    const activity = latestWorkout(await allActivities(reader), { ...input, ...filter });
    const id = activity ? activityId(activity) : null;
    const stream = id ? await streamFor(id) : null;
    if (!activity || !id) {
      return ok({ found: false, message: "No matching Garmin workout found." });
    }
    const completeness = streamCompleteness(stream);
    if (!stream) {
      return ok({
        found: false,
        activity_id: id,
        ...completeness,
        message: "No Garmin stream file found for activity_id. Run sync/backfill with activity streams enabled. Garmin MCP currently has only summary/detail data for this activity."
      });
    }
    return ok({
      found: true,
      activity_summary: summarizeWorkout(activity, stream),
      extraction: streamExtractionNotice(stream),
      ...completeness,
      field_aliases_used: fieldCheck.aliases_used,
      stream: shapeStream(stream, { ...input, fields: fieldCheck.fields })
    });
  }

  // Archive helpers load only the month partitions needed for the requested date range.
  async function archiveMetrics(startDate: string, endDate: string, metrics = ["daily", "sleep", "hrv", "stress", "body_battery"]) {
    const entries = await Promise.all(metrics.map(async (metric) => [metric, await reader.readArchiveCollection(metric, startDate, endDate)] as const));
    return Object.fromEntries(entries);
  }

  async function rowsForRange(collection: string, range: ReturnType<typeof requestedRange>, source: StreamSource = "auto"): Promise<{ rows: JsonObject[]; source: StreamSource; coverage: JsonObject | null }> {
    if (source === "latest") {
      const rows = filterByDateRange(await safeCollection(reader, collection), range.startDate, range.endDate);
      return { rows, source: "latest", coverage: dateCoverage(range.startDate, range.endDate, rows) };
    }
    if (source === "archive") {
      const result = await reader.readArchiveCollection(collection, range.startDate, range.endDate);
      return { rows: result.rows, source: "archive", coverage: result.coverage };
    }
    const archive = await reader.readArchiveCollection(collection, range.startDate, range.endDate).catch(() => null);
    if (archive && archive.rows.length > 0) {
      return { rows: archive.rows, source: "archive", coverage: archive.coverage };
    }
    const rows = filterByDateRange(await safeCollection(reader, collection), range.startDate, range.endDate);
    return { rows, source: "latest", coverage: dateCoverage(range.startDate, range.endDate, rows) };
  }

  async function activitiesForRange(range: ReturnType<typeof requestedRange>, source: StreamSource = "auto", sportCategories?: string[]): Promise<{ rows: JsonObject[]; source: StreamSource; coverage: JsonObject | null }> {
    const result = await rowsForRange("activities", range, source);
    return { ...result, rows: filterActivities(result.rows, { sport_categories: sportCategories }) };
  }

  async function metricBundle(range: ReturnType<typeof requestedRange>, source: StreamSource = "auto") {
    const entries = await Promise.all(
      healthDatasets.map(async (dataset) => [dataset, await rowsForRange(dataset, range, source)] as const)
    );
    return Object.fromEntries(entries) as Record<string, { rows: JsonObject[]; source: StreamSource; coverage: JsonObject | null }>;
  }

  async function streamAndDetailCounts(activities: JsonObject[], source: StreamSource = "auto") {
    const checked = activities.slice(0, 200);
    const details = await Promise.all(checked.map(async (activity) => {
      const id = activityId(activity);
      return id ? reader.readActivityDetail(id).catch(() => null) : null;
    }));
    const streams = await Promise.all(checked.map(async (activity) => {
      const id = activityId(activity);
      return id ? streamFor(id, source).catch(() => null) : null;
    }));
    const zeroSampleStreams = streams.filter((stream) => stream && ((firstNumber(stream, ["sample_count"]) ?? (Array.isArray(stream.samples) ? stream.samples.length : 0)) === 0));
    return {
      activities_checked: checked.length,
      activity_details: details.filter(Boolean).length,
      activity_streams: streams.filter(Boolean).length,
      zero_sample_streams: zeroSampleStreams.length,
      stream_fields: uniqueStrings(streams.flatMap((stream) => (Array.isArray(stream?.fields) ? stream.fields : [])))
    };
  }

  async function capabilities(): Promise<JsonObject> {
    // Capability discovery answers "what data do I have?" before clients choose tools.
    const [manifest, latestActivities, archiveActivitiesRows, latestDaily, latestSleep, latestHrv, latestBodyBattery, latestStress, syncStatus] = await Promise.all([
      reader.readManifest().catch(() => ({} as Manifest)),
      reader.readCollection("activities").catch(() => [] as JsonObject[]),
      reader.readArchiveActivities ? reader.readArchiveActivities() : Promise.resolve([] as JsonObject[]),
      reader.readCollection("daily").catch(() => [] as JsonObject[]),
      reader.readCollection("sleep").catch(() => [] as JsonObject[]),
      reader.readCollection("hrv").catch(() => [] as JsonObject[]),
      reader.readCollection("body_battery").catch(() => [] as JsonObject[]),
      reader.readCollection("stress").catch(() => [] as JsonObject[]),
      readSyncStatus()
    ]);
    const activityMap = new Map<string, JsonObject>();
    for (const activity of [...archiveActivitiesRows, ...latestActivities]) {
      activityMap.set(activityId(activity) ?? JSON.stringify(activity), activity);
    }
    const activities = [...activityMap.values()];
    const bounds = dateBounds(activities);
    const historyStart = bounds.start ?? manifest.date_range?.start ?? null;
    const historyEnd = bounds.end ?? manifest.date_range?.end ?? null;
    const healthResults =
      historyStart && historyEnd
        ? await Promise.all(healthDatasets.map(async (dataset) => [dataset, await reader.readArchiveCollection(dataset, historyStart, historyEnd).catch(() => null)] as const))
        : [];
    const healthEntries = Object.fromEntries(healthResults);
    const sampleStreams = await Promise.all(
      activities
        .slice(0, 200)
        .map(async (activity) => {
          const id = activityId(activity);
          return id ? streamFor(id, "auto") : null;
        })
    );
    const sampleDetails = await Promise.all(
      activities
        .slice(0, 200)
        .map(async (activity) => {
          const id = activityId(activity);
          return id ? reader.readActivityDetail(id).catch(() => null) : null;
        })
    );
    const streams = sampleStreams.filter((stream): stream is JsonObject => stream !== null);
    const details = sampleDetails.filter((detail): detail is JsonObject => detail !== null);
    const streamFields = uniqueStrings(streams.flatMap((stream) => (Array.isArray(stream.fields) ? stream.fields : [])));
    const supportedStreamFields = ["heart_rate", "cadence", "speed_mps", "power_watts", "altitude_m", "distance_m", "position_lat", "position_long", "temperature"];
    const missingOrOptionalStreamFields = supportedStreamFields.filter((field) => !streamFields.includes(field));
    const streamCoverage = activities.length ? Math.round((streams.length / Math.min(activities.length, 200)) * 10000) / 100 : 0;
    const activitiesBySport = countsBySport(activities);
    const latestBounds = dateBounds([...latestDaily, ...latestSleep, ...latestHrv, ...latestStress, ...latestBodyBattery, ...latestActivities]);
    const healthEntriesMap = healthEntries as Record<string, { rows: JsonObject[] } | null>;
    const archiveHealthRows = Object.fromEntries(
      healthDatasets.map((dataset) => [dataset, healthEntriesMap[dataset]?.rows ?? []])
    ) as Record<string, JsonObject[]>;
    const healthDatasetStats = Object.fromEntries(
      healthDatasets.map((dataset) => [
        dataset,
        datasetCoverage(
          dataset,
          archiveHealthRows[dataset].length
            ? archiveHealthRows[dataset]
            : dataset === "daily"
              ? latestDaily
              : dataset === "sleep"
                ? latestSleep
                : dataset === "hrv"
                  ? latestHrv
                  : dataset === "stress"
                    ? latestStress
                    : latestBodyBattery,
          historyStart,
          historyEnd
        )
      ])
    );
    const archiveStatistics = {
      total_activities: activities.length,
      activities_by_sport: activitiesBySport,
      date_coverage: historyStart && historyEnd ? dateCoverage(historyStart, historyEnd, activities) : null,
      stream_coverage: {
        activities_checked: Math.min(activities.length, 200),
        activities_with_streams: streams.length,
        completeness_percent: streamCoverage
      },
      activity_detail_coverage: {
        activities_checked: Math.min(activities.length, 200),
        activities_with_details: details.length,
        completeness_percent: activities.length ? Math.round((details.length / Math.min(activities.length, 200)) * 10000) / 100 : 0
      },
      sleep_coverage: healthEntriesMap.sleep ? dateCoverage(historyStart ?? "", historyEnd ?? "", healthEntriesMap.sleep.rows) : null,
      hrv_coverage: healthEntriesMap.hrv ? dateCoverage(historyStart ?? "", historyEnd ?? "", healthEntriesMap.hrv.rows) : null
    };
    return {
      source: archiveActivitiesRows.length ? "archive" : "latest",
      sources_used: archiveActivitiesRows.length && latestActivities.length ? ["archive", "latest"] : archiveActivitiesRows.length ? ["archive"] : ["latest"],
      history: {
        archive_start_date: historyStart,
        archive_end_date: historyEnd,
        latest_start_date: latestBounds.start ?? manifest.date_range?.start ?? null,
        latest_end_date: latestBounds.end ?? manifest.date_range?.end ?? null,
        total_days_available: historyStart && historyEnd ? inclusiveDays(historyStart, historyEnd) : 0
      },
      health_datasets: healthDatasetStats,
      activity_datasets: {
        activities: activities.length > 0,
        activity_details: details.length > 0,
        activity_streams: streams.length > 0,
        raw_activity_details: Boolean(manifest.files?.raw_activity_details),
        total_activity_count: activities.length,
        activities_checked_for_details: Math.min(activities.length, 200),
        activities_checked_for_streams: Math.min(activities.length, 200)
      },
      stream_fields_observed: streamFields,
      missing_or_optional_stream_fields: missingOrOptionalStreamFields,
      sport_categories_observed: Object.keys(activitiesBySport).sort(),
      archive_stats: archiveStatistics,
      last_sync: syncStatus,
      history_start: historyStart,
      history_end: historyEnd,
      latest_data_coverage: manifest.date_range ?? null,
      supported_health_datasets: healthDatasets,
      sleep: Boolean(healthEntriesMap.sleep?.rows.length || latestSleep.length),
      hrv: Boolean(healthEntriesMap.hrv?.rows.length || latestHrv.length),
      body_battery: Boolean(healthEntriesMap.body_battery?.rows.length || latestBodyBattery.length),
      stress: Boolean(healthEntriesMap.stress?.rows.length || latestStress.length),
      raw_data_available: Boolean(manifest.files?.raw) || false,
      activity_streams: streams.length > 0,
      stream_fields: streamFields,
      stream_field_aliases: streamFieldAliases,
      supported_stream_fields: streamFields,
      supported_activity_types: uniqueStrings(activities.map((activity) => activity.type ?? activity.activity_type ?? activity.activityType)),
      sports: Object.keys(activitiesBySport).sort(),
      total_activity_count: activities.length,
      total_days_available: historyStart && historyEnd ? inclusiveDays(historyStart, historyEnd) : 0,
      archive_statistics: archiveStatistics
    };
  }

  async function systemStatus(): Promise<JsonObject> {
    const [caps, syncStatus, datasets, manifest, latestSleep, latestHrv] = await Promise.all([
      capabilities(),
      readSyncStatus(),
      datasetStatus(),
      reader.readManifest().catch(() => ({} as Manifest)),
      reader.readCollection("sleep").catch(() => [] as JsonObject[]),
      reader.readCollection("hrv").catch(() => [] as JsonObject[])
    ]);
    const warnings: string[] = [];
    const history = caps.history as JsonObject | undefined;
    const activityDatasets = caps.activity_datasets as JsonObject | undefined;
    if (rowsAreDateOnly(latestSleep)) {
      warnings.push("latest sleep normalization appears date-only; run sync.renormalize for sleep.");
    }
    if (rowsAreDateOnly(latestHrv)) {
      warnings.push("latest HRV normalization appears date-only; run sync.renormalize for hrv.");
    }
    if (!activityDatasets?.activity_streams && (activityDatasets?.total_activity_count as number | undefined ?? 0) > 0) {
      warnings.push("activity streams are missing; workout analysis will be summary-only.");
    }
    const latestEnd = typeof history?.latest_end_date === "string" ? history.latest_end_date : manifest.date_range?.end;
    if (latestEnd && inclusiveDays(latestEnd, todayIso()) - 1 > 1) {
      warnings.push("latest data appears stale by more than one day.");
    }
    const archiveBackfillStatus = await reader.readJson<JsonObject>("../archive/backfill_checkpoint.json").catch(() => null);
    const repairStatus = await readActivityDetailRepairStatus();
    if (archiveBackfillStatus?.status === "running") {
      warnings.push("archive backfill is currently running.");
    }
    return {
      source: "latest",
      server_status: "ok",
      latest_sync: syncStatus,
      archive_backfill_status: archiveBackfillStatus,
      activity_detail_repair_status: repairStatus,
      history_coverage: history ?? null,
      available_datasets: {
        health: caps.health_datasets,
        activity: caps.activity_datasets
      },
      auth_mode_summary: {
        bearer_token_configured: Boolean(process.env.MCP_BEARER_TOKEN),
        oauth_routes_enabled: true,
        secrets_redacted: true
      },
      warnings: uniqueStrings(warnings),
      version: process.env.npm_package_version ?? null
    };
  }

  async function readActivityDetailRepairStatus(): Promise<JsonObject> {
    try {
      return await reader.readJson<JsonObject>("../archive/activity_detail_repair_status.json");
    } catch {
      try {
        return await reader.readJson<JsonObject>("activity_detail_repair_status.json");
      } catch {
        return { status: "unknown", missing: true };
      }
    }
  }

  function toolGuide(intent?: string): JsonObject {
    const commonIntents: JsonObject = {
      today_sleep: { recommended_tool: "get_sleep_for_date", required_args: ["date"], notes: "Use the single-date sleep tool for one-night sleep questions." },
      today_hrv: { recommended_tool: "get_hrv_for_date", required_args: ["date"], notes: "Use include_readings only when detailed overnight samples are needed." },
      today_recovery: { recommended_tool: "get_recovery_for_date", required_args: ["date"], notes: "Returns sleep, HRV, stress, body battery, resting HR, and readiness fields where available." },
      latest_ride_analysis: { recommended_tools: ["sync_now", "get_latest_ride_streams", "analyze_latest_workout"], notes: "Use stream tools for deep workout analysis." },
      three_month_training_summary: { recommended_tool: "analyze_training_period", required_args: ["date_range_preset or start_date/end_date"], notes: "Use archive tools, not latest-only tools." },
      available_data: { recommended_tool: "get_data_capabilities" },
      system_health: { recommended_tool: "get_system_status" },
      data_quality: { recommended_tool: "audit_data_quality", optional_args: ["date_range_preset", "datasets", "source"] },
      metric_fields: { recommended_tool: "get_metric_inventory", optional_args: ["date_range_preset", "source"] },
      recovery_dashboard: { recommended_tool: "get_recovery_dashboard", optional_args: ["date_range_preset"], default_preset: "last_14_days" },
      training_load_dashboard: { recommended_tool: "get_training_load_dashboard", optional_args: ["date_range_preset", "sport_categories"], default_preset: "last_30_days" },
      anomaly_detection: { recommended_tool: "detect_training_anomalies", optional_args: ["date_range_preset", "focus"], default_preset: "last_30_days" }
    };
    const normalized = intent?.toLowerCase().replace(/[\s-]+/g, "_");
    return {
      source: "latest",
      intent: intent ?? null,
      matched_intent: normalized && normalized in commonIntents ? normalized : null,
      routing_rules: [
        "Use latest tools for recent/current data.",
        "Use archive tools for arbitrary date ranges and long-range history.",
        "Use get_sleep_for_date, get_hrv_for_date, and get_recovery_for_date for one-night or one-day recovery questions.",
        "Use activity stream tools for deep workout analysis.",
        "Do not fall back to Strava or other services unless the user explicitly asks."
      ],
      stream_fields: {
        canonical: expectedStreamFields,
        aliases: streamFieldAliases
      },
      common_intents: commonIntents,
      recommended: normalized && normalized in commonIntents ? commonIntents[normalized] : null
    };
  }

  async function auditDataQuality(input: z.infer<typeof inputSchemas.audit_data_quality>): Promise<JsonObject> {
    const range = requestedRange(input, "last_30_days");
    const datasets = input.datasets ?? ["daily", "sleep", "hrv", "stress", "body_battery", "activities", "activity_details", "activity_streams"];
    const source = input.source ?? "auto";
    const issues: Array<{ severity: string; dataset: string; message: string; dates?: string[]; count?: number; hint?: string }> = [];
    const metrics = await metricBundle(range, source);
    const activities = await activitiesForRange(range, source);
    for (const dataset of healthDatasets) {
      if (!datasets.includes(dataset as never)) continue;
      const missing = missingDaysForRows(range.startDate, range.endDate, metrics[dataset].rows);
      if (missing.length > 0) {
        issues.push({ severity: missing.length === inclusiveDays(range.startDate, range.endDate) ? "critical" : "warning", dataset, message: `${missing.length} day(s) missing ${dataset} records`, dates: missing.slice(0, 100), count: missing.length });
      }
    }
    if (datasets.includes("sleep") && rowsAreDateOnly(metrics.sleep.rows)) {
      issues.push({ severity: "warning", dataset: "sleep", message: "Normalized sleep rows appear date-only; run sync.renormalize for sleep." });
    }
    if (datasets.includes("hrv" as never) && rowsAreDateOnly(metrics.hrv.rows)) {
      issues.push({ severity: "warning", dataset: "hrv", message: "Normalized HRV rows appear date-only; run sync.renormalize for hrv." });
    }
    const counts = await streamAndDetailCounts(activities.rows, source === "latest" || source === "archive" ? source : "auto");
    if (datasets.includes("activity_details" as never) && counts.activity_details < counts.activities_checked) {
      issues.push({
        severity: "warning",
        dataset: "activity_details",
        message: `${counts.activities_checked - counts.activity_details} checked activity detail file(s) are missing.`,
        count: counts.activities_checked - counts.activity_details,
        hint: `Run: docker exec garmin-mcp python -m sync.repair_activity_details --start-date ${range.startDate} --end-date ${range.endDate} --output /app/data/archive --sleep-seconds 1`
      });
    }
    if (datasets.includes("activity_streams" as never)) {
      if (counts.activity_streams < counts.activities_checked) {
        issues.push({ severity: "warning", dataset: "activity_streams", message: `${counts.activities_checked - counts.activity_streams} checked activity stream file(s) are missing.`, count: counts.activities_checked - counts.activity_streams });
      }
      if (counts.zero_sample_streams > 0) {
        issues.push({ severity: "warning", dataset: "activity_streams", message: `${counts.zero_sample_streams} checked stream file(s) have zero samples.`, count: counts.zero_sample_streams });
      }
    }
    const status = await readSyncStatus();
    if (status.status === "failed" || status.status === "error") {
      issues.push({ severity: "critical", dataset: "sync", message: "Latest sync status reports failure." });
    }
    if (status.status === "running") {
      issues.push({ severity: "warning", dataset: "sync", message: "A sync job is currently running." });
    }
    const latestDate = dateBounds(metrics.daily.rows).end;
    if (latestDate && inclusiveDays(latestDate, todayIso()) - 1 > 1) {
      issues.push({ severity: "warning", dataset: "daily", message: "Latest daily data is stale by more than one day." });
    }
    return {
      ...rangeMetadata(range, [...Object.values(metrics).flatMap((result) => result.rows), ...activities.rows]),
      source: source === "auto" ? activities.source : source,
      status: maxSeverity(issues),
      issues,
      summary: {
        days_requested: inclusiveDays(range.startDate, range.endDate),
        daily_days: new Set(metrics.daily.rows.map(rowDate).filter(Boolean)).size,
        sleep_days: new Set(metrics.sleep.rows.map(rowDate).filter(Boolean)).size,
        hrv_days: new Set(metrics.hrv.rows.map(rowDate).filter(Boolean)).size,
        stress_days: new Set(metrics.stress.rows.map(rowDate).filter(Boolean)).size,
        body_battery_days: new Set(metrics.body_battery.rows.map(rowDate).filter(Boolean)).size,
        activities: activities.rows.length,
        activity_details: counts.activity_details,
        activity_streams: counts.activity_streams,
        zero_sample_streams: counts.zero_sample_streams
      }
    };
  }

  async function metricInventory(input: z.infer<typeof inputSchemas.get_metric_inventory>): Promise<JsonObject> {
    const range = requestedRange(input, "last_30_days");
    const source = input.source ?? "auto";
    const [metrics, activities] = await Promise.all([metricBundle(range, source), activitiesForRange(range, source)]);
    const details = await Promise.all(activities.rows.slice(0, 50).map(async (activity) => {
      const id = activityId(activity);
      return id ? reader.readActivityDetail(id).catch(() => null) : null;
    }));
    const streams = await Promise.all(activities.rows.slice(0, 50).map(async (activity) => {
      const id = activityId(activity);
      return id ? streamFor(id, source === "latest" || source === "archive" ? source : "auto").catch(() => null) : null;
    }));
    const detailRows = details.filter((detail): detail is JsonObject => detail !== null);
    const streamRows = streams.filter((stream): stream is JsonObject => stream !== null);
    const physiologyFields = ["training_readiness", "training_status", "acute_load", "load_focus", "recovery_time", "recovery_hours", "vo2_max", "ftp", "lactate_threshold", "hill_score", "endurance_score", "race_predictor", "performance_condition"];
    return {
      ...rangeMetadata(range, [...Object.values(metrics).flatMap((result) => result.rows), ...activities.rows]),
      sources_used: uniqueStrings([...Object.values(metrics).map((result) => result.source), activities.source]),
      health_metric_fields_observed: Object.fromEntries(healthDatasets.map((dataset) => [dataset, observedFields(metrics[dataset].rows)])),
      sleep_fields_observed: observedFields(metrics.sleep.rows),
      hrv_fields_observed: observedFields(metrics.hrv.rows),
      activity_summary_fields_observed: observedFields(activities.rows),
      activity_detail_fields_observed: observedFields(detailRows),
      activity_stream_fields_observed: uniqueStrings(streamRows.flatMap((stream) => (Array.isArray(stream.fields) ? stream.fields : []))),
      raw_payload_availability: {
        sleep: metrics.sleep.rows.some((row) => typeof row.raw_payload_path === "string"),
        hrv: metrics.hrv.rows.some((row) => typeof row.raw_payload_path === "string"),
        activity_details_checked: detailRows.length
      },
      optional_garmin_physiology_fields: fieldPresence([...metrics.daily.rows, ...activities.rows, ...detailRows], physiologyFields)
    };
  }

  async function recoveryDashboard(input: z.infer<typeof inputSchemas.get_recovery_dashboard>): Promise<JsonObject> {
    const range = requestedRange(input, "last_14_days");
    const [metrics, activities] = await Promise.all([metricBundle(range, "auto"), activitiesForRange(range, "auto")]);
    const sleepScores = metrics.sleep.rows.map((row) => firstNumber(row, ["sleep_score", "overall_score"]));
    const sleepDurations = metrics.sleep.rows.map((row) => firstNumber(row, ["total_sleep_seconds"]));
    const hrvValues = metrics.hrv.rows.map((row) => firstNumber(row, ["avg_overnight_hrv", "last_night_avg"]));
    const stressValues = metrics.stress.rows.map((row) => firstNumber(row, ["avg_stress", "stress_avg", "stress"]));
    const bodyBatteryValues = metrics.body_battery.rows.map((row) => firstNumber(row, ["body_battery_high", "max_body_battery", "body_battery"]));
    const restingHrValues = metrics.daily.rows.map((row) => firstNumber(row, ["resting_hr", "restingHeartRate"]));
    const missingWarnings = [
      ...healthDatasets.flatMap((dataset) => missingDaysForRows(range.startDate, range.endDate, metrics[dataset].rows).length ? [`${dataset} has missing days in requested range.`] : []),
      ...(rowsAreDateOnly(metrics.sleep.rows) ? ["Sleep normalization appears date-only."] : []),
      ...(rowsAreDateOnly(metrics.hrv.rows) ? ["HRV normalization appears date-only."] : [])
    ];
    const sleepScore = average(sleepScores);
    const avgHrv = average(hrvValues);
    const avgStress = average(stressValues);
    const avgBodyBattery = average(bodyBatteryValues);
    const scoreParts = [
      sleepScore,
      avgHrv === null ? null : Math.min(100, avgHrv * 1.6),
      avgStress === null ? null : Math.max(0, 100 - avgStress),
      avgBodyBattery
    ].filter((value): value is number => value !== null);
    const recoveryScore = scoreParts.length ? Math.round(average(scoreParts) ?? 0) : null;
    const flags = [
      ...(avgHrv !== null && hrvValues.length > 1 && avgHrv < (average(hrvValues.slice(0, -1)) ?? avgHrv) * 0.9 ? ["low_hrv"] : []),
      ...(average(sleepDurations) !== null && (average(sleepDurations) ?? 0) < 6.5 * 3600 ? ["poor_sleep"] : []),
      ...(avgStress !== null && avgStress > 50 ? ["high_stress"] : [])
    ];
    return {
      ...rangeMetadata(range, [...Object.values(metrics).flatMap((result) => result.rows), ...activities.rows]),
      sources_used: uniqueStrings([...Object.values(metrics).map((result) => result.source), activities.source]),
      generated_at: new Date().toISOString(),
      period: { start_date: range.startDate, end_date: range.endDate, preset: range.date_range_preset },
      recovery_score_estimate: recoveryScore,
      score_note: "Estimated by Garmin MCP from normalized local data; not Garmin official Training Readiness.",
      contributors: {
        sleep: { record_count: metrics.sleep.rows.length, avg_sleep_score: sleepScore, avg_sleep_seconds: average(sleepDurations), min_sleep_seconds: minNumber(sleepDurations) },
        hrv: { record_count: metrics.hrv.rows.length, avg_overnight_hrv: avgHrv, min_hrv: minNumber(hrvValues), max_hrv: maxNumber(hrvValues) },
        body_battery: { record_count: metrics.body_battery.rows.length, avg_body_battery: avgBodyBattery },
        stress: { record_count: metrics.stress.rows.length, avg_stress: avgStress },
        resting_hr: { record_count: restingHrValues.filter((value) => value !== null).length, avg_resting_hr: average(restingHrValues) },
        training_load: { activity_count: activities.rows.length, total_duration_seconds: sumNumber(activities.rows, ["duration_seconds", "durationSeconds", "elapsedDuration"]) }
      },
      flags,
      missing_data_warnings: uniqueStrings(missingWarnings),
      full_data_available: missingWarnings.length === 0
    };
  }

  async function trainingLoadDashboard(input: z.infer<typeof inputSchemas.get_training_load_dashboard>): Promise<JsonObject> {
    const range = requestedRange(input, "last_30_days");
    const activities = await activitiesForRange(range, "auto", input.sport_categories);
    const duration = sumNumber(activities.rows, ["duration_seconds", "durationSeconds", "elapsedDuration"]);
    const distance = sumNumber(activities.rows, ["distance_meters", "distanceMeters", "distance"]);
    const sevenDayStart = addDaysIso(range.endDate, -6);
    const chronicStart = addDaysIso(range.endDate, -41);
    const acuteRows = activities.rows.filter((row) => {
      const date = rowDate(row);
      return date !== null && date >= sevenDayStart && date <= range.endDate;
    });
    const chronicRows = activities.rows.filter((row) => {
      const date = rowDate(row);
      return date !== null && date >= chronicStart && date <= range.endDate;
    });
    const acuteDuration = sumNumber(acuteRows, ["duration_seconds", "durationSeconds", "elapsedDuration"]);
    const chronicDuration = sumNumber(chronicRows, ["duration_seconds", "durationSeconds", "elapsedDuration"]);
    const chronicDaily = chronicRows.length ? chronicDuration / Math.min(42, inclusiveDays(chronicStart, range.endDate)) : null;
    const acuteDaily = acuteDuration / 7;
    return {
      ...rangeMetadata(range, activities.rows),
      source: activities.source,
      generated_at: new Date().toISOString(),
      total_activity_count: activities.rows.length,
      total_duration_seconds: duration,
      total_distance_meters: distance,
      activities_by_sport: countsBySport(activities.rows),
      duration_by_sport_seconds: durationBySport(activities.rows),
      weekly_totals: weeklyActivityTotals(activities.rows),
      training_effect: {
        average_training_effect: avgNumber(activities.rows, ["training_effect", "trainingEffect", "aerobic_training_effect", "aerobicTrainingEffect"]),
        average_anaerobic_training_effect: avgNumber(activities.rows, ["anaerobic_training_effect", "anaerobicTrainingEffect"])
      },
      acute_7_day_duration_seconds: acuteDuration,
      chronic_42_day_duration_seconds: chronicDuration,
      ramp_rate_estimate: chronicDaily && chronicDaily > 0 ? Math.round(((acuteDaily - chronicDaily) / chronicDaily) * 10000) / 100 : null,
      load_note: "Duration/load values are Garmin MCP estimates unless official Garmin load fields are present in the source data.",
      hard_easy_distribution: {
        hard_count: activities.rows.filter((row) => (firstNumber(row, ["training_effect", "trainingEffect", "aerobic_training_effect"]) ?? 0) >= 3).length,
        easy_count: activities.rows.filter((row) => (firstNumber(row, ["training_effect", "trainingEffect", "aerobic_training_effect"]) ?? 0) > 0 && (firstNumber(row, ["training_effect", "trainingEffect", "aerobic_training_effect"]) ?? 0) < 3).length,
        unknown_count: activities.rows.filter((row) => firstNumber(row, ["training_effect", "trainingEffect", "aerobic_training_effect"]) === null).length
      },
      missing_data_warnings: activities.rows.length === 0 ? ["No activities found for requested range."] : []
    };
  }

  async function detectAnomalies(input: z.infer<typeof inputSchemas.detect_training_anomalies>): Promise<JsonObject> {
    const range = requestedRange(input, "last_30_days");
    const [metrics, activities] = await Promise.all([metricBundle(range, "auto"), activitiesForRange(range, "auto")]);
    const anomalies: JsonObject[] = [];
    for (const row of metrics.hrv.rows) {
      const value = firstNumber(row, ["avg_overnight_hrv", "last_night_avg"]);
      const baselineLow = firstNumber(row, ["baseline_balanced_low"]);
      if (value !== null && baselineLow !== null && value < baselineLow) {
        anomalies.push({ type: "hrv_below_baseline", severity: "medium", date: rowDate(row), evidence: { value, baseline_low: baselineLow } });
      }
    }
    const avgSleep = average(metrics.sleep.rows.map((row) => firstNumber(row, ["total_sleep_seconds"])));
    for (const row of metrics.sleep.rows) {
      const value = firstNumber(row, ["total_sleep_seconds"]);
      if (value !== null && ((avgSleep !== null && value < avgSleep * 0.8) || value < 6 * 3600)) {
        anomalies.push({ type: "sleep_duration_drop", severity: "medium", date: rowDate(row), evidence: { total_sleep_seconds: value, average_sleep_seconds: avgSleep } });
      }
    }
    for (const row of metrics.body_battery.rows) {
      const value = firstNumber(row, ["body_battery_low", "body_battery", "morning_body_battery"]);
      if (value !== null && value < 35) {
        anomalies.push({ type: "body_battery_low_morning", severity: "medium", date: rowDate(row), evidence: { body_battery: value } });
      }
    }
    const avgStress = average(metrics.stress.rows.map((row) => firstNumber(row, ["avg_stress", "stress_avg", "stress"])));
    for (const row of metrics.stress.rows) {
      const value = firstNumber(row, ["avg_stress", "stress_avg", "stress"]);
      if (value !== null && ((avgStress !== null && value > avgStress * 1.35) || value > 65)) {
        anomalies.push({ type: "stress_spike", severity: "medium", date: rowDate(row), evidence: { stress: value, average_stress: avgStress } });
      }
    }
    const dailyDurations = new Map<string, number>();
    for (const activity of activities.rows) {
      const date = rowDate(activity);
      if (!date) continue;
      dailyDurations.set(date, (dailyDurations.get(date) ?? 0) + (firstNumber(activity, ["duration_seconds", "durationSeconds", "elapsedDuration"]) ?? 0));
    }
    const durationValues = [...dailyDurations.values()];
    const avgDuration = average(durationValues);
    for (const [date, duration] of dailyDurations) {
      if (avgDuration !== null && duration > avgDuration * 1.75 && duration > 3600) {
        anomalies.push({ type: "training_load_spike", severity: "medium", date, evidence: { duration_seconds: duration, average_active_day_duration_seconds: avgDuration } });
      }
    }
    let consecutive = 0;
    for (const date of eachDate(range.startDate, range.endDate)) {
      consecutive = dailyDurations.has(date) ? consecutive + 1 : 0;
      if (consecutive >= 7) {
        anomalies.push({ type: "too_many_consecutive_training_days", severity: "low", date, evidence: { consecutive_training_days: consecutive } });
      }
    }
    for (const dataset of ["sleep", "hrv"]) {
      const missing = missingDaysForRows(range.startDate, range.endDate, metrics[dataset].rows);
      if (missing.length > 0) {
        anomalies.push({ type: "missing_data_anomaly", severity: "low", dataset, evidence: { missing_days: missing.slice(0, 30), count: missing.length } });
      }
    }
    return {
      ...rangeMetadata(range, [...Object.values(metrics).flatMap((result) => result.rows), ...activities.rows]),
      sources_used: uniqueStrings([...Object.values(metrics).map((result) => result.source), activities.source]),
      focus: input.focus,
      status: maxSeverity(anomalies.map((item) => ({ severity: item.severity === "high" ? "critical" : item.severity === "medium" ? "warning" : "ok" }))),
      anomalies,
      recommendations_for_ai: anomalies.length
        ? ["Keep recommendations conservative and grounded in the listed evidence.", "Consider easier training if low HRV, poor sleep, or high stress persists."]
        : ["No major anomaly detected in available local Garmin data."],
      missing_data_warnings: anomalies.filter((item) => item.type === "missing_data_anomaly")
    };
  }

  async function schemaVersion(): Promise<JsonObject> {
    const manifest = await reader.readManifest().catch(() => ({} as Manifest));
    return {
      source: "latest",
      mcp_server_version: process.env.npm_package_version ?? "0.1.0",
      git_commit: process.env.GIT_COMMIT ?? process.env.REVISION ?? null,
      normalized_schema_versions: {
        latest_manifest: "1",
        daily: "1",
        sleep: "2",
        hrv: "2",
        stress: "1",
        body_battery: "1",
        activities: "1"
      },
      activity_stream_schema_version: "1",
      oauth_enabled: true,
      latest_data_dir: process.env.GARMIN_DATA_DIR ?? process.env.SERVER_DATA_DIR ?? null,
      archive_data_dir: process.env.GARMIN_ARCHIVE_DIR ?? (process.env.GARMIN_DATA_DIR ? `${process.env.GARMIN_DATA_DIR}/../archive` : null),
      generated_at: new Date().toISOString(),
      latest_manifest_generated_at: manifest.generated_at ?? null,
      setup_note: "Set GIT_COMMIT or REVISION in the container environment to expose the deployed commit."
    };
  }

  async function datasetStatus(): Promise<JsonObject> {
    // Dataset status is intentionally latest-only; archive coverage is reported elsewhere.
    const entries = await Promise.all(
      [...healthDatasets, "activities"].map(async (dataset) => {
        const rows = await reader.readCollection(dataset).catch(() => [] as JsonObject[]);
        return [dataset, datasetRecordStatus(rows)] as const;
      })
    );
    return Object.fromEntries(entries);
  }

  async function syncCompleteness(): Promise<JsonObject> {
    // Merge the status file with live latest-file inspection so diagnostics still work
    // if the status file predates the completeness contract.
    const status = await readSyncStatus();
    const datasets = await datasetStatus();
    const latestDates = Object.fromEntries(Object.entries(datasets).map(([name, value]) => [name, (value as JsonObject).latest_date ?? null]));
    const dailyDate = latestDates.daily;
    const warnings: string[] = Array.isArray(status.stale_dataset_warnings) ? status.stale_dataset_warnings.map(String) : [];
    for (const dataset of ["sleep", "hrv"]) {
      const value = latestDates[dataset];
      if (typeof dailyDate === "string" && typeof value === "string" && inclusiveDays(value, dailyDate) - 1 > 1) {
        warnings.push(`${dataset} dataset stale`);
      }
      if (typeof dailyDate === "string" && !value) {
        warnings.push(`${dataset} dataset missing`);
      }
    }
    const completeness = (status.sync_completeness && typeof status.sync_completeness === "object" ? status.sync_completeness : {}) as JsonObject;
    const derivedCompleteness = Object.fromEntries(Object.entries(datasets).map(([name, value]) => [name, Boolean((value as JsonObject).latest_date)]));
    return {
      source: "latest",
      sync_status: status.status ?? "unknown",
      sync_completeness: { ...derivedCompleteness, ...completeness },
      latest_available_dates: latestDates,
      stale_dataset_warnings: uniqueStrings(warnings),
      sync_health_score: status.sync_health_score ?? null,
      activity_stream_coverage: status.activity_stream_coverage ?? null,
      dataset_status: datasets
    };
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
      const range = requestedRange(input);
      const [daily, sleep, hrv, stress, bodyBattery, activities] = await Promise.all([
        safeCollection(reader, "daily"),
        safeCollection(reader, "sleep"),
        safeCollection(reader, "hrv"),
        safeCollection(reader, "stress"),
        safeCollection(reader, "body_battery"),
        safeCollection(reader, "activities")
      ]);

      const { startDate, endDate } = range;
      const dailyRange = filterByDateRange(daily, startDate, endDate);
      const rangeRows = [
        ...dailyRange,
        ...filterByDateRange(sleep, startDate, endDate),
        ...filterByDateRange(hrv, startDate, endDate),
        ...filterByDateRange(stress, startDate, endDate),
        ...filterByDateRange(bodyBattery, startDate, endDate),
        ...filterByDateRange(activities, startDate, endDate)
      ];
      if (rangeRows.length === 0) {
        return toolError("NO_DATA_FOR_RANGE", "No Garmin latest data was found for the requested date range.", {
          requested_start_date: range.requested_start_date,
          requested_end_date: range.requested_end_date,
          date_range_preset: range.date_range_preset,
          resolved_start_date: range.resolved_start_date,
          resolved_end_date: range.resolved_end_date,
          defaults_applied: range.defaults_applied
        });
      }
      const readiness = dailyRange
        .map((row) => ({
          date: row.date,
          training_readiness: row.training_readiness,
          acute_load: row.acute_load,
          recovery_hours: row.recovery_hours
        }))
        .filter((row) => row.training_readiness || row.acute_load || row.recovery_hours);

      return ok({
        requested_start_date: range.requested_start_date,
        requested_end_date: range.requested_end_date,
        date_range_preset: range.date_range_preset,
        resolved_start_date: range.resolved_start_date,
        resolved_end_date: range.resolved_end_date,
        coverage: dateCoverage(startDate, endDate, rangeRows),
        defaults_applied: range.defaults_applied,
        start_date: startDate,
        end_date: endDate,
        sleep_trend: filterByDateRange(sleep, startDate, endDate),
        hrv_trend: filterByDateRange(hrv, startDate, endDate),
        stress_trend: filterByDateRange(stress, startDate, endDate),
        body_battery_trend: filterByDateRange(bodyBattery, startDate, endDate),
        activities_summary: filterByDateRange(activities, startDate, endDate),
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
      const stream = await streamFor(input.activity_id);
      return ok({
        activity_id: input.activity_id,
        detail,
        missing: detail === null,
        ...streamCompleteness(stream),
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

    async get_data_capabilities() {
      return ok(await capabilities());
    },

    async get_system_status() {
      return ok(await systemStatus());
    },

    async get_tool_guide(input: z.infer<typeof inputSchemas.get_tool_guide>) {
      return ok(toolGuide(input.intent));
    },

    async audit_data_quality(input: z.infer<typeof inputSchemas.audit_data_quality>) {
      return ok(await auditDataQuality(input));
    },

    async get_metric_inventory(input: z.infer<typeof inputSchemas.get_metric_inventory>) {
      return ok(await metricInventory(input));
    },

    async get_recovery_dashboard(input: z.infer<typeof inputSchemas.get_recovery_dashboard>) {
      return ok(await recoveryDashboard(input));
    },

    async get_training_load_dashboard(input: z.infer<typeof inputSchemas.get_training_load_dashboard>) {
      return ok(await trainingLoadDashboard(input));
    },

    async detect_training_anomalies(input: z.infer<typeof inputSchemas.detect_training_anomalies>) {
      return ok(await detectAnomalies(input));
    },

    async get_schema_version() {
      return ok(await schemaVersion());
    },

    async repair_activity_details_status() {
      return ok(await readActivityDetailRepairStatus());
    },

    async get_latest_activity() {
      const status = await readSyncStatus();
      const latestActivityId = status.latest_activity_id;
      if (typeof latestActivityId === "string" && latestActivityId.length > 0) {
        const [detail, stream] = await Promise.all([reader.readActivityDetail(latestActivityId), streamFor(latestActivityId)]);
        return ok({
          activity_id: latestActivityId,
          detail,
          missing: detail === null,
          ...streamCompleteness(stream),
          source: "latest",
          source_detail: "latest_sync_status",
          next_tool_hint: "For full Garmin streams, call get_activity_streams or get_latest_workout_streams."
        });
      }

      const activities = await safeCollection(reader, "activities");
      const latestActivity = latestByDate(activities);
      if (latestActivity?.id && typeof latestActivity.id === "string") {
        const [detail, stream] = await Promise.all([reader.readActivityDetail(latestActivity.id), streamFor(latestActivity.id)]);
        return ok({
          activity_id: latestActivity.id,
          detail: detail ?? latestActivity,
          missing: false,
          ...streamCompleteness(stream),
          source: "latest",
          source_detail: "activities",
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

    async get_sync_completeness() {
      return ok(await syncCompleteness());
    },

    async get_dataset_status() {
      return ok({ source: "latest", ...(await datasetStatus()) });
    },

    async get_latest_workout(input: z.infer<typeof inputSchemas.get_latest_workout>) {
      const { activity, id, stream } = await latestMatching(input);
      return ok({
        found: activity !== null,
        activity_id: id,
        activity,
        summary: summarizeWorkout(activity, stream),
        ...streamCompleteness(stream),
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
      const fieldCheck = normalizeRequestedStreamFields(input.fields);
      if (fieldCheck.invalid_fields.length > 0) {
        return toolError("INVALID_FIELD_NAME", "One or more requested stream fields are not valid.", {
          param: "fields",
          received: fieldCheck.invalid_fields,
          valid_values: fieldCheck.valid_values,
          hint: "Use canonical stream fields or accepted aliases such as speed, altitude, and distance."
        });
      }
      const stream = await streamFor(input.activity_id, input.source);
      const completeness = streamCompleteness(stream);
      if (!stream) {
        return ok({
          found: false,
          activity_id: input.activity_id,
          ...(input.source === "auto" ? { sources_used: ["latest", "archive"] } : { source: input.source }),
          ...completeness,
          message: "No Garmin stream file found for activity_id. Run sync/backfill with activity streams enabled. Garmin MCP currently has only summary/detail data for this activity."
        });
      }
      return ok({
        found: true,
        activity_id: input.activity_id,
        ...(input.source === "auto" ? { sources_used: ["latest", "archive"] } : { source: input.source }),
        extraction: streamExtractionNotice(stream),
        ...completeness,
        field_aliases_used: fieldCheck.aliases_used,
        stream: shapeStream(stream, { ...input, fields: fieldCheck.fields })
      });
    },

    async analyze_activity(input: z.infer<typeof inputSchemas.analyze_activity>) {
      const stream = await streamFor(input.activity_id, input.source);
      const activities = await allActivities(reader);
      const activity = activities.find((item) => activityId(item) === input.activity_id) ?? (await reader.readActivityDetail(input.activity_id));
      return ok({
        analysis_type: input.analysis_type,
        ...(input.source === "auto" ? { sources_used: ["latest", "archive"] } : { source: input.source }),
        ...streamCompleteness(stream),
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
        ...streamCompleteness(stream),
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
        ...streamCompleteness(stream),
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
      const allRows = [...activities, ...Object.values(metrics).flatMap((result) => result.rows)];
      if (allRows.length === 0) {
        return toolError("NO_DATA_FOR_RANGE", "No Garmin archive data was found for the requested date range.", {
          ...rangeMetadata(range, allRows)
        });
      }
      return ok({
        ...rangeMetadata(range, metrics.daily.rows),
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
        ...rangeMetadata(range, activities),
        date_range: { start: range.startDate, end: range.endDate },
        total_matches: activities.length,
        returned: enriched.length,
        limit: input.limit,
        archive_coverage: result.coverage,
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
        ...rangeMetadata(range, activities),
        date_range: { start: range.startDate, end: range.endDate },
        total_matches: activities.length,
        returned: enriched.length,
        limit: input.limit,
        archive_coverage: result.coverage,
        workouts: enriched
      });
    },

    async get_health_metrics_by_date_range(input: z.infer<typeof inputSchemas.get_health_metrics_by_date_range>) {
      const range = requestedRange(input);
      const metrics = input.metrics ?? ["daily", "sleep", "hrv", "stress", "body_battery"];
      const results = await archiveMetrics(range.startDate, range.endDate, metrics);
      const rows = Object.values(results).flatMap((result) => result.rows);
      if (rows.length === 0) {
        return toolError("NO_DATA_FOR_RANGE", "No Garmin health metrics were found for the requested date range.", {
          ...rangeMetadata(range, rows)
        });
      }
      return ok({
        ...rangeMetadata(range, rows),
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
      const readiness = recoveryReadiness(sleepResult.row, hrvResult.row, stress, bodyBattery);
      return ok({
        date: input.date,
        sources_used: uniqueStrings([sleepResult.source, hrvResult.source, dailyResult.source, stressResult.source, bodyBatteryResult.source]),
        source_detail: {
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
        avg_stress: stress?.avg_stress ?? stress?.stress_avg ?? stress?.stress ?? null,
        ...readiness
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
        ...rangeMetadata(range, [...activities, ...Object.values(metrics).flatMap((result) => result.rows)]),
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
        source: "archive",
        defaults_applied: ranges.defaults_applied,
        requested_period_a_start: ranges.periodAStart,
        requested_period_a_end: ranges.periodAEnd,
        requested_period_b_start: ranges.periodBStart,
        requested_period_b_end: ranges.periodBEnd,
        coverage: {
          period_a: dateCoverage(ranges.periodAStart, ranges.periodAEnd, [...a.activities, ...Object.values(a.health).flatMap((result) => result.rows)]),
          period_b: dateCoverage(ranges.periodBStart, ranges.periodBEnd, [...b.activities, ...Object.values(b.health).flatMap((result) => result.rows)])
        },
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
