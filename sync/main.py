from __future__ import annotations

import argparse
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

from dotenv import load_dotenv

from .coach_context import generate_coach_context
from .garmin_sync.normalizers import (
    normalize_activity,
    normalize_activity_detail,
    normalize_body_battery,
    normalize_daily,
    normalize_hrv,
    normalize_sleep,
    normalize_stress,
)
from .gcs_upload import upload_directory_to_gcs
from .garmin_sync.write_json import write_json
from .session_manager import DEFAULT_SESSION_FILE, login_or_restore, save_session


def run_sync(
    *,
    days: int,
    output: Path,
    upload_bucket: str | None = None,
    upload_gcs: bool = False,
    gcs_prefix: str = "latest",
    dry_run_upload: bool = False,
    force_login: bool = False,
    session_file: Path = DEFAULT_SESSION_FILE,
) -> None:
    started_at = datetime.now(timezone.utc)
    days_to_fetch = _date_range(days)
    try:
        client = login_or_restore(session_file=session_file, force_login=force_login)

        daily: list[dict[str, Any]] = []
        sleep: list[dict[str, Any]] = []
        hrv: list[dict[str, Any]] = []
        stress: list[dict[str, Any]] = []
        body_battery: list[dict[str, Any]] = []

        for day in days_to_fetch:
            day_text = day.isoformat()
            daily_raw = _safe_dict(client.get_stats, day_text)
            readiness_raw = _safe_dict(getattr(client, "get_training_readiness", None), day_text)
            daily.append(normalize_daily(daily_raw | {"trainingReadiness": readiness_raw}, day))
            sleep.append(normalize_sleep(_safe_dict(client.get_sleep_data, day_text), day))
            hrv.append(normalize_hrv(_safe_dict(client.get_hrv_data, day_text), day))
            stress.append(normalize_stress(_safe_dict(client.get_stress_data, day_text), day))
            body_battery.append(normalize_body_battery(_safe_list(client.get_body_battery, day_text, day_text), day))

        activities_raw = _safe_list(client.get_activities, 0, max(100, days * 4))
        activities = [normalize_activity(item) for item in activities_raw if isinstance(item, dict)]
        activities = [item for item in activities if item.get("id") and item.get("date", "") >= days_to_fetch[0].isoformat()]
        activities.sort(key=lambda item: str(item.get("date", "")), reverse=True)

        _write_outputs(output, daily, sleep, hrv, stress, body_battery, activities, client, days_to_fetch, started_at)
        save_session(client, session_file)

        if upload_gcs or dry_run_upload:
            bucket = upload_bucket or os.environ.get("GCS_BUCKET")
            try:
                upload_directory_to_gcs(output, bucket or "", gcs_prefix, dry_run=dry_run_upload)
            except Exception:
                write_json(
                    output / "latest_sync_status.json",
                    _sync_status(
                        status="failed",
                        started_at=started_at,
                        completed_at=datetime.now(timezone.utc),
                        activities=activities,
                    ),
                )
                raise
    except Exception:
        write_json(
            output / "latest_sync_status.json",
            _sync_status(
                status="failed",
                started_at=started_at,
                completed_at=datetime.now(timezone.utc),
                activities=[],
            ),
        )
        raise


