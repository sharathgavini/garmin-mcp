from __future__ import annotations

"""Domain guardrails for normalized Garmin JSON writes."""

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .garmin_sync.write_json import write_json


def validate_normalized_record(dataset: str, row: dict[str, Any]) -> list[str]:
    reasons: list[str] = []
    for field in ("distance_meters", "distance_m", "duration_seconds", "elapsed_duration_seconds", "moving_duration_seconds"):
        value = row.get(field)
        if is_number(value) and value < 0:
            reasons.append(f"{field} must be non-negative")
    for field in ("avg_hr", "max_hr", "resting_hr", "avg_heart_rate", "heart_rate"):
        value = row.get(field)
        if is_number(value) and not 0 <= value <= 240:
            reasons.append(f"{field} outside 0-240 bpm")
    for field in ("avg_cadence", "max_cadence", "cadence"):
        value = row.get(field)
        if is_number(value) and value < 0:
            reasons.append(f"{field} must be non-negative")
    for field in ("avg_speed_mps", "max_speed_mps", "speed_mps"):
        value = row.get(field)
        if is_number(value) and not 0 <= value <= 50:
            reasons.append(f"{field} outside 0-50 m/s")
    for field in ("stress", "avg_stress", "max_stress", "avg_sleep_stress"):
        value = row.get(field)
        if is_number(value) and not 0 <= value <= 100:
            reasons.append(f"{field} outside Garmin 0-100 range")
    for field in ("morning", "low", "high", "evening"):
        value = row.get(field)
        if dataset == "body_battery" and is_number(value) and not 0 <= value <= 100:
            reasons.append(f"{field} outside Garmin 0-100 range")
    for field in ("total_sleep_seconds", "deep_sleep_seconds", "light_sleep_seconds", "rem_sleep_seconds", "awake_sleep_seconds", "nap_time_seconds"):
        value = row.get(field)
        if is_number(value) and not 0 <= value <= 86400:
            reasons.append(f"{field} outside 0-86400 seconds")
    for field in ("avg_overnight_hrv", "last_night_avg", "last_night_5min_high", "weekly_avg", "min_hrv", "max_hrv", "hrv_value"):
        value = row.get(field)
        if is_number(value) and not 0 <= value <= 300:
            reasons.append(f"{field} outside 0-300 ms")
    return reasons


def filter_valid_rows(dataset: str, rows: list[dict[str, Any]], rejection_path: Path | None = None) -> list[dict[str, Any]]:
    valid: list[dict[str, Any]] = []
    rejections: list[dict[str, Any]] = []
    for row in rows:
        reasons = validate_normalized_record(dataset, row)
        if reasons:
            rejections.append(rejection_entry(dataset, row, reasons))
        else:
            valid.append(row)
    if rejections and rejection_path:
        append_rejections(rejection_path, rejections)
    return valid


def filter_activity_stream_payload(payload: dict[str, Any], rejection_path: Path | None = None) -> dict[str, Any]:
    samples = payload.get("samples")
    if not isinstance(samples, list):
        return payload
    valid: list[dict[str, Any]] = []
    rejections: list[dict[str, Any]] = []
    for sample in samples:
        if not isinstance(sample, dict):
            continue
        reasons = validate_normalized_record("activity_streams", sample)
        if reasons:
            rejections.append(rejection_entry("activity_streams", sample | {"activity_id": payload.get("activity_id")}, reasons))
        else:
            valid.append(sample)
    if rejections and rejection_path:
        append_rejections(rejection_path, rejections)
    cleaned = dict(payload)
    cleaned["samples"] = valid
    cleaned["sample_count"] = len(valid)
    return cleaned


def append_rejections(path: Path, rejections: list[dict[str, Any]]) -> None:
    existing = read_json_list(path)
    write_json(path, existing + rejections)


def rejection_entry(dataset: str, row: dict[str, Any], reasons: list[str]) -> dict[str, Any]:
    return {
        "rejected_at": datetime.now(timezone.utc).isoformat(),
        "dataset": dataset,
        "id": row.get("id") or row.get("activity_id"),
        "date": row.get("date"),
        "reasons": reasons,
    }


def read_json_list(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, list) else []
    except Exception:
        return []


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)
