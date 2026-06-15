from __future__ import annotations

"""Archive rollups and partition manifest maintenance."""

import argparse
import json
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from .backfill import parse_iso_date, read_json_list
from .garmin_sync.write_json import write_json
from .time_metadata import local_day_bounds, normalized_metadata

SCHEMA_VERSION = "archive_rollups_v1"
DATASETS = ["daily", "sleep", "hrv", "stress", "body_battery", "activities"]


def build_partition_manifest(output: Path) -> dict[str, Any]:
    datasets: dict[str, Any] = {}
    for dataset in DATASETS:
        dates: dict[str, Any] = {}
        partitions: dict[str, Any] = {}
        for path in sorted((output / dataset).glob("year=*/month=*/*.json")):
            rel = path.relative_to(output).as_posix()
            rows = read_json_list(path)
            partitions[rel] = {"record_count": len(rows)}
            for row in rows:
                row_date = str(row.get("date", ""))[:10]
                if not row_date:
                    continue
                current = dates.setdefault(row_date, {"record_count": 0, "partition": rel})
                current["record_count"] += 1
        sorted_dates = sorted(dates)
        datasets[dataset] = {
            "record_count": sum(item["record_count"] for item in dates.values()),
            "date_bounds": {"start": sorted_dates[0] if sorted_dates else None, "end": sorted_dates[-1] if sorted_dates else None},
            "dates": dates,
            "partitions": partitions,
        }
    detail_count = len(list((output / "activity_details").glob("*.json")))
    stream_count = len(list((output / "activity_streams").glob("*.json")))
    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "schema_version": SCHEMA_VERSION,
        "datasets": datasets,
        "activity_details": {"record_count": detail_count},
        "activity_streams": {"record_count": stream_count},
    }
    write_json(output / "partition_manifest.json", manifest)
    return manifest


def verify_partition_manifest(output: Path) -> dict[str, Any]:
    manifest_path = output / "partition_manifest.json"
    existing = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    rebuilt = build_partition_manifest(output)
    drift: list[dict[str, Any]] = []
    for dataset in DATASETS:
        old_count = (((existing.get("datasets") or {}).get(dataset) or {}).get("record_count"))
        new_count = rebuilt["datasets"][dataset]["record_count"]
        if old_count != new_count:
            drift.append({"dataset": dataset, "manifest_record_count": old_count, "disk_record_count": new_count})
    result = {"status": "ok" if not drift else "warning", "drift": drift, "checked_at": datetime.now(timezone.utc).isoformat()}
    write_json(output / "partition_manifest_verify.json", result)
    return result


def build_rollups(output: Path, start_date: str, end_date: str, *, schema_version: str = SCHEMA_VERSION) -> dict[str, Any]:
    start = parse_iso_date(start_date)
    end = parse_iso_date(end_date)
    activities = load_rows(output, "activities", start, end)
    sleep = load_rows(output, "sleep", start, end)
    weekly = grouped_activity_rollups(activities, key_func=week_key)
    monthly = grouped_activity_rollups(activities, key_func=lambda row: str(row.get("date", ""))[:7])
    sleep_weekly = grouped_sleep_rollups(sleep, key_func=week_key)
    written: list[str] = []
    for key, value in weekly.items():
        written.append(write_rollup(output, "weekly", key, value, schema_version))
    for key, value in monthly.items():
        written.append(write_rollup(output, "monthly", key, value, schema_version))
    for key, value in sleep_weekly.items():
        path = output / "rollups" / "sleep_weekly" / f"{key}.json"
        write_json(path, rollup_payload(value, schema_version))
        written.append(path.relative_to(output).as_posix())
    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "schema_version": schema_version,
        "requested_start_date": start_date,
        "requested_end_date": end_date,
        "local_day_bounds": {"start": local_day_bounds(start_date)["local_day_start"], "end": local_day_bounds(end_date)["local_day_end"]},
        **normalized_metadata(start_date),
        "written": sorted(written),
    }
    write_json(output / "rollups" / "manifest.json", summary)
    return summary


