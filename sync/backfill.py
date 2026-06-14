from __future__ import annotations

"""Historical Garmin backfill command.

Backfill writes partitioned archive JSON by month, maintains a checkpoint, and
skips existing activity detail/stream files unless --force is used.
"""

import argparse
import time
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterable

from dotenv import load_dotenv

from .activity_streams import endpoint_payload, fetch_activity_payloads, normalize_activity_stream
from .garmin_sync.normalizers import (
    normalize_activity,
    normalize_activity_detail,
    normalize_body_battery,
    normalize_daily,
    normalize_hrv,
    normalize_sleep,
    normalize_stress,
)
from .garmin_sync.write_json import write_json
from .session_manager import DEFAULT_SESSION_FILE, login_or_restore


def run_backfill(
    *,
    start_date: str,
    end_date: str,
    output: Path,
    chunk_days: int = 7,
    sleep_seconds: float = 2,
    force: bool = False,
    skip_raw: bool = True,
    include_raw: bool = False,
    activity_details: bool = True,
    activity_streams: bool = True,
    session_file: Path = DEFAULT_SESSION_FILE,
    client: Any | None = None,
) -> None:
    # Validate the requested range before touching the archive checkpoint.
    start = parse_iso_date(start_date)
    end = parse_iso_date(end_date)
    if start > end:
        raise ValueError("start-date must be on or before end-date")
    if chunk_days < 1:
        raise ValueError("chunk-days must be at least 1")

    output.mkdir(parents=True, exist_ok=True)
    checkpoint_path = output / "backfill_checkpoint.json"
    started_at = datetime.now(timezone.utc)
    # By default backfill resumes after completed_until; --force starts over from start_date.
    resume_start = start if force else resume_date(start, load_checkpoint(checkpoint_path))
    write_checkpoint(
        checkpoint_path,
        status="running",
        started_at=started_at,
        start_date=start,
        end_date=end,
        completed_until=resume_start - timedelta(days=1),
        last_error=None,
    )

    garmin = client or login_or_restore(session_file=session_file)
    should_include_raw = include_raw or not skip_raw

    try:
        # Chunking keeps Garmin requests polite and makes interruption/resume practical.
        for chunk_start, chunk_end in chunk_ranges(resume_start, end, chunk_days):
            chunk_data = fetch_chunk(garmin, chunk_start, chunk_end, include_raw=should_include_raw)
            write_partitioned_rows(output, "daily", chunk_data["daily"])
            write_partitioned_rows(output, "sleep", chunk_data["sleep"])
            write_partitioned_rows(output, "hrv", chunk_data["hrv"])
            write_partitioned_rows(output, "stress", chunk_data["stress"])
            write_partitioned_rows(output, "body_battery", chunk_data["body_battery"])
            write_partitioned_rows(output, "activities", chunk_data["activities"])
            if should_include_raw:
                raw_dir = raw_output_dir(output)
                for dataset in ["daily", "sleep", "hrv", "stress", "body_battery", "activities"]:
                    write_partitioned_rows(raw_dir, dataset, chunk_data[f"raw_{dataset}"])

            if activity_details:
                write_activity_details(output, garmin, chunk_data["activities"], force=force, include_raw=should_include_raw)
            if activity_streams:
                write_activity_streams(output, garmin, chunk_data["activities"], force=force, include_raw=should_include_raw)

            write_checkpoint(
                checkpoint_path,
                status="running",
                started_at=started_at,
                start_date=start,
                end_date=end,
                completed_until=chunk_end,
                last_error=None,
            )
            if chunk_end < end and sleep_seconds > 0:
                time.sleep(sleep_seconds)

        manifest = generate_archive_manifest(output, start, end)
        write_json(output / "manifest.json", manifest | {"backfill_status": "success"})
        write_checkpoint(
            checkpoint_path,
            status="success",
            started_at=started_at,
            start_date=start,
            end_date=end,
            completed_until=end,
            last_error=None,
        )
    except Exception as exc:
        checkpoint = load_checkpoint(checkpoint_path) or {}
        completed_until = start - timedelta(days=1)
        if checkpoint.get("completed_until"):
            try:
                completed_until = parse_iso_date(str(checkpoint["completed_until"]))
            except ValueError:
                completed_until = start - timedelta(days=1)
        write_checkpoint(
            checkpoint_path,
            status="failed",
            started_at=started_at,
            start_date=start,
            end_date=end,
            completed_until=completed_until,
            last_error=str(exc),
        )
        raise


