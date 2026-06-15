// Authenticated background sync launcher used by the sync_now MCP tool.
//
// This module creates a lock file, writes running status, starts Python sync in
// the background, and cleans the lock on exit. It deliberately does not expose
// any unauthenticated HTTP endpoint.
import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { JsonObject } from "./types.js";

export interface SyncNowInput {
  days?: number;
  force_login?: boolean;
  force_refresh?: boolean;
  activity_streams?: boolean;
  include_raw?: boolean;
}

export interface SyncNowOptions {
  dataDir?: string;
  spawnProcess?: (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; stdio: "ignore" }) => ChildProcess;
}

export async function syncNow(input: SyncNowInput, options: SyncNowOptions = {}): Promise<JsonObject> {
  // sync_now is asynchronous: the MCP call starts work, then clients poll status.
  const dataDir = options.dataDir ?? process.env.GARMIN_DATA_DIR ?? "/app/data/latest";
  const lockPath = path.join(dataDir, "sync.lock");
  const statusPath = path.join(dataDir, "latest_sync_status.json");
  // Existing lock means another sync is already running.
  const existing = await readJson(lockPath);
  if (existing?.job_id) {
    return {
      status: "already_running",
      job_id: existing.job_id,
      started_at: existing.started_at
    };
  }

  await fs.mkdir(dataDir, { recursive: true });
  const jobId = randomUUID();
  const startedAt = new Date().toISOString();
  const lock = { job_id: jobId, started_at: startedAt, days: input.days ?? 7 };
  await fs.writeFile(lockPath, JSON.stringify(lock, null, 2), "utf8");
  await fs.writeFile(
    statusPath,
    JSON.stringify({ status: "running", job_id: jobId, started_at: startedAt, completed_at: null }, null, 2),
    "utf8"
  );

  // Keep arguments explicit so scheduled sync and manual sync behave the same way.
  const args = [
    "-m",
    "sync.main",
    "--days",
    String(input.days ?? 7),
    "--output",
    dataDir,
    "--activity-streams",
    String(input.activity_streams ?? true),
    "--include-raw",
    String(input.include_raw ?? true),
    "--activity-details",
    "true"
  ];
  if (input.force_login) {
    args.push("--force-login");
  }
  if (input.force_refresh) {
    args.push("--force-refresh");
  }

  const spawnProcess = options.spawnProcess ?? spawn;
  // Run from the repo/app root so "python -m sync.main" can import the sync package.
  const child = spawnProcess("python", args, {
    cwd: path.resolve(dataDir, "..", ".."),
    env: process.env,
    stdio: "ignore"
  });
  // Background completion updates status without blocking the MCP response.
  child.once("exit", async (code) => {
    const completedAt = new Date().toISOString();
    try {
      if (code === 0) {
        await fs.rm(lockPath, { force: true });
      } else {
        await fs.writeFile(
          statusPath,
          JSON.stringify({ status: "failed", job_id: jobId, started_at: startedAt, completed_at: completedAt, exit_code: code }, null, 2),
          "utf8"
        );
        await fs.rm(lockPath, { force: true });
      }
    } catch {
      // Avoid surfacing background cleanup failures to the HTTP request path.
    }
  });
  child.unref?.();

  return {
    status: "started",
    job_id: jobId,
    started_at: startedAt,
    force_refresh: input.force_refresh ?? false,
    message: "Sync started"
  };
}

export async function runningSyncState(dataDir: string): Promise<JsonObject | null> {
  // A lock file is the source of truth for "currently running" even if status is stale.
  const lock = await readJson(path.join(dataDir, "sync.lock"));
  if (!lock?.started_at) {
    return null;
  }
  const started = Date.parse(String(lock.started_at));
  const ageSeconds = Number.isFinite(started) ? Math.round((Date.now() - started) / 1000) : null;
  return {
    status: "running",
    job_id: lock.job_id ?? null,
    started_at: lock.started_at,
    age_seconds: ageSeconds,
    warnings: ageSeconds !== null && ageSeconds > 60 * 60 * 6 ? ["Sync lock is older than 6 hours. Check logs before deleting sync.lock."] : []
  };
}

async function readJson(file: string): Promise<JsonObject | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as JsonObject;
  } catch {
    return null;
  }
}
