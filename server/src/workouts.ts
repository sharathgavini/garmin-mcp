import { classifySport, type SportCategory } from "./sports.js";
import type { GarminDataReader, JsonObject } from "./types.js";

export type StreamSource = "latest" | "archive" | "auto";

export interface WorkoutFilter {
  activity_types?: string[];
  exclude_activity_types?: string[];
  sport_categories?: SportCategory[];
  days?: number;
}

const preservedFields = new Set(["timestamp", "offset_seconds"]);

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function textValue(value: unknown): string {
  return String(value ?? "");
}

export function activityId(activity: JsonObject): string | null {
  const id = activity.id ?? activity.activity_id ?? activity.activityId;
  return typeof id === "string" || typeof id === "number" ? String(id) : null;
}

export function activityType(activity: JsonObject): string {
  return textValue(activity.type ?? activity.activity_type ?? activity.activityType ?? activity.sport_type ?? activity.sportType);
}

export function activityDate(activity: JsonObject): string {
  return textValue(activity.date ?? activity.start_time ?? activity.startTimeLocal ?? activity.startTimeGMT);
}

export function withinDays(activity: JsonObject, days: number): boolean {
  const date = activityDate(activity).slice(0, 10);
  if (!date) {
    return true;
  }
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - Math.max(1, days) + 1);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  return date >= cutoffIso;
}

export function matchesWorkout(activity: JsonObject, filter: WorkoutFilter): boolean {
  const type = activityType(activity).toLowerCase();
  const category = classifySport(type);
  const includes = (filter.activity_types ?? []).map((item) => item.toLowerCase());
  const excludes = (filter.exclude_activity_types ?? []).map((item) => item.toLowerCase());
  const categories = filter.sport_categories ?? [];
  if (includes.length > 0 && !includes.some((item) => type.includes(item))) {
    return false;
  }
  if (excludes.some((item) => type.includes(item))) {
    return false;
  }
  if (categories.length > 0 && !categories.includes(category)) {
    return false;
  }
  return withinDays(activity, filter.days ?? 30);
}

export function latestWorkout(activities: JsonObject[], filter: WorkoutFilter = {}): JsonObject | null {
  const matches = activities.filter((activity) => activityId(activity) && matchesWorkout(activity, filter));
  matches.sort((a, b) => activityDate(b).localeCompare(activityDate(a)));
  return matches[0] ?? null;
}

