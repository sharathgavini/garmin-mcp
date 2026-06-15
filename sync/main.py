from __future__ import annotations

"""Latest Garmin sync command.

This module writes /latest-style JSON: compact normalized files, raw payloads,
activity details, activity streams, coach context, manifest, and sync status.
"""

import argparse
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

from dotenv import load_dotenv

from .activity_streams import endpoint_payload, fetch_activity_payloads, normalize_activity_stream
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
from .retry import retry_call


def run_sync(
    *,
    days: int,
    output: Path,
    upload_bucket: str | None = None,
    upload_gcs: bool = False,
    gcs_prefix: str = "latest",
    dry_run_upload: bool = False,
    include_raw: bool = True,
    activity_details: bool = True,
    activity_streams: bool = True,
    force_login: bool = False,
    force_refresh: bool = False,
    session_file: Path = DEFAULT_SESSION_FILE,
) -> None:
    # The latest sync is intentionally all-or-status-file: callers inspect
    # latest_sync_status.json to decide whether the data is complete enough.
    started_at = datetime.now(timezone.utc)
    days_to_fetch = _date_range(days)
    try:
        # Garmin authentication is session-first so scheduled runs avoid fresh logins.
        client = login_or_restore(session_file=session_file, force_login=force_login)

        # Keep normalized records and raw payloads side by side; raw protects future reprocessing.
        daily: list[dict[str, Any]] = []
        sleep: list[dict[str, Any]] = []
        hrv: list[dict[str, Any]] = []
        stress: list[dict[str, Any]] = []
        body_battery: list[dict[str, Any]] = []
        raw_payloads: dict[str, list[Any]] = {
            "daily": [],
            "sleep": [],
            "hrv": [],
            "stress": [],
            "body_battery": [],
            "activities": [],
        }

        # Garmin health endpoints are day-based, so latest sync loops over each requested day.
        for day in days_to_fetch:
            # Fetch every recovery dataset for each day so sync_now can refresh
            # sleep/HRV/body battery without relying on previously written files.
            day_text = day.isoformat()
            daily_raw = _safe_dict(client.get_stats, day_text)
            readiness_raw = _safe_dict(getattr(client, "get_training_readiness", None), day_text)
            sleep_raw = _safe_dict(client.get_sleep_data, day_text)
            hrv_raw = _safe_dict(client.get_hrv_data, day_text)
            stress_raw = _safe_dict(client.get_stress_data, day_text)
            body_battery_raw = _safe_list(client.get_body_battery, day_text, day_text)
            raw_payloads["daily"].append({"date": day_text, "payload": daily_raw, "training_readiness": readiness_raw})
            raw_payloads["sleep"].append({"date": day_text, "payload": sleep_raw})
            raw_payloads["hrv"].append({"date": day_text, "payload": hrv_raw})
            raw_payloads["stress"].append({"date": day_text, "payload": stress_raw})
            raw_payloads["body_battery"].append({"date": day_text, "payload": body_battery_raw})
            daily.append(normalize_daily(daily_raw | {"trainingReadiness": readiness_raw}, day))
            sleep.append(normalize_sleep(sleep_raw, day, raw_payload_path="raw/sleep/sleep.json"))
            hrv.append(normalize_hrv(hrv_raw, day, raw_payload_path="raw/hrv/hrv.json"))
            stress.append(normalize_stress(stress_raw, day))
            body_battery.append(normalize_body_battery(body_battery_raw, day))

        # Activity lists are fetched as a recent page and filtered back to the requested date window.
        activities_raw = _safe_list(client.get_activities, 0, max(100, days * 4))
        raw_payloads["activities"] = activities_raw
        activities = [normalize_activity(item) for item in activities_raw if isinstance(item, dict)]
        activities = [item for item in activities if item.get("id") and item.get("date", "") >= days_to_fetch[0].isoformat()]
        activities.sort(key=lambda item: str(item.get("date", "")), reverse=True)

        _write_outputs(
            output,
            daily,
            sleep,
            hrv,
            stress,
            body_battery,
            activities,
            client,
            days_to_fetch,
            started_at,
            include_raw=include_raw,
            activity_details=activity_details,
            activity_streams=activity_streams,
            raw_payloads=raw_payloads,
            force_refresh=force_refresh,
        )
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
                        daily=daily,
                        sleep=sleep,
                        hrv=hrv,
                        stress=stress,
                        body_battery=body_battery,
                        output=output,
                        activity_streams_enabled=activity_streams,
                        force_refresh=force_refresh,
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
                daily=[],
                sleep=[],
                hrv=[],
                stress=[],
                body_battery=[],
                output=output,
                activity_streams_enabled=activity_streams,
                force_refresh=force_refresh,
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
    include_raw: bool,
    activity_details: bool,
    activity_streams: bool,
    raw_payloads: dict[str, list[Any]] | None = None,
    force_refresh: bool = False,
) -> None:
    # Top-level files are what latest MCP tools read for fast recent summaries.
    write_json(output / "daily.json", daily)
    write_json(output / "sleep.json", sleep)
    write_json(output / "hrv.json", hrv)
    write_json(output / "stress.json", stress)
    write_json(output / "body_battery.json", body_battery)
    write_json(output / "activities.json", activities)

    details_dir = output / "activity_details"
    streams_dir = output / "activity_streams"
    _clear_json_files(details_dir)
    _clear_json_files(streams_dir)
    # Activity-specific files are separate so tools can fetch details/streams only when needed.
    for activity in activities[:30]:
        activity_id = str(activity["id"])
        payloads = fetch_activity_payloads(client, activity_id)
        detail_raw = endpoint_payload(payloads.get("activity")) if isinstance(endpoint_payload(payloads.get("activity")), dict) else {}
        if not detail_raw and isinstance(endpoint_payload(payloads.get("activity_details")), dict):
            detail_raw = endpoint_payload(payloads.get("activity_details"))
        if activity_details:
            write_json(details_dir / f"{activity_id}.json", normalize_activity_detail(detail_raw or activity, fallback=activity))
        if activity_streams:
            write_json(streams_dir / f"{activity_id}.json", normalize_activity_stream(activity_id, payloads))
        if include_raw:
            write_json(output / "raw" / "activity_details" / f"{activity_id}.json", payloads)
            write_json(output / "raw" / "activity_streams" / f"{activity_id}.json", payloads)

    if include_raw:
        # Raw latest payloads stay local/self-hosted unless an upload path explicitly allows them.
        raw_payloads = raw_payloads or {}
        write_raw_latest(output, "daily", raw_payloads.get("daily", []))
        write_raw_latest(output, "sleep", raw_payloads.get("sleep", []))
        write_raw_latest(output, "hrv", raw_payloads.get("hrv", []))
        write_raw_latest(output, "stress", raw_payloads.get("stress", []))
        write_raw_latest(output, "body_battery", raw_payloads.get("body_battery", []))
        write_raw_latest(output, "activities", raw_payloads.get("activities", []))

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
            daily=daily,
            sleep=sleep,
            hrv=hrv,
            stress=stress,
            body_battery=body_battery,
            output=output,
            activity_streams_enabled=activity_streams,
            force_refresh=force_refresh,
        ),
    )
    write_json(output / "manifest.json", _manifest(days_to_fetch))


