from __future__ import annotations

"""Incremental sync entrypoint for the authenticated MCP sync_now tool."""

import argparse
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

from .garmin_sync.write_json import write_json
from .main import bool_arg, run_sync
from .session_manager import DEFAULT_SESSION_FILE

DATASETS = ["daily", "sleep", "hrv", "stress", "body_battery", "activities"]


def run_incremental_sync(
    *,
    output: Path,
    days: int = 30,
    full: bool = False,
    force: bool = False,
    force_login: bool = False,
    force_refresh: bool = False,
    lookback_days: int = 2,
    min_interval_minutes: int = 5,
    include_raw: bool = True,
    activity_details: bool = True,
    activity_streams: bool = True,
    session_file: Path = DEFAULT_SESSION_FILE,
    now: datetime | None = None,
) -> dict[str, Any]:
    current = now or datetime.now(timezone.utc)
    state_path = sync_state_path(output)
    checkpoint_path = sync_checkpoint_path(output)
    state = read_json(state_path) or {}
    checkpoint = read_json(checkpoint_path) or {}
    before = {dataset: dataset_state(state, dataset).get("last_synced_at") for dataset in DATASETS}
    if should_resume_checkpoint(checkpoint, full=full, force=force):
        run_type = str(checkpoint.get("run_type") or "delta")
        days_to_fetch = int(checkpoint.get("days_requested") or days)
    else:
        run_type = determine_run_type(state, current, full=full, force=force, min_interval_minutes=min_interval_minutes)
        days_to_fetch = compute_days_to_fetch(state, current.date(), requested_days=days, run_type=run_type, lookback_days=lookback_days)

    write_json(
        checkpoint_path,
        {
            "status": "running",
            "started_at": current.isoformat(),
            "updated_at": current.isoformat(),
            "run_type": run_type,
            "days_requested": days_to_fetch,
            "lookback_days": lookback_days,
            "dataset_watermarks_before": before,
        },
    )

    run_sync(
        days=days_to_fetch,
        output=output,
        include_raw=include_raw,
        activity_details=activity_details,
        activity_streams=activity_streams,
        force_login=force_login,
        force_refresh=force_refresh or full or force,
        session_file=session_file,
    )
    try:
        from .archive_maintenance import build_partition_manifest, verify_partition_manifest

        archive = output.resolve().parent / "archive"
        if archive.exists():
            build_partition_manifest(archive)
            manifest_verify = verify_partition_manifest(archive)
        else:
            manifest_verify = None
    except Exception:
        manifest_verify = None

    completed = datetime.now(timezone.utc)
    after = {dataset: completed.isoformat() for dataset in DATASETS}
    next_state = {
        "last_sync_completed_at": completed.isoformat(),
        "run_type": run_type,
        "datasets": {dataset: {"last_synced_at": after[dataset]} for dataset in DATASETS},
    }
    write_json(state_path, next_state)
    latest_status_path = output / "latest_sync_status.json"
    latest_status = read_json(latest_status_path) or {}
    delta_status = {
        "run_type": run_type,
        "sync_state_path": str(state_path),
        "lookback_days": lookback_days,
        "min_interval_minutes": min_interval_minutes,
        "days_requested": days_to_fetch,
        "dataset_watermarks": {
            dataset: {
                "watermark_before": before[dataset],
                "watermark_after": after[dataset],
                "records_fetched": record_count_for_dataset(latest_status, dataset),
                "records_upserted": record_count_for_dataset(latest_status, dataset),
            }
            for dataset in DATASETS
        },
        "partition_manifest_verify": manifest_verify,
    }
    write_json(latest_status_path, latest_status | delta_status)
    write_json(
        checkpoint_path,
        {
            "status": "success",
            "started_at": checkpoint.get("started_at") if should_resume_checkpoint(checkpoint, full=full, force=force) else current.isoformat(),
            "completed_at": completed.isoformat(),
            "updated_at": completed.isoformat(),
            "run_type": run_type,
            "days_requested": days_to_fetch,
            "lookback_days": lookback_days,
            "dataset_watermarks_before": before,
            "dataset_watermarks_after": after,
        },
    )
    return latest_status | delta_status


