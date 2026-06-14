from __future__ import annotations

import argparse
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

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
from .garmin_sync.upload_gcs import upload_directory
from .garmin_sync.write_json import write_json
from .session_manager import DEFAULT_SESSION_FILE, login_or_restore, save_session


def run_sync(
    *,
    days: int,
    output: Path,
    upload_bucket: str | None = None,
    force_login: bool = False,
    session_file: Path = DEFAULT_SESSION_FILE,
) -> None:
    days_to_fetch = _date_range(days)
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

    _write_outputs(output, daily, sleep, hrv, stress, body_battery, activities, client, days_to_fetch)
    save_session(client, session_file)

    if upload_bucket:
        upload_directory(upload_bucket, output)


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
) -> None:
    write_json(output / "daily.json", daily)
    write_json(output / "sleep.json", sleep)
    write_json(output / "hrv.json", hrv)
    write_json(output / "stress.json", stress)
    write_json(output / "body_battery.json", body_battery)
    write_json(output / "activities.json", activities)

    details_dir = output / "activity_details"
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
        },
    }


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
    parser = argparse.ArgumentParser(description="Sync Garmin Connect data to normalized MCP JSON.")
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--output", type=Path, default=Path("./output"))
    parser.add_argument("--upload-bucket", default=os.environ.get("GCS_BUCKET"))
    parser.add_argument("--session-file", type=Path, default=DEFAULT_SESSION_FILE)
    parser.add_argument("--force-login", action="store_true")
    args = parser.parse_args()
    run_sync(
        days=args.days,
        output=args.output,
        upload_bucket=args.upload_bucket,
        force_login=args.force_login,
        session_file=args.session_file,
    )


if __name__ == "__main__":
    main()
