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
  readArchiveCollection(name: string, startDate: string, endDate: string): Promise<ArchiveCollectionResult>;
  readJson<T>(path: string): Promise<T>;
  readActivityDetail(activityId: string): Promise<JsonObject | null>;
  readActivityStream(activityId: string, source?: "latest" | "archive" | "auto"): Promise<JsonObject | null>;
  readArchiveActivities?(): Promise<JsonObject[]>;
}

export interface ArchiveCollectionResult {
  collection: string;
  start_date: string;
  end_date: string;
  rows: JsonObject[];
  coverage: {
    requested_partitions: string[];
    loaded_partitions: string[];
    missing_partitions: string[];
    available_start_date: string | null;
    available_end_date: string | null;
    missing_dates: string[];
    warnings: string[];
  };
}