def load_rows(output: Path, dataset: str, start: date, end: date) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for path in sorted((output / dataset).glob("year=*/month=*/*.json")):
        for row in read_json_list(path):
            row_date = str(row.get("date", ""))[:10]
            if start.isoformat() <= row_date <= end.isoformat():
                rows.append(row)
    return rows


def grouped_activity_rollups(rows: list[dict[str, Any]], *, key_func) -> dict[str, dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[key_func(row)].append(row)
    return {key: activity_rollup(key, group) for key, group in grouped.items() if key}


def grouped_sleep_rollups(rows: list[dict[str, Any]], *, key_func) -> dict[str, dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[key_func(row)].append(row)
    return {
        key: {
            "period": key,
            "sleep_days": len(group),
            "avg_sleep_seconds": avg(number(row.get("total_sleep_seconds")) for row in group),
            "avg_sleep_score": avg(number(row.get("sleep_score")) for row in group),
        }
        for key, group in grouped.items()
        if key
    }


def activity_rollup(key: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
    duration_by_sport: dict[str, float] = defaultdict(float)
    counts_by_sport: dict[str, int] = defaultdict(int)
    total_duration = 0.0
    total_distance = 0.0
    for row in rows:
        sport = str(row.get("type") or row.get("sport_category") or "unknown")
        duration = number(row.get("duration_seconds"))
        distance = number(row.get("distance_meters"))
        total_duration += duration
        total_distance += distance
        duration_by_sport[sport] += duration
        counts_by_sport[sport] += 1
    return {
        "period": key,
        "activity_count": len(rows),
        "total_duration_seconds": total_duration,
        "total_distance_meters": total_distance,
        "duration_by_sport_seconds": dict(duration_by_sport),
        "activities_by_sport": dict(counts_by_sport),
        "training_load_trend": {
            "duration_seconds": total_duration,
            "activity_count": len(rows),
        },
    }


def write_rollup(output: Path, kind: str, key: str, value: dict[str, Any], schema_version: str) -> str:
    path = output / "rollups" / kind / f"{key}.json"
    write_json(path, rollup_payload(value, schema_version))
    return path.relative_to(output).as_posix()


def rollup_payload(value: dict[str, Any], schema_version: str) -> dict[str, Any]:
    return {"generated_at": datetime.now(timezone.utc).isoformat(), "schema_version": schema_version, "stale": False, **normalized_metadata(), **value}


def stale_rollups(output: Path, *, schema_version: str = SCHEMA_VERSION) -> list[str]:
    stale: list[str] = []
    for path in (output / "rollups").glob("*/*.json"):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            stale.append(path.relative_to(output).as_posix())
            continue
        if payload.get("schema_version") != schema_version or payload.get("stale"):
            stale.append(path.relative_to(output).as_posix())
    return sorted(stale)


def mark_rollups_stale(output: Path) -> None:
    for path in (output / "rollups").glob("*/*.json"):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        payload["stale"] = True
        write_json(path, payload)


def week_key(row: dict[str, Any]) -> str:
    text = str(row.get("date", ""))[:10]
    if not text:
        return ""
    iso = date.fromisoformat(text).isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def number(value: Any) -> float:
    return float(value) if isinstance(value, (int, float)) else 0.0


def avg(values) -> float | None:
    present = [value for value in values if value is not None]
    return sum(present) / len(present) if present else None


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Garmin archive partition manifests and rollups.")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--start-date", required=True)
    parser.add_argument("--end-date", required=True)
    parser.add_argument("--schema-version", default=SCHEMA_VERSION)
    parser.add_argument("--verify-manifest", action="store_true")
    args = parser.parse_args()
    build_partition_manifest(args.output)
    if args.verify_manifest:
        verify_partition_manifest(args.output)
    build_rollups(args.output, args.start_date, args.end_date, schema_version=args.schema_version)


if __name__ == "__main__":
    main()
