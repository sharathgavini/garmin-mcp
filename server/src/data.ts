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
}

export function createDataReader(): GarminDataReader {
  const bucket = process.env.GCS_BUCKET;
  if (bucket) {
    return new GcsDataReader(bucket, process.env.GCS_PREFIX ?? "latest");
  }
  return new LocalDataReader(process.env.SERVER_DATA_DIR ?? path.resolve(process.cwd(), "../sample-data"));
}
