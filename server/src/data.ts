// Data readers hide storage details from MCP tools.
//
// LocalDataReader supports latest files plus partitioned archive files. GcsDataReader
// supports latest GCS reads for Cloud Run/GCS mode.
import { Storage } from "@google-cloud/storage";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ArchiveCollectionResult, GarminDataReader, JsonObject, Manifest } from "./types.js";

const collectionFiles: Record<string, string> = {
  daily: "daily.json",
  sleep: "sleep.json",
  hrv: "hrv.json",
  stress: "stress.json",
  body_battery: "body_battery.json",
  activities: "activities.json"
};

export class LocalDataReader implements GarminDataReader {
  // baseDir normally points at /app/data/latest; archive is resolved as a sibling.
  constructor(private readonly baseDir: string) {}

  async readManifest(): Promise<Manifest> {
    return this.readJson<Manifest>("manifest.json");
  }

  async readCollection(name: string): Promise<JsonObject[]> {
    const file = collectionFiles[name];
    if (!file) {
      throw new Error(`Unknown collection: ${name}`);
    }
    return this.readJson<JsonObject[]>(file);
  }

  async readArchiveCollection(name: string, startDate: string, endDate: string): Promise<ArchiveCollectionResult> {
    const file = collectionFiles[name];
    if (!file) {
      throw new Error(`Unknown collection: ${name}`);
    }
    const rows: JsonObject[] = [];
    const requested = monthPartitions(startDate, endDate);
    const loaded: string[] = [];
    const missing: string[] = [];

    // Only read month partitions that intersect the requested range.
    for (const partition of requested) {
      const relative = path.join(name, `year=${partition.year}`, `month=${partition.month}`, file);
      const fullPath = path.join(this.archiveDir(), relative);
      try {
        const parsed = JSON.parse(await fs.readFile(fullPath, "utf8")) as unknown;
        if (Array.isArray(parsed)) {
          rows.push(...(parsed.filter((row) => row && typeof row === "object") as JsonObject[]));
        }
        loaded.push(relative);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          missing.push(relative);
        } else {
          throw error;
        }
      }
    }

    // Filter exact dates after loading because monthly partitions can contain extra days.
    const filtered = filterRowsByDate(rows, startDate, endDate);
    const dates = new Set(filtered.map((row) => rowDate(row)).filter((date): date is string => date !== null));
    const availableDates = [...dates].sort();
    const missingDates = eachDate(startDate, endDate).filter((date) => !dates.has(date));
    const warnings = [
      ...(missing.length ? [`Missing archive partitions: ${missing.join(", ")}`] : []),
      ...(missingDates.length ? [`Missing ${missingDates.length} date(s) in ${name} archive data for requested range.`] : [])
    ];