def sync_state_path(output: Path) -> Path:
    return output.resolve().parent / "archive" / "sync_state.json"


def sync_checkpoint_path(output: Path) -> Path:
    return output.resolve().parent / "archive" / "sync_checkpoint.json"


def should_resume_checkpoint(checkpoint: dict[str, Any], *, full: bool, force: bool) -> bool:
    if full or force:
        return False
    return checkpoint.get("status") in {"running", "failed"} and checkpoint.get("days_requested") is not None


def determine_run_type(state: dict[str, Any], now: datetime, *, full: bool, force: bool, min_interval_minutes: int) -> str:
    if full:
        return "full"
    completed_at = state.get("last_sync_completed_at")
    if completed_at and not force:
        try:
            completed = datetime.fromisoformat(str(completed_at))
            if completed.tzinfo is None:
                completed = completed.replace(tzinfo=timezone.utc)
            if now - completed < timedelta(minutes=min_interval_minutes):
                return "cooldown-light"
        except ValueError:
            pass
    return "delta" if completed_at else "full"


def compute_days_to_fetch(state: dict[str, Any], today: date, *, requested_days: int, run_type: str, lookback_days: int) -> int:
    if run_type == "cooldown-light":
        return 1
    if run_type == "full":
        return requested_days
    watermarks = [
        parse_watermark(dataset_state(state, dataset).get("last_synced_at"))
        for dataset in DATASETS
    ]
    known = [item for item in watermarks if item is not None]
    if not known:
        return requested_days
    start = min(known) - timedelta(days=max(0, lookback_days))
    return max(1, min(requested_days, (today - start).days + 1))


def dataset_state(state: dict[str, Any], dataset: str) -> dict[str, Any]:
    datasets = state.get("datasets")
    if isinstance(datasets, dict) and isinstance(datasets.get(dataset), dict):
        return datasets[dataset]
    return {}


def parse_watermark(value: Any) -> date | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value)).date()
    except ValueError:
        try:
            return date.fromisoformat(str(value)[:10])
        except ValueError:
            return None


def record_count_for_dataset(status: dict[str, Any], dataset: str) -> int:
    if dataset == "activities":
        return int(status.get("activities_synced") or 0)
    dates = status.get("latest_available_dates")
    return 1 if isinstance(dates, dict) and dates.get(dataset) else 0


def read_json(path: Path) -> dict[str, Any] | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else None
    except Exception:
        return None


def main() -> None:
    load_dotenv()
    parser = argparse.ArgumentParser(description="Incremental Garmin sync for MCP sync_now.")
    parser.add_argument("--output", type=Path, default=Path("/app/data/latest"))
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--full", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--lookback-days", type=int, default=2)
    parser.add_argument("--min-interval-minutes", type=int, default=5)
    parser.add_argument("--force-login", action="store_true")
    parser.add_argument("--force-refresh", action="store_true")
    parser.add_argument("--include-raw", type=bool_arg, default=True)
    parser.add_argument("--activity-details", type=bool_arg, default=True)
    parser.add_argument("--activity-streams", type=bool_arg, default=True)
    parser.add_argument("--session-file", type=Path, default=Path(DEFAULT_SESSION_FILE))
    args = parser.parse_args()
    run_incremental_sync(
        output=args.output,
        days=args.days,
        full=args.full,
        force=args.force,
        force_login=args.force_login,
        force_refresh=args.force_refresh,
        lookback_days=args.lookback_days,
        min_interval_minutes=args.min_interval_minutes,
        include_raw=args.include_raw,
        activity_details=args.activity_details,
        activity_streams=args.activity_streams,
        session_file=args.session_file,
    )


if __name__ == "__main__":
    main()