export function summarizeWorkout(activity: JsonObject | null, stream: JsonObject | null = null): JsonObject {
  if (!activity) {
    return {
      found: false,
      warnings: ["No matching Garmin workout found."]
    };
  }
  const distanceMeters = numberValue(activity.distance_meters ?? activity.distanceMeters ?? activity.distance);
  const durationSeconds = numberValue(activity.duration_seconds ?? activity.durationSeconds ?? activity.elapsedDuration);
  const avgSpeedMps = numberValue(activity.avg_speed_mps ?? activity.averageSpeed ?? activity.avgSpeed);
  const maxSpeedMps = numberValue(activity.max_speed_mps ?? activity.maxSpeed);
  const category = classifySport(activityType(activity));
  const fields = Array.isArray(stream?.fields) ? stream.fields : [];
  const sampleCount = numberValue(stream?.sample_count) ?? (Array.isArray(stream?.samples) ? stream.samples.length : 0);

  return {
    found: true,
    activity_id: activityId(activity),
    activity_type: activityType(activity),
    sport_category: category,
    date: textValue(activity.date).slice(0, 10) || null,
    start_time: activity.start_time ?? activity.startTimeLocal ?? activity.startTimeGMT ?? null,
    duration_seconds: durationSeconds,
    moving_duration_seconds: activity.moving_duration_seconds ?? activity.movingDuration ?? null,
    distance_km: distanceMeters === null ? null : distanceMeters / 1000,
    pace_min_per_km: distanceMeters && durationSeconds ? durationSeconds / 60 / (distanceMeters / 1000) : null,
    avg_speed_kmh: avgSpeedMps === null ? (distanceMeters && durationSeconds ? (distanceMeters / durationSeconds) * 3.6 : null) : avgSpeedMps * 3.6,
    max_speed_kmh: maxSpeedMps === null ? null : maxSpeedMps * 3.6,
    avg_hr: activity.avg_hr ?? activity.averageHR ?? activity.averageHeartRate ?? null,
    max_hr: activity.max_hr ?? activity.maxHR ?? activity.maxHeartRate ?? null,
    avg_cadence: activity.avg_cadence ?? activity.averageRunCadence ?? activity.averageBikeCadence ?? null,
    max_cadence: activity.max_cadence ?? activity.maxRunCadence ?? activity.maxBikeCadence ?? null,
    elevation_gain_m: activity.elevation_gain_meters ?? activity.elevation_gain_m ?? activity.elevationGain ?? null,
    calories: activity.calories ?? null,
    training_effect: activity.training_effect ?? activity.trainingEffect ?? null,
    anaerobic_training_effect: activity.anaerobic_training_effect ?? activity.anaerobicTrainingEffect ?? null,
    aerobic_training_effect: activity.aerobic_training_effect ?? activity.aerobicTrainingEffect ?? null,
    normalized_power: activity.normalized_power ?? activity.normPower ?? null,
    avg_power: activity.avg_power ?? activity.averagePower ?? null,
    has_streams: stream !== null,
    stream_sample_count: sampleCount,
    stream_available_fields: fields,
    stream_missing_fields: stream?.availability && typeof stream.availability === "object" ? (stream.availability as JsonObject).missing_fields ?? [] : [],
    warnings: stream ? [] : ["No Garmin stream file found for this activity."],
    next_tool_hint: "For full Garmin streams, call get_latest_workout_streams or get_activity_streams."
  };
}

export function selectStreamFields(stream: JsonObject, fields?: string[]): JsonObject {
  if (!fields || fields.length === 0) {
    return stream;
  }
  const keep = new Set([...fields, ...preservedFields]);
  const samples = Array.isArray(stream.samples)
    ? stream.samples.map((sample) => {
        if (!sample || typeof sample !== "object") {
          return sample;
        }
        return Object.fromEntries(Object.entries(sample as JsonObject).filter(([key]) => keep.has(key)));
      })
    : [];
  const available = Array.isArray(stream.fields) ? stream.fields.filter((field) => keep.has(String(field))) : fields;
  return { ...stream, fields: available, samples };
}

export function downsampleStream(stream: JsonObject, maxPoints?: number | null): JsonObject {
  if (!maxPoints || maxPoints < 1 || !Array.isArray(stream.samples) || stream.samples.length <= maxPoints) {
    return stream;
  }
  const samples = stream.samples;
  const step = (samples.length - 1) / Math.max(1, maxPoints - 1);
  const selected = Array.from({ length: maxPoints }, (_, index) => samples[Math.round(index * step)]);
  return { ...stream, samples: selected, downsampled: true, original_sample_count: samples.length, sample_count: selected.length };
}

export function shapeStream(stream: JsonObject, options: { fields?: string[]; downsample?: boolean; max_points?: number | null }): JsonObject {
  const filtered = selectStreamFields(stream, options.fields);
  return options.downsample ? downsampleStream(filtered, options.max_points ?? null) : filtered;
}