    return {
      collection: name,
      start_date: startDate,
      end_date: endDate,
      rows: filtered,
      coverage: {
        requested_partitions: requested.map((partition) => path.join(name, `year=${partition.year}`, `month=${partition.month}`, file)),
        loaded_partitions: loaded,
        missing_partitions: missing,
        available_start_date: availableDates[0] ?? null,
        available_end_date: availableDates[availableDates.length - 1] ?? null,
        missing_dates: missingDates,
        warnings
      }
    };
  }

  async readJson<T>(relativePath: string): Promise<T> {
    // Some older manifests include a latest/ prefix even when baseDir already points at latest.
    const safePath = relativePath.replace(/^latest\//, "");
    const fullPath = path.join(this.baseDir, safePath);
    const raw = await fs.readFile(fullPath, "utf8");
    return JSON.parse(raw) as T;
  }

  async readActivityDetail(activityId: string): Promise<JsonObject | null> {
    try {
      return await this.readJson<JsonObject>(path.join("activity_details", `${activityId}.json`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async readActivityStream(activityId: string, source: "latest" | "archive" | "auto" = "auto"): Promise<JsonObject | null> {
    // Auto mode checks latest first so recent syncs override older archive files.
    const candidates =
      source === "latest"
        ? [path.join(this.baseDir, "activity_streams", `${activityId}.json`)]
        : source === "archive"
          ? [path.join(this.archiveDir(), "activity_streams", `${activityId}.json`)]
          : [
              path.join(this.baseDir, "activity_streams", `${activityId}.json`),
              path.join(this.archiveDir(), "activity_streams", `${activityId}.json`)
            ];

    for (const fullPath of candidates) {
      try {
        const raw = await fs.readFile(fullPath, "utf8");
        return JSON.parse(raw) as JsonObject;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
    }
    return null;
  }

  async readArchiveActivities(): Promise<JsonObject[]> {
    // Capability and period tools need the full archive activity index.
    const archive = this.archiveDir();
    const rows: JsonObject[] = [];
    try {
      const years = await fs.readdir(path.join(archive, "activities"));
      for (const year of years) {
        if (!year.startsWith("year=")) {
          continue;
        }
        const months = await fs.readdir(path.join(archive, "activities", year));
        for (const month of months) {
          if (!month.startsWith("month=")) {
            continue;
          }
          try {
            const raw = await fs.readFile(path.join(archive, "activities", year, month, "activities.json"), "utf8");
            const parsed = JSON.parse(raw) as unknown;
            if (Array.isArray(parsed)) {
              rows.push(...(parsed.filter((row) => row && typeof row === "object") as JsonObject[]));
            }
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
              throw error;
            }
          }
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    return rows;
  }

  private archiveDir(): string {
    // In self-hosted mode GARMIN_DATA_DIR points at /app/data/latest; archive is its sibling.
    return path.resolve(this.baseDir, "..", "archive");
  }
}

export class GcsDataReader implements GarminDataReader {
  // GCS mode is latest-focused for Cloud Run; historical archive remains local.
  private readonly storage = new Storage();

  constructor(
    private readonly bucketName: string,
    private readonly prefix = "latest"
  ) {}

  async readManifest(): Promise<Manifest> {
    return this.readJson<Manifest>(`${this.prefix}/manifest.json`);
  }

  async readCollection(name: string): Promise<JsonObject[]> {
    const manifest = await this.readManifest();
    const objectName = manifest.files?.[name] ?? `${this.prefix}/${collectionFiles[name]}`;
    if (!objectName) {
      throw new Error(`Unknown collection: ${name}`);
    }
    return this.readJson<JsonObject[]>(objectName);
  }

  async readArchiveCollection(name: string, startDate: string, endDate: string): Promise<ArchiveCollectionResult> {
    // Archive range reads are currently local-only because archive partitions are a TrueNAS-first feature.
    return {
      collection: name,
      start_date: startDate,
      end_date: endDate,
      rows: [],
      coverage: {
        requested_partitions: [],
        loaded_partitions: [],
        missing_partitions: [],
        available_start_date: null,
        available_end_date: null,
        missing_dates: [],
        warnings: ["Archive range queries are currently available for local self-hosted archive storage."]
      }
    };
  }

  async readJson<T>(objectName: string): Promise<T> {
    const [buffer] = await this.storage.bucket(this.bucketName).file(objectName).download();
    return JSON.parse(buffer.toString("utf8")) as T;
  }

  async readActivityDetail(activityId: string): Promise<JsonObject | null> {
    try {
      return await this.readJson<JsonObject>(`${this.prefix}/activity_details/${activityId}.json`);
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code === 404) {
        return null;
      }
      throw error;
    }
  }

  async readActivityStream(activityId: string, source: "latest" | "archive" | "auto" = "auto"): Promise<JsonObject | null> {
    if (source === "archive") {
      return null;
    }
    try {
      return await this.readJson<JsonObject>(`${this.prefix}/activity_streams/${activityId}.json`);
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code === 404) {
        return null;
      }
      throw error;
    }
  }
}

function monthPartitions(startDate: string, endDate: string): Array<{ year: string; month: string }> {
  // Partition names mirror the backfill writer: year=YYYY/month=MM.
  const start = new Date(`${startDate.slice(0, 7)}-01T00:00:00Z`);
  const end = new Date(`${endDate.slice(0, 7)}-01T00:00:00Z`);
  const partitions: Array<{ year: string; month: string }> = [];
  const current = start;
  while (current <= end) {
    partitions.push({
      year: String(current.getUTCFullYear()).padStart(4, "0"),
      month: String(current.getUTCMonth() + 1).padStart(2, "0")
    });
    current.setUTCMonth(current.getUTCMonth() + 1);
  }
  return partitions;
}

function filterRowsByDate(rows: JsonObject[], startDate: string, endDate: string): JsonObject[] {
  // Archive rows may use activity start fields instead of a normalized date field.
  return rows.filter((row) => {
    const date = rowDate(row);
    return date !== null && date >= startDate && date <= endDate;
  });
}

function rowDate(row: JsonObject): string | null {
  const value = row.date ?? row.start_time ?? row.startTimeLocal ?? row.startTimeGMT;
  return typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : null;
}

function eachDate(startDate: string, endDate: string): string[] {
  // Used for coverage warnings so clients can see missing days, not just missing files.
  const dates: string[] = [];
  const current = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

export function createDataReader(): GarminDataReader {
  // Explicit local mode wins even if GCS_BUCKET is present in the environment.
  const mode = process.env.GARMIN_DATA_MODE;
  const bucket = process.env.GCS_BUCKET;
  if (bucket && mode !== "local") {
    return new GcsDataReader(bucket, process.env.GCS_PREFIX ?? "latest");
  }
  return new LocalDataReader(
    process.env.GARMIN_DATA_DIR ?? process.env.SERVER_DATA_DIR ?? path.resolve(process.cwd(), "../sample-data")
  );
}
