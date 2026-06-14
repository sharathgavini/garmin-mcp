import { Storage } from "@google-cloud/storage";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { GarminDataReader, JsonObject, Manifest } from "./types.js";

const collectionFiles: Record<string, string> = {
  daily: "daily.json",
  sleep: "sleep.json",
  hrv: "hrv.json",
  stress: "stress.json",
  body_battery: "body_battery.json",
  activities: "activities.json"
};

export class LocalDataReader implements GarminDataReader {
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

  async readJson<T>(relativePath: string): Promise<T> {
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
    return path.resolve(this.baseDir, "..", "archive");
  }
}

export class GcsDataReader implements GarminDataReader {
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

export function createDataReader(): GarminDataReader {
  const mode = process.env.GARMIN_DATA_MODE;
  const bucket = process.env.GCS_BUCKET;
  if (bucket && mode !== "local") {
    return new GcsDataReader(bucket, process.env.GCS_PREFIX ?? "latest");
  }
  return new LocalDataReader(
    process.env.GARMIN_DATA_DIR ?? process.env.SERVER_DATA_DIR ?? path.resolve(process.cwd(), "../sample-data")
  );
}
