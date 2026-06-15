from __future__ import annotations

"""Targeted activity-detail repair for latest/archive Garmin JSON."""

import argparse
import json
import time
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

from .activity_streams import endpoint_payload, fetch_activity_payloads
from .backfill import bool_arg, parse_iso_date
from .garmin_sync.normalizers import normalize_activity_detail
from .garmin_sync.write_json import write_json
from .session_manager import DEFAULT_SESSION_FILE, login_or_restore


STATUS_FILE = "activity_detail_repair_status.json"


def run_repair(
    *,
    start_date: str,
    end_date: str,
    output: Path,
    sleep_seconds: float = 1,
    force: bool = False,
    include_raw: bool = True,
    source: str = "archive",
    session_file: Path = DEFAULT_SESSION_FILE,
    client: Any | None = None,
) -> dict[str, Any]:
    start = parse_iso_date(start_date)
    end = parse_iso_date(end_date)
    if start > end:
        raise ValueError("start-date must be on or before end-date")
    if source not in {"archive", "latest"}:
        raise ValueError("source must be archive or latest")

    output.mkdir(parents=True, exist_ok=True)
    started_at = datetime.now(timezone.utc)
    status_path = output / STATUS_FILE
    previous_status = read_json_dict(status_path)
    completed_ids = set(previous_status.get("completed_activity_ids", [])) if previous_status and not force else set()
    activities = load_activities(output, start, end, source=source)
    detail_dir = output / "activity_details"
    detail_dir.mkdir(parents=True, exist_ok=True)
    existing_ids = {activity_id for activity in activities if (activity_id := activity_identifier(activity)) and (detail_dir / f"{activity_id}.json").exists()}
    missing_ids = [activity_id for activity in activities if (activity_id := activity_identifier(activity)) and activity_id not in existing_ids]
    garmin = client or login_or_restore(session_file=session_file)

    repaired = 0
    failed = 0
    failures: list[dict[str, str]] = []
    to_fetch = activities if force else [activity for activity in activities if activity_identifier(activity) not in existing_ids and activity_identifier(activity) not in completed_ids]

    for index, activity in enumerate(to_fetch):
        activity_id = activity_identifier(activity)
        if not activity_id:
            continue
        try:
            payloads = fetch_activity_payloads(garmin, activity_id)
            detail_raw = detail_payload(payloads)
            write_json(detail_dir / f"{activity_id}.json", normalize_activity_detail(detail_raw or activity, fallback=activity))
            if include_raw:
                write_json(output / "raw" / "activity_details" / f"{activity_id}.json", payloads)
            repaired += 1
            completed_ids.add(activity_id)
        except Exception as exc:
            failed += 1
            failures.append({"activity_id": activity_id, "error": str(exc)})
        write_repair_status(
            status_path,
            started_at=started_at,
            start=start,
            end=end,
            source=source,
            force=force,
            include_raw=include_raw,
            total_activities=len(activities),
            existing_details=len(existing_ids),
            missing_details=len(missing_ids),
            repaired_details=repaired,
            failed_details=failed,
            failures=failures,
            completed_activity_ids=sorted(completed_ids),
            status="running",
        )
        if index < len(to_fetch) - 1 and sleep_seconds > 0:
            time.sleep(sleep_seconds)

    status = write_repair_status(
        status_path,
        started_at=started_at,
        start=start,
        end=end,
        source=source,
        force=force,
        include_raw=include_raw,
        total_activities=len(activities),
        existing_details=len(existing_ids),
        missing_details=len(missing_ids),
        repaired_details=repaired,
        failed_details=failed,
        failures=failures,
        completed_activity_ids=sorted(completed_ids),
        status="success" if failed == 0 else "warning",
        completed_at=datetime.now(timezone.utc),
    )
    try:
        from .archive_maintenance import build_partition_manifest

        build_partition_manifest(output)
    except Exception:
        pass
    return status


def load_activities(output: Path, start: date, end: date, *, source: str = "archive") -> list[dict[str, Any]]:
    if source == "latest":
        rows = read_json_list(output / "activities.json")
    else:
        rows = []
        for path in sorted((output / "activities").glob("year=*/month=*/activities.json")):
            rows.extend(read_json_list(path))
    filtered = [row for row in rows if start.isoformat() <= str(row.get("date", ""))[:10] <= end.isoformat()]
    return sorted(filtered, key=lambda row: str(row.get("date", "")))


def detail_payload(payloads: dict[str, Any]) -> dict[str, Any]:
    activity = endpoint_payload(payloads.get("activity"))
    if isinstance(activity, dict):
        return activity
    details = endpoint_payload(payloads.get("activity_details"))
    return details if isinstance(details, dict) else {}


def activity_identifier(activity: dict[str, Any]) -> str | None:
    value = activity.get("id") or activity.get("activity_id") or activity.get("activityId")
    return str(value) if value else None


def read_json_list(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    value = json.loads(path.read_text(encoding="utf-8"))
    return value if isinstance(value, list) else []


def read_json_dict(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except Exception:
        return {}


def write_repair_status(
    path: Path,
    *,
    started_at: datetime,
    start: date,
    end: date,
    source: str,
    force: bool,
    include_raw: bool,
    total_activities: int,
    existing_details: int,
    missing_details: int,
    repaired_details: int,
    failed_details: int,
    failures: list[dict[str, str]],
    completed_activity_ids: list[str],
    status: str,
    completed_at: datetime | None = None,
) -> dict[str, Any]:
    payload = {
        "status": status,
        "started_at": started_at.isoformat(),
        "completed_at": completed_at.isoformat() if completed_at else None,
        "requested_start_date": start.isoformat(),
        "requested_end_date": end.isoformat(),
        "source": source,
        "force": force,
        "include_raw": include_raw,
        "total_activities": total_activities,
        "existing_details": existing_details,
        "missing_details": missing_details,
        "repaired_details": repaired_details,
        "failed_details": failed_details,
        "failures": failures,
        "completed_activity_ids": completed_activity_ids,
    }
    write_json(path, payload)
    return payload


def main() -> None:
    load_dotenv()
    parser = argparse.ArgumentParser(description="Repair missing Garmin activity detail files without rerunning full backfill.")
    parser.add_argument("--start-date", required=True)
    parser.add_argument("--end-date", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--sleep-seconds", type=float, default=1)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--include-raw", type=bool_arg, default=True)
    parser.add_argument("--source", choices=["archive", "latest"], default="archive")
    parser.add_argument("--session-file", type=Path, default=Path(DEFAULT_SESSION_FILE))
    args = parser.parse_args()
    run_repair(
        start_date=args.start_date,
        end_date=args.end_date,
        output=args.output,
        sleep_seconds=args.sleep_seconds,
        force=args.force,
        include_raw=args.include_raw,
        source=args.source,
        session_file=args.session_file,
    )


if __name__ == "__main__":
    main()