def _manifest(days_to_fetch: list[date]) -> dict[str, Any]:
    # Manifest paths are written in "latest/" form for compatibility with GCS mode.
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
    daily: list[dict[str, Any]] | None = None,
    sleep: list[dict[str, Any]] | None = None,
    hrv: list[dict[str, Any]] | None = None,
    stress: list[dict[str, Any]] | None = None,
    body_battery: list[dict[str, Any]] | None = None,
    output: Path | None = None,
    activity_streams_enabled: bool = True,
    force_refresh: bool = False,
) -> dict[str, Any]:
    latest_activity = activities[0] if activities else {}
    completeness = sync_completeness(
        daily=daily or [],
        sleep=sleep or [],
        hrv=hrv or [],
        stress=stress or [],
        body_battery=body_battery or [],
        activities=activities,
        output=output,
        activity_streams_enabled=activity_streams_enabled,
    )
    return {
        "status": status,
        "sync_status": status,
        "started_at": started_at.isoformat(),
        "completed_at": completed_at.isoformat(),
        "activities_synced": len(activities),
        "latest_activity_id": latest_activity.get("id"),
        "latest_activity_date": latest_activity.get("date"),
        "force_refresh": force_refresh,
        **completeness,
    }


def sync_completeness(
    *,
    daily: list[dict[str, Any]],
    sleep: list[dict[str, Any]],
    hrv: list[dict[str, Any]],
    stress: list[dict[str, Any]],
    body_battery: list[dict[str, Any]],
    activities: list[dict[str, Any]],
    output: Path | None,
    activity_streams_enabled: bool,
) -> dict[str, Any]:
    # Sync completeness is a contract for MCP clients: "success" alone is not
    # enough for recovery advice unless the recovery datasets are current.
    datasets = {
        "daily": daily,
        "sleep": sleep,
        "hrv": hrv,
        "stress": stress,
        "body_battery": body_battery,
        "activities": activities,
    }
    latest_dates = {name: latest_date(rows) for name, rows in datasets.items()}
    sync_flags = {
        "daily": bool(daily and latest_dates["daily"]),
        "sleep": bool(sleep and latest_dates["sleep"]),
        "hrv": bool(hrv and latest_dates["hrv"]),
        "stress": bool(stress and latest_dates["stress"]),
        "body_battery": bool(body_battery and latest_dates["body_battery"]),
        "activities": bool(activities),
    }
    warnings = stale_dataset_warnings(latest_dates)
    stream_coverage = activity_stream_coverage(activities, output) if output else {"activities_checked": len(activities), "activities_with_streams": 0, "completeness_percent": 0}
    if activity_streams_enabled and activities and stream_coverage["activities_with_streams"] == 0:
        warnings.append("activity streams missing")
    score_items = list(sync_flags.values()) + [stream_coverage["activities_with_streams"] > 0 if activities else True]
    return {
        "sync_completeness": sync_flags,
        "latest_available_dates": latest_dates,
        "stale_dataset_warnings": warnings,
        "sync_health_score": round(sum(1 for item in score_items if item) / len(score_items) * 100),
        "activity_stream_coverage": stream_coverage,
    }