def fetch_chunk(client: Any, start: date, end: date, *, include_raw: bool = False) -> dict[str, list[dict[str, Any]]]:
    # Daily health data is fetched per day while activities can use a date-range endpoint when available.
    daily = []
    sleep = []
    hrv = []
    stress = []
    body_battery = []
    raw_payloads: dict[str, list[dict[str, Any]]] = {
        "daily": [],
        "sleep": [],
        "hrv": [],
        "stress": [],
        "body_battery": [],
        "activities": [],
    }

    for day in each_day(start, end):
        day_text = day.isoformat()
        daily_raw = safe_dict(getattr(client, "get_stats", None), day_text)
        readiness_raw = safe_dict(getattr(client, "get_training_readiness", None), day_text)
        sleep_raw = safe_dict(getattr(client, "get_sleep_data", None), day_text)
        hrv_raw = safe_dict(getattr(client, "get_hrv_data", None), day_text)
        stress_raw = safe_dict(getattr(client, "get_stress_data", None), day_text)
        body_battery_raw = safe_list(getattr(client, "get_body_battery", None), day_text, day_text)
        daily.append(normalize_daily(daily_raw | {"trainingReadiness": readiness_raw}, day))
        sleep.append(normalize_sleep(sleep_raw, day))
        hrv.append(normalize_hrv(hrv_raw, day))
        stress.append(normalize_stress(stress_raw, day))
        body_battery.append(normalize_body_battery(body_battery_raw, day))
        if include_raw:
            raw_payloads["daily"].append({"date": day_text, "payload": daily_raw, "training_readiness": readiness_raw})
            raw_payloads["sleep"].append({"date": day_text, "payload": sleep_raw})
            raw_payloads["hrv"].append({"date": day_text, "payload": hrv_raw})
            raw_payloads["stress"].append({"date": day_text, "payload": stress_raw})
            raw_payloads["body_battery"].append({"date": day_text, "payload": body_battery_raw})

    activities_raw = fetch_activities(client, start, end)
    activities = [normalize_activity(item) for item in activities_raw if isinstance(item, dict)]
    activities = [item for item in activities if item.get("id") and start.isoformat() <= str(item.get("date", "")) <= end.isoformat()]
    activities.sort(key=lambda item: str(item.get("date", "")))
    if include_raw:
        raw_payloads["activities"] = [{"date": str(normalize_activity(item).get("date", "")), "payload": item} for item in activities_raw if isinstance(item, dict)]

    return {
        "daily": daily,
        "sleep": sleep,
        "hrv": hrv,
        "stress": stress,
        "body_battery": body_battery,
        "activities": activities,
        "raw_daily": raw_payloads["daily"],
        "raw_sleep": raw_payloads["sleep"],
        "raw_hrv": raw_payloads["hrv"],
        "raw_stress": raw_payloads["stress"],
        "raw_body_battery": raw_payloads["body_battery"],
        "raw_activities": raw_payloads["activities"],
    }


def fetch_activities(client: Any, start: date, end: date) -> list[Any]:
    by_date = getattr(client, "get_activities_by_date", None)
    if by_date is not None:
        value = safe_list(by_date, start.isoformat(), end.isoformat())
        if value:
            return value
    activities = safe_list(getattr(client, "get_activities", None), 0, 500)
    return [item for item in activities if isinstance(item, dict)]


def write_partitioned_rows(output: Path, dataset: str, rows: list[dict[str, Any]]) -> None:
    # Archive partitions are month-based so historical tools can load only intersecting months.
    grouped: dict[tuple[int, int], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        row_date = parse_iso_date(str(row.get("date")))
        grouped[(row_date.year, row_date.month)].append(row)

    for (year, month), month_rows in grouped.items():
        path = output / dataset / f"year={year:04d}" / f"month={month:02d}" / f"{dataset}.json"
        existing = read_json_list(path)
        write_json(path, merge_rows_by_key(existing, month_rows, key="date" if dataset != "activities" else "id"))


def write_activity_details(output: Path, client: Any, activities: list[dict[str, Any]], *, force: bool = False, include_raw: bool = False) -> None:
    # Details are stored by activity ID to avoid re-downloading on resumed backfills.
    details_dir = output / "activity_details"
    details_dir.mkdir(parents=True, exist_ok=True)
    for activity in activities:
        activity_id = str(activity.get("id", ""))
        if not activity_id:
            continue
        path = details_dir / f"{activity_id}.json"
        if path.exists() and not force:
            continue
        payloads = fetch_activity_payloads(client, activity_id)
        detail_raw = endpoint_payload(payloads.get("activity")) if isinstance(endpoint_payload(payloads.get("activity")), dict) else {}
        if not detail_raw and isinstance(endpoint_payload(payloads.get("activity_details")), dict):
            detail_raw = endpoint_payload(payloads.get("activity_details"))
        write_json(path, normalize_activity_detail(detail_raw or activity, fallback=activity))
        if include_raw:
            write_json(raw_output_dir(output) / "activity_details" / f"{activity_id}.json", payloads)


def write_activity_streams(output: Path, client: Any, activities: list[dict[str, Any]], *, force: bool = False, include_raw: bool = False) -> None:
    # Streams are also stored by activity ID because they are large and reusable across analyses.
    streams_dir = output / "activity_streams"
    streams_dir.mkdir(parents=True, exist_ok=True)
    for activity in activities:
        activity_id = str(activity.get("id", ""))
        if not activity_id:
            continue
        path = streams_dir / f"{activity_id}.json"
        if path.exists() and not force:
            continue
        payloads = fetch_activity_payloads(client, activity_id)
        write_json(path, normalize_activity_stream(activity_id, payloads))
        if include_raw:
            write_json(raw_output_dir(output) / "activity_streams" / f"{activity_id}.json", payloads)


def generate_archive_manifest(output: Path, start: date, end: date) -> dict[str, Any]:
    dataset_counts = {
        name: count_partition_rows(output / name, f"{name}.json")
        for name in ["daily", "sleep", "hrv", "stress", "body_battery", "activities"]
    }
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "earliest_date": start.isoformat(),
        "latest_date": end.isoformat(),
        "total_activities": dataset_counts["activities"],
        "dataset_counts": dataset_counts,
        "backfill_status": "running",
    }


