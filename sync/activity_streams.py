from __future__ import annotations

"""Tolerant Garmin activity stream extraction.

Garmin payload shapes vary by activity type and library version. This module
tries multiple endpoints, searches for stream-like sample arrays, and preserves
availability metadata instead of failing when fields are missing.
"""

from datetime import datetime, timezone
from typing import Any, Callable


STREAM_FIELDS = [
    "timestamp",
    "offset_seconds",
    "heart_rate",
    "cadence",
    "speed_mps",
    "pace",
    "power_watts",
    "altitude_m",
    "distance_m",
    "latitude",
    "longitude",
    "temperature",
]


def fetch_activity_payloads(client: Any, activity_id: str) -> dict[str, Any]:
    # Method names are optional across garminconnect versions, so each call is best-effort.
    payloads: dict[str, Any] = {}
    calls: dict[str, tuple[str, tuple[Any, ...]]] = {
        "activity": ("get_activity", (activity_id,)),
        "activity_details": ("get_activity_details", (activity_id,)),
        "splits": ("get_activity_splits", (activity_id,)),
        "typed_splits": ("get_activity_typed_splits", (activity_id,)),
        "split_summaries": ("get_activity_split_summaries", (activity_id,)),
        "hr_timezones": ("get_activity_hr_in_timezones", (activity_id,)),
        "gear": ("get_activity_gear", (activity_id,)),
        "weather": ("get_activity_weather", (activity_id,)),
    }
    for key, (method_name, args) in calls.items():
        method = getattr(client, method_name, None)
        if method is None:
            payloads[key] = None
            continue
        payloads[key] = safe_call(method, *args)
    return payloads


def normalize_activity_stream(activity_id: str, payloads: dict[str, Any]) -> dict[str, Any]:
    # Prefer detailed metrics when available, but fall back to the activity payload.
    detail = payloads.get("activity_details") or payloads.get("activity") or {}
    samples = extract_samples(detail)
    laps = first_present(payloads.get("splits"), payloads.get("typed_splits"), payloads.get("split_summaries"), [])
    fields = available_fields(samples)
    missing = [field for field in STREAM_FIELDS if field not in fields and field != "timestamp"]
    return {
        "activity_id": str(activity_id),
        "source": "garmin-connect",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "sync_version": "v1",
        "schema_version": "activity_streams_v1",
        "sample_count": len(samples),
        "fields": fields,
        "samples": samples,
        "laps": laps if isinstance(laps, list) else [],
        "splits": payloads.get("split_summaries") if isinstance(payloads.get("split_summaries"), list) else [],
        "metadata": {
            "has_power": "power_watts" in fields,
            "has_gps": "latitude" in fields and "longitude" in fields,
            "has_cadence": "cadence" in fields,
            "has_heart_rate": "heart_rate" in fields,
        },
        "availability": {
            "available_fields": fields,
            "missing_fields": missing,
            "notes": missing_notes(missing, len(samples)),
        },
    }


def extract_samples(payload: Any) -> list[dict[str, Any]]:
    candidates = find_sample_lists(payload)
    if not candidates:
        return []
    best = max(candidates, key=len)
    samples = [normalize_sample(item, index) for index, item in enumerate(best)]
    return [sample for sample in samples if any(value is not None for value in sample.values())]


def find_sample_lists(value: Any) -> list[list[Any]]:
    found: list[list[Any]] = []
    if isinstance(value, list):
        if len(value) >= 2 and all(is_sample_like(item) for item in value[: min(len(value), 10)]):
            found.append(value)
        for item in value:
            found.extend(find_sample_lists(item))
    elif isinstance(value, dict):
        for key, item in value.items():
            if isinstance(item, list) and streamish_key(key):
                found.extend(find_sample_lists(item))
            elif isinstance(item, (dict, list)):
                found.extend(find_sample_lists(item))
    return found


def is_sample_like(value: Any) -> bool:
    if isinstance(value, dict):
        keys = {key.lower() for key in value.keys()}
        return bool(keys & {"heartrate", "heart_rate", "hr", "speed", "distance", "latitude", "longitude", "elevation", "altitude", "power", "cadence", "starttimegmt", "timerduration"})
    if isinstance(value, list):
        return len(value) >= 2 and any(isinstance(item, (int, float)) for item in value)
    return False


def streamish_key(key: str) -> bool:
    lowered = key.lower()
    return any(token in lowered for token in ["metric", "chart", "sample", "track", "polyline", "point", "stream"])


def normalize_sample(value: Any, index: int) -> dict[str, Any]:
    if isinstance(value, dict):
        latitude = pick_number(value, "latitude", "lat", "positionLat")
        longitude = pick_number(value, "longitude", "lon", "lng", "positionLong")
        sample = {
            "timestamp": pick(value, "timestamp", "startTimeGMT", "startTimeLocal", "clockDuration"),
            "offset_seconds": pick_number(value, "offset_seconds", "offsetSeconds", "timerDuration", "duration") or index,
            "heart_rate": pick_number(value, "heart_rate", "heartRate", "heartRateValue", "hr", "bpm"),
            "cadence": pick_number(value, "cadence", "runCadence", "bikeCadence"),
            "speed_mps": pick_number(value, "speed_mps", "speed", "speedMetersPerSecond"),
            "pace": pick_number(value, "pace"),
            "power_watts": pick_number(value, "power_watts", "power", "watts"),
            "altitude_m": pick_number(value, "altitude_m", "altitude", "elevation", "elevationMeters"),
            "distance_m": pick_number(value, "distance_m", "distance", "totalDistance"),
            "latitude": latitude,
            "longitude": longitude,
            "temperature": pick_number(value, "temperature", "airTemperature"),
        }
        return sample
    if isinstance(value, list):
        return {
            "offset_seconds": index,
            "heart_rate": number_at(value, 1),
            "cadence": number_at(value, 2),
            "speed_mps": number_at(value, 3),
            "power_watts": number_at(value, 4),
            "altitude_m": number_at(value, 5),
            "distance_m": number_at(value, 6),
        }
    return {"offset_seconds": index}


def available_fields(samples: list[dict[str, Any]]) -> list[str]:
    fields = []
    for field in STREAM_FIELDS:
        if any(sample.get(field) is not None for sample in samples):
            fields.append(field)
    return fields


def missing_notes(missing: list[str], sample_count: int) -> list[str]:
    if sample_count == 0:
        return ["No Garmin time-series samples were found in available activity payloads."]
    return [f"{field} is missing because Garmin did not provide {field} samples for this activity" for field in missing]


def pick(source: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in source and source[key] is not None:
            return source[key]
    return None


def pick_number(source: dict[str, Any], *keys: str) -> int | float | None:
    value = pick(source, *keys)
    return value if isinstance(value, (int, float)) else None


def number_at(values: list[Any], index: int) -> int | float | None:
    if len(values) <= index:
        return None
    return values[index] if isinstance(values[index], (int, float)) else None


def first_present(*values: Any) -> Any:
    for value in values:
        if value:
            return value
    return None


def safe_call(func: Callable[..., Any], *args: Any) -> Any:
    try:
        return func(*args)
    except Exception:
        return None