export function analyze(activity: JsonObject | null, stream: JsonObject | null, includeStreams: boolean): JsonObject {
  const summary = summarizeWorkout(activity, stream);
  const samples = Array.isArray(stream?.samples) ? (stream.samples as JsonObject[]) : [];
  const heartRates = samples.map((sample) => numberValue(sample.heart_rate)).filter((value): value is number => value !== null);
  const speeds = samples.map((sample) => numberValue(sample.speed_mps)).filter((value): value is number => value !== null);
  const cadences = samples.map((sample) => numberValue(sample.cadence)).filter((value): value is number => value !== null);
  const powers = samples.map((sample) => numberValue(sample.power_watts)).filter((value): value is number => value !== null);
  const firstHalfHr = avg(heartRates.slice(0, Math.floor(heartRates.length / 2)));
  const secondHalfHr = avg(heartRates.slice(Math.floor(heartRates.length / 2)));
  const stopStartCount = speeds.filter((value, index, all) => value < 0.5 && index > 0 && (all[index - 1] ?? 0) >= 0.5).length;

  const result: JsonObject = {
    activity_summary: summary,
    sport_category: summary.sport_category ?? "other",
    stream_availability: stream?.availability ?? { available_fields: [], missing_fields: [], notes: ["No stream file available."] },
    missing_data_warnings: summary.warnings ?? [],
    hr_zones_time_distribution: heartRateDistribution(heartRates),
    hr_drift: firstHalfHr === null || secondHalfHr === null ? null : { first_half_avg_hr: firstHalfHr, second_half_avg_hr: secondHalfHr, drift_bpm: secondHalfHr - firstHalfHr },
    stop_start_count: stopStartCount,
    cadence_consistency: consistency(cadences),
    pace_speed_consistency: consistency(speeds),
    warmup_cooldown_pattern: warmupCooldown(heartRates),
    intensity_distribution: intensityDistribution(heartRates, speeds),
    recovery_load_estimate: recoveryLoad(summary, heartRates),
    power_hr_relation: powers.length && heartRates.length ? { avg_power_watts: avg(powers), avg_hr: avg(heartRates), samples_with_power: powers.length } : null,
    laps: stream?.laps ?? [],
    splits: stream?.splits ?? [],
    raw_stream_reference: {
      activity_id: summary.activity_id ?? null,
      recommended_tool: "get_activity_streams",
      note: "Call get_activity_streams for the full raw Garmin time-series samples."
    }
  };
  if (includeStreams) {
    result.streams = stream;
  }
  return result;
}

export async function allActivities(reader: GarminDataReader): Promise<JsonObject[]> {
  const latest = await reader.readCollection("activities").catch(() => [] as JsonObject[]);
  const archive = reader.readArchiveActivities ? await reader.readArchiveActivities() : [];
  const byId = new Map<string, JsonObject>();
  for (const activity of [...archive, ...latest]) {
    const id = activityId(activity);
    if (id) {
      byId.set(id, activity);
    }
  }
  return [...byId.values()];
}

function avg(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function consistency(values: number[]): JsonObject | null {
  const mean = avg(values);
  if (mean === null) {
    return null;
  }
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return { average: mean, standard_deviation: Math.sqrt(variance), sample_count: values.length };
}

function heartRateDistribution(values: number[]): JsonObject {
  return {
    low: values.filter((value) => value < 120).length,
    aerobic: values.filter((value) => value >= 120 && value < 150).length,
    threshold: values.filter((value) => value >= 150 && value < 170).length,
    high: values.filter((value) => value >= 170).length,
    samples: values.length
  };
}

function intensityDistribution(heartRates: number[], speeds: number[]): JsonObject {
  return {
    hr_samples: heartRates.length,
    speed_samples: speeds.length,
    avg_hr: avg(heartRates),
    avg_speed_mps: avg(speeds)
  };
}

function warmupCooldown(heartRates: number[]): JsonObject | null {
  if (heartRates.length < 6) {
    return null;
  }
  const window = Math.max(1, Math.floor(heartRates.length * 0.1));
  return {
    first_10_percent_avg_hr: avg(heartRates.slice(0, window)),
    last_10_percent_avg_hr: avg(heartRates.slice(-window))
  };
}

function recoveryLoad(summary: JsonObject, heartRates: number[]): JsonObject {
  const duration = numberValue(summary.duration_seconds) ?? 0;
  const avgHr = avg(heartRates) ?? numberValue(summary.avg_hr) ?? 0;
  return {
    load_score: Math.round((duration / 60) * Math.max(1, avgHr / 100)),
    basis: heartRates.length ? "stream_hr_duration" : "summary_duration_hr"
  };
}
