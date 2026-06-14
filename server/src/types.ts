export type JsonObject = Record<string, unknown>;

export interface Manifest {
  generated_at?: string;
  source?: string;
  date_range?: {
    start?: string;
    end?: string;
  };
  files?: Record<string, string>;
}

export interface ActivitySummary extends JsonObject {
  id: string;
  type?: string;
  date: string;
  distance_meters?: number;
  duration_seconds?: number;
  avg_hr?: number;
  calories?: number;
  training_effect?: number;
}

export interface GarminDataReader {
  readManifest(): Promise<Manifest>;
  readCollection(name: string): Promise<JsonObject[]>;
  readJson<T>(path: string): Promise<T>;
  readActivityDetail(activityId: string): Promise<JsonObject | null>;
}