def latest_date(rows: list[dict[str, Any]]) -> str | None:
    # Rows are normalized with ISO date strings, so lexical sort is chronological.
    dates = sorted(str(row.get("date", ""))[:10] for row in rows if row.get("date"))
    return dates[-1] if dates else None


def stale_dataset_warnings(latest_dates: dict[str, str | None]) -> list[str]:
    # Sleep and HRV can lag Garmin daily data; warn when the lag is larger than expected.
    warnings: list[str] = []
    daily_date = latest_dates.get("daily")
    if not daily_date:
        return warnings
    for dataset in ("sleep", "hrv"):
        dataset_date = latest_dates.get(dataset)
        if dataset_date and date_lag_days(daily_date, dataset_date) > 1:
            warnings.append(f"{dataset} dataset stale")
        elif not dataset_date:
            warnings.append(f"{dataset} dataset missing")
    return warnings


def date_lag_days(newer: str, older: str) -> int:
    try:
        return (date.fromisoformat(newer) - date.fromisoformat(older)).days
    except ValueError:
        return 0


def activity_stream_coverage(activities: list[dict[str, Any]], output: Path | None) -> dict[str, Any]:
    # Latest sync stores streams for the same top activity window as details.
    if output is None:
        return {"activities_checked": len(activities), "activities_with_streams": 0, "completeness_percent": 0}
    checked = 0
    found = 0
    for activity in activities[:30]:
        activity_id = activity.get("id")
        if not activity_id:
            continue
        checked += 1
        if (output / "activity_streams" / f"{activity_id}.json").exists():
            found += 1
    return {
        "activities_checked": checked,
        "activities_with_streams": found,
        "completeness_percent": round((found / checked) * 100, 2) if checked else 100,
    }


def _clear_json_files(directory: Path) -> None:
    # Remove stale per-activity files so deleted/old activities do not appear current.
    if not directory.exists():
        return
    for path in directory.glob("*.json"):
        path.unlink()


def _date_range(days: int) -> list[date]:
    # Latest sync always includes today and walks backward by the requested window.
    if days < 1:
        raise ValueError("--days must be at least 1")
    today = date.today()
    return [today - timedelta(days=offset) for offset in reversed(range(days))]


def _safe_dict(func: Callable[..., Any] | None, *args: Any) -> dict[str, Any]:
    # A single Garmin endpoint failure should not prevent other datasets from syncing.
    if func is None:
        return {}
    try:
        value = retry_call(func, *args)
        return value if isinstance(value, dict) else {}
    except Exception:
        return {}


def _safe_list(func: Callable[..., Any] | None, *args: Any) -> list[Any]:
    # List endpoint failure is represented as an empty list and surfaced via completeness.
    if func is None:
        return []
    try:
        value = retry_call(func, *args)
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
    parser.add_argument("--include-raw", type=bool_arg, default=True)
    parser.add_argument("--activity-details", type=bool_arg, default=True)
    parser.add_argument("--activity-streams", type=bool_arg, default=True)
    parser.add_argument("--session-file", type=Path, default=Path(os.environ.get("GARMIN_SESSION_FILE", str(DEFAULT_SESSION_FILE))))
    parser.add_argument("--force-login", action="store_true")
    parser.add_argument("--force-refresh", action="store_true")
    args = parser.parse_args()
    run_sync(
        days=args.days,
        output=args.output,
        upload_bucket=args.upload_bucket,
        upload_gcs=args.upload_gcs,
        gcs_prefix=args.gcs_prefix,
        dry_run_upload=args.dry_run_upload,
        include_raw=args.include_raw,
        activity_details=args.activity_details,
        activity_streams=args.activity_streams,
        force_login=args.force_login,
        force_refresh=args.force_refresh,
        session_file=args.session_file,
    )


def write_raw_latest(output: Path, dataset: str, payload: Any) -> None:
    # Raw latest payloads are grouped by dataset so renormalize can replay them later.
    write_json(output / "raw" / dataset / f"{dataset}.json", payload)


def bool_arg(value: str | bool) -> bool:
    # Accept Docker/env-style booleans while still rejecting typos.
    if isinstance(value, bool):
        return value
    lowered = value.lower()
    if lowered in {"1", "true", "yes", "on"}:
        return True
    if lowered in {"0", "false", "no", "off"}:
        return False
    raise argparse.ArgumentTypeError("Use true or false.")


if __name__ == "__main__":
    main()