def raw_output_dir(output: Path) -> Path:
    return output / "raw"


def count_partition_rows(root: Path, filename: str) -> int:
    total = 0
    for path in root.glob(f"year=*/month=*/{filename}"):
        total += len(read_json_list(path))
    return total


def chunk_ranges(start: date, end: date, chunk_days: int) -> list[tuple[date, date]]:
    ranges = []
    current = start
    while current <= end:
        chunk_end = min(current + timedelta(days=chunk_days - 1), end)
        ranges.append((current, chunk_end))
        current = chunk_end + timedelta(days=1)
    return ranges


def resume_date(start: date, checkpoint: dict[str, Any] | None) -> date:
    if not checkpoint or not checkpoint.get("completed_until"):
        return start
    completed_until = parse_iso_date(str(checkpoint["completed_until"]))
    return max(start, completed_until + timedelta(days=1))


def load_checkpoint(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        import json

        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def write_checkpoint(
    path: Path,
    *,
    status: str,
    started_at: datetime,
    start_date: date,
    end_date: date,
    completed_until: date,
    last_error: str | None,
) -> None:
    write_json(
        path,
        {
            "status": status,
            "started_at": started_at.isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "completed_until": completed_until.isoformat(),
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "last_error": last_error,
        },
    )


def merge_rows_by_key(existing: list[dict[str, Any]], new_rows: list[dict[str, Any]], *, key: str) -> list[dict[str, Any]]:
    merged = {str(row.get(key)): row for row in existing if row.get(key) is not None}
    for row in new_rows:
        if row.get(key) is not None:
            merged[str(row[key])] = row
    return sorted(merged.values(), key=lambda row: str(row.get("date", row.get(key, ""))))


def read_json_list(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        import json

        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, list) else []
    except Exception:
        return []


def each_day(start: date, end: date) -> Iterable[date]:
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def parse_iso_date(value: str | date) -> date:
    if isinstance(value, date):
        return value
    return date.fromisoformat(value)


def safe_dict(func: Callable[..., Any] | None, *args: Any) -> dict[str, Any]:
    if func is None:
        return {}
    try:
        value = func(*args)
        return value if isinstance(value, dict) else {}
    except Exception:
        return {}


def safe_list(func: Callable[..., Any] | None, *args: Any) -> list[Any]:
    if func is None:
        return []
    try:
        value = func(*args)
        return value if isinstance(value, list) else []
    except Exception:
        return []


def bool_arg(value: str) -> bool:
    lowered = value.lower()
    if lowered in {"1", "true", "yes", "on"}:
        return True
    if lowered in {"0", "false", "no", "off"}:
        return False
    raise argparse.ArgumentTypeError("Use true or false.")


def main() -> None:
    load_dotenv()
    parser = argparse.ArgumentParser(description="Backfill historical Garmin data into a partitioned local archive.")
    parser.add_argument("--start-date", required=True)
    parser.add_argument("--end-date", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--chunk-days", type=int, default=7)
    parser.add_argument("--sleep-seconds", type=float, default=2)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--skip-raw", type=bool_arg, default=True)
    parser.add_argument("--include-raw", type=bool_arg, default=False)
    parser.add_argument("--activity-details", type=bool_arg, default=True)
    parser.add_argument("--activity-streams", type=bool_arg, default=True)
    parser.add_argument("--session-file", type=Path, default=Path(DEFAULT_SESSION_FILE))
    args = parser.parse_args()
    run_backfill(
        start_date=args.start_date,
        end_date=args.end_date,
        output=args.output,
        chunk_days=args.chunk_days,
        sleep_seconds=args.sleep_seconds,
        force=args.force,
        skip_raw=args.skip_raw,
        include_raw=args.include_raw,
        activity_details=args.activity_details,
        activity_streams=args.activity_streams,
        session_file=args.session_file,
    )


if __name__ == "__main__":
    main()