def _write_outputs(
    output: Path,
    daily: list[dict[str, Any]],
    sleep: list[dict[str, Any]],
    hrv: list[dict[str, Any]],
    stress: list[dict[str, Any]],
    body_battery: list[dict[str, Any]],
    activities: list[dict[str, Any]],
    client: Any,
    days_to_fetch: list[date],
    started_at: datetime,
) -> None:
    write_json(output / "daily.json", daily)
    write_json(output / "sleep.json", sleep)
    write_json(output / "hrv.json", hrv)
    write_json(output / "stress.json", stress)
    write_json(output / "body_battery.json", body_battery)
    write_json(output / "activities.json", activities)

    details_dir = output / "activity_details"
    _clear_json_files(details_dir)
    for activity in activities[:30]:
        activity_id = str(activity["id"])
        detail_raw = _safe_dict(getattr(client, "get_activity", None), activity_id)
        if not detail_raw:
            detail_raw = _safe_dict(getattr(client, "get_activity_details", None), activity_id)
        write_json(details_dir / f"{activity_id}.json", normalize_activity_detail(detail_raw or activity, fallback=activity))

    write_json(
        output / "coach_context_14d.json",
        generate_coach_context(
            daily=daily,
            sleep=sleep,
            hrv=hrv,
            stress=stress,
            body_battery=body_battery,
            activities=activities,
            days=min(14, len(days_to_fetch)),
        ),
    )
    write_json(
        output / "latest_sync_status.json",
        _sync_status(
            status="success",
            started_at=started_at,
            completed_at=datetime.now(timezone.utc),
            activities=activities,
        ),
    )
    write_json(output / "manifest.json", _manifest(days_to_fetch))


def _manifest(days_to_fetch: list[date]) -> dict[str, Any]:
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "garmin-connect",
        "date_range": {"start": days_to_fetch[0].isoformat(), "end": days_to_fetch[-1].isoformat()},
        "files": {
            "daily": "latest/daily.json",
            "sleep": "latest/sleep.json",
            "hrv": "latest/hrv.json",
            "stress": "latest/stress.json",
            "body_battery": "latest/body_battery.json",
            "activities": "latest/activities.json",
            "coach_context_14d": "latest/coach_context_14d.json",
            "latest_sync_status": "latest/latest_sync_status.json",
        },
    }


def _sync_status(
    *,
    status: str,
    started_at: datetime,
    completed_at: datetime,
    activities: list[dict[str, Any]],
) -> dict[str, Any]:
    latest_activity = activities[0] if activities else {}
    return {
        "status": status,
        "started_at": started_at.isoformat(),
        "completed_at": completed_at.isoformat(),
        "activities_synced": len(activities),
        "latest_activity_id": latest_activity.get("id"),
        "latest_activity_date": latest_activity.get("date"),
    }


def _clear_json_files(directory: Path) -> None:
    if not directory.exists():
        return
    for path in directory.glob("*.json"):
        path.unlink()


def _date_range(days: int) -> list[date]:
    if days < 1:
        raise ValueError("--days must be at least 1")
    today = date.today()
    return [today - timedelta(days=offset) for offset in reversed(range(days))]


def _safe_dict(func: Callable[..., Any] | None, *args: Any) -> dict[str, Any]:
    if func is None:
        return {}
    try:
        value = func(*args)
        return value if isinstance(value, dict) else {}
    except Exception:
        return {}


def _safe_list(func: Callable[..., Any] | None, *args: Any) -> list[Any]:
    if func is None:
        return []
    try:
        value = func(*args)
        return value if isinstance(value, list) else []
    except Exception:
        return []


def main() -> None:
    load_dotenv()
    parser = argparse.ArgumentParser(description="Sync Garmin Connect data to normalized MCP JSON.")
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--output", type=Path, default=Path("./output"))
    parser.add_argument("--upload-bucket", default=os.environ.get("GCS_BUCKET"))
    parser.add_argument("--upload-gcs", action="store_true")
    parser.add_argument("--gcs-prefix", default=os.environ.get("GCS_PREFIX", "latest"))
    parser.add_argument("--dry-run-upload", action="store_true")
    parser.add_argument("--session-file", type=Path, default=Path(os.environ.get("GARMIN_SESSION_FILE", str(DEFAULT_SESSION_FILE))))
    parser.add_argument("--force-login", action="store_true")
    args = parser.parse_args()
    run_sync(
        days=args.days,
        output=args.output,
        upload_bucket=args.upload_bucket,
        upload_gcs=args.upload_gcs,
        gcs_prefix=args.gcs_prefix,
        dry_run_upload=args.dry_run_upload,
        force_login=args.force_login,
        session_file=args.session_file,
    )


if __name__ == "__main__":
    main()
