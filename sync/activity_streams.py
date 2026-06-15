from __future__ import annotations

"""Tolerant Garmin activity stream extraction.

Garmin payload shapes vary by activity type and library version. This module
tries multiple endpoints, searches for stream-like sample arrays, supports
column-based Garmin graph series, and records what payloads were checked.
"""

from collections import defaultdict
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

# Tokens used by the inspector to discover activity-related methods on whatever
# garminconnect client version is installed locally.
METHOD_TOKENS = [
    "activity",
    "activities",
    "detail",
    "details",
    "stream",
    "streams",
    "graph",
    "graphs",
    "split",
    "splits",
    "lap",
    "laps",
    "hr",
    "heart",
    "cadence",
    "power",
    "sensor",
    "weather",
    "polyline",
    "chart",
    "route",
]

# Known Garmin client method names that may hold useful detail or stream data.
# Missing methods are recorded in the debug payload instead of failing sync.
LIKELY_ACTIVITY_METHODS: dict[str, tuple[str, tuple[Any, ...]]] = {
    "activity": ("get_activity", ("{activity_id}",)),
    "activity_details": ("get_activity_details", ("{activity_id}",)),
    "activity_detail": ("get_activity_detail", ("{activity_id}",)),
    "activity_splits": ("get_activity_splits", ("{activity_id}",)),
    "activity_split": ("get_activity_split", ("{activity_id}",)),
    "activity_laps": ("get_activity_laps", ("{activity_id}",)),
    "activity_typed_splits": ("get_activity_typed_splits", ("{activity_id}",)),
    "activity_split_summaries": ("get_activity_split_summaries", ("{activity_id}",)),
    "activity_graphs": ("get_activity_graphs", ("{activity_id}",)),
    "activity_graph": ("get_activity_graph", ("{activity_id}",)),
    "activity_streams": ("get_activity_streams", ("{activity_id}",)),
    "activity_stream": ("get_activity_stream", ("{activity_id}",)),
    "activity_hr": ("get_activity_hr", ("{activity_id}",)),
    "activity_heart_rates": ("get_activity_heart_rates", ("{activity_id}",)),
    "activity_hr_timezones": ("get_activity_hr_in_timezones", ("{activity_id}",)),
    "activity_weather": ("get_activity_weather", ("{activity_id}",)),
    "activity_polyline": ("get_activity_polyline", ("{activity_id}",)),
    "activity_gpx": ("get_activity_gpx", ("{activity_id}",)),
    "activity_fit": ("get_activity_fit", ("{activity_id}",)),
    "activity_gear": ("get_activity_gear", ("{activity_id}",)),
}

# Normalized stream field names mapped to the many names Garmin payloads use.
FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    "timestamp": ("timestamp", "time", "startTimeGMT", "startTimeLocal", "clockDuration"),
    "offset_seconds": ("offset_seconds", "offsetSeconds", "timerDuration", "duration", "timeOffset", "offset"),
    "heart_rate": ("heart_rate", "heartRate", "heartRateValue", "bpm", "hr"),
    "cadence": ("cadence", "bikeCadence", "runCadence", "strokesCadence"),
    "speed_mps": ("speed_mps", "speed", "speedMetersPerSecond", "velocity"),
    "pace": ("pace",),
    "power_watts": ("power_watts", "power", "watts", "powerWatts"),
    "altitude_m": ("altitude_m", "elevation", "altitude", "altitudeMeters", "elevationMeters"),
    "distance_m": ("distance_m", "distance", "distanceMeters", "totalDistance"),
    "latitude": ("latitude", "lat", "positionLat"),
    "longitude": ("longitude", "lon", "lng", "positionLong"),
    "temperature": ("temperature", "ambientTemperature", "airTemperature"),
}

# Some Garmin graph payloads are columnar arrays instead of row objects.
COLUMN_SERIES_MAP: dict[str, str] = {
    "heartRateValues": "heart_rate",
    "heart_rate_values": "heart_rate",
    "hrValues": "heart_rate",
    "speedValues": "speed_mps",
    "speed_values": "speed_mps",
    "cadenceValues": "cadence",
    "runCadenceValues": "cadence",
    "bikeCadenceValues": "cadence",
    "powerValues": "power_watts",
    "power_watts_values": "power_watts",
    "elevationValues": "altitude_m",
    "altitudeValues": "altitude_m",
    "distanceValues": "distance_m",
    "temperatureValues": "temperature",
    "latitudeValues": "latitude",
    "longitudeValues": "longitude",
}


def client_method_inventory(client: Any) -> list[dict[str, Any]]:
    # Keep an inventory for diagnostics so new Garmin API shapes can be found.
    methods = []
    for name in sorted(dir(client)):
        lowered = name.lower()
        if lowered.startswith("_") or not any(token in lowered for token in METHOD_TOKENS):
            continue
        attr = getattr(client, name, None)
        if callable(attr):
            methods.append({"name": name, "tokens": [token for token in METHOD_TOKENS if token in lowered]})
    return methods


def fetch_activity_payloads(client: Any, activity_id: str) -> dict[str, Any]:
    # Method names are optional across garminconnect versions, so each call is best-effort.
    payloads: dict[str, Any] = {}
    for key, (method_name, args_template) in LIKELY_ACTIVITY_METHODS.items():
        method = getattr(client, method_name, None)
        if method is None:
            payloads[key] = {"available": False, "method": method_name, "payload": None, "error": "method_not_found"}
            continue
        args = tuple(activity_id if item == "{activity_id}" else item for item in args_template)
        payloads[key] = safe_endpoint_call(method, *args, method_name=method_name)
    return payloads


def normalize_activity_stream(activity_id: str, payloads: dict[str, Any]) -> dict[str, Any]:
    # Try every payload shape and merge the discovered samples into one timeline.
    samples, checked = extract_samples_from_payloads(payloads)
    laps = first_present(
        endpoint_payload(payloads.get("activity_splits")),
        endpoint_payload(payloads.get("activity_laps")),
        endpoint_payload(payloads.get("activity_typed_splits")),
        endpoint_payload(payloads.get("activity_split_summaries")),
        [],
    )
    fields = available_fields(samples)
    missing = [field for field in STREAM_FIELDS if field not in fields and field != "timestamp"]
    extraction_status = "ok" if samples else "no_samples_found"
    partial_stream = bool(samples) and bool(missing)
    return {
        "activity_id": str(activity_id),
        "source": "garmin-connect",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "sync_version": "v1",
        "schema_version": "activity_streams_v1",
        "extraction_status": extraction_status,
        "checked_payloads": checked,
        "sample_count": len(samples),
        "fields": fields,
        "samples": samples,
        "laps": laps if isinstance(laps, list) else [],
        "splits": endpoint_payload(payloads.get("activity_split_summaries"))
        if isinstance(endpoint_payload(payloads.get("activity_split_summaries")), list)
        else [],
        "metadata": {
            "has_power": "power_watts" in fields,
            "has_gps": "latitude" in fields and "longitude" in fields,
            "has_cadence": "cadence" in fields,
            "has_heart_rate": "heart_rate" in fields,
        },
        "availability": {
            "available_fields": fields,
            "missing_fields": missing,
            "partial_stream": partial_stream,
            "notes": missing_notes(missing, len(samples), checked),
            "recommendation": "Run inspect_activity for this activity to diagnose Garmin payload availability."
            if extraction_status == "no_samples_found" or partial_stream
            else None,
        },
    }


def extract_samples_from_payloads(payloads: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    # Each endpoint is inspected independently; the final stream is the union of
    # descriptor, row, and column samples from all successful endpoints.
    candidates: list[tuple[str, list[dict[str, Any]]]] = []
    checked = []
    for name, wrapped in payloads.items():
        payload = endpoint_payload(wrapped)
        descriptor_samples = extract_descriptor_metric_samples(payload)
        row_samples = extract_row_samples(payload)
        column_samples = extract_column_samples(payload)
        samples = merge_samples(descriptor_samples + row_samples + column_samples)
        checked.append(
            {
                "name": name,
                "payload_type": type(payload).__name__,
                "sample_count": len(samples),
                "available_fields": available_fields(samples),
                "top_level_keys": sorted(payload.keys()) if isinstance(payload, dict) else [],
                "error": wrapped.get("error") if isinstance(wrapped, dict) else None,
            }
        )
        if samples:
            candidates.append((name, samples))
    if not candidates:
        return [], checked
    merged = merge_samples([sample for _, samples in candidates for sample in samples])
    return merged, checked


def extract_samples(payload: Any) -> list[dict[str, Any]]:
    return merge_samples(extract_descriptor_metric_samples(payload) + extract_row_samples(payload) + extract_column_samples(payload))


def extract_descriptor_metric_samples(payload: Any) -> list[dict[str, Any]]:
    # Garmin detail payloads often pair metricDescriptors with rows of metric
    # values. This recursive extractor finds that pattern wherever it appears.
    found: list[dict[str, Any]] = []
    if isinstance(payload, dict):
        descriptors = payload.get("metricDescriptors")
        metrics = payload.get("activityDetailMetrics")
        if isinstance(descriptors, list) and isinstance(metrics, list):
            found.extend(samples_from_metric_descriptors(descriptors, metrics))
        for item in payload.values():
            if isinstance(item, (dict, list)):
                found.extend(extract_descriptor_metric_samples(item))
    elif isinstance(payload, list):
        for item in payload:
            if isinstance(item, (dict, list)):
                found.extend(extract_descriptor_metric_samples(item))
    return found


def samples_from_metric_descriptors(descriptors: list[Any], metrics_rows: list[Any]) -> list[dict[str, Any]]:
    # Convert descriptor indexes into stable field names before walking rows.
    index_to_field: dict[int, str] = {}
    for descriptor in descriptors:
        if not isinstance(descriptor, dict):
            continue
        index = descriptor.get("metricsIndex")
        key = str(descriptor.get("key", ""))
        if isinstance(index, int):
            field = descriptor_key_to_field(key)
            if field:
                index_to_field[index] = field

    samples = []
    for row_index, row in enumerate(metrics_rows):
        if not isinstance(row, dict) or not isinstance(row.get("metrics"), list):
            continue
        values = row["metrics"]
        sample: dict[str, Any] = {"offset_seconds": row_index}
        for index, field in index_to_field.items():
            if index >= len(values):
                continue
            value = values[index]
            if value is None:
                continue
            if field == "timestamp":
                sample[field] = value
            elif isinstance(value, (int, float)):
                sample[field] = value
        samples.append(sample)
    return samples


def descriptor_key_to_field(key: str) -> str | None:
    # Descriptor keys are not stable across sports, so use conservative substring
    # matching and ignore ambiguous values like vertical speed.
    lowered = key.lower()
    if "timestamp" in lowered:
        return "timestamp"
    if "duration" in lowered:
        return "offset_seconds"
    if "heartrate" in lowered or lowered.endswith("hr"):
        return "heart_rate"
    if "bikecadence" in lowered or "runcadence" in lowered or lowered == "cadence":
        return "cadence"
    if "speed" in lowered and "vertical" not in lowered:
        return "speed_mps"
    if "power" in lowered or "watts" in lowered:
        return "power_watts"
    if "elevation" in lowered or "altitude" in lowered:
        return "altitude_m"
    if "distance" in lowered:
        return "distance_m"
    if "latitude" in lowered:
        return "latitude"
    if "longitude" in lowered:
        return "longitude"
    if "temperature" in lowered:
        return "temperature"
    return None


def extract_row_samples(payload: Any) -> list[dict[str, Any]]:
    # Row-shaped streams are arrays of objects or compact numeric arrays.
    candidates = find_sample_lists(payload)
    samples: list[dict[str, Any]] = []
    for candidate in candidates:
        samples.extend(normalize_sample(item, index) for index, item in enumerate(candidate))
    return [sample for sample in samples if meaningful_sample(sample)]


def extract_column_samples(payload: Any) -> list[dict[str, Any]]:
    # Column-shaped streams are merged by offset so HR/cadence/speed series line up.
    merged: dict[str, dict[str, Any]] = defaultdict(dict)
    for path, key, values in find_column_series(payload):
        field = COLUMN_SERIES_MAP.get(key)
        if field is None:
            continue
        for index, item in enumerate(values):
            offset, value = series_point(item, index)
            if value is None:
                continue
            sample = merged[str(offset)]
            sample["offset_seconds"] = offset
            sample[field] = value
            sample.setdefault("_source_paths", set()).add(path)
    samples = []
    for sample in merged.values():
        paths = sorted(sample.pop("_source_paths", set()))
        if paths:
            sample["source_paths"] = paths
        samples.append(sample)
    return sorted(samples, key=lambda sample: float(sample.get("offset_seconds", 0)))


def find_sample_lists(value: Any) -> list[list[Any]]:
    # Walk the full payload tree because Garmin nests streams differently by endpoint.
    found: list[list[Any]] = []
    if isinstance(value, list):
        if len(value) >= 2 and all(is_sample_like(item) for item in value[: min(len(value), 10)]):
            found.append(value)
        for item in value:
            found.extend(find_sample_lists(item))
    elif isinstance(value, dict):
        for key, item in value.items():
            if isinstance(item, list) and (streamish_key(key) or key in COLUMN_SERIES_MAP):
                found.extend(find_sample_lists(item))
            elif isinstance(item, (dict, list)):
                found.extend(find_sample_lists(item))
    return found


def find_column_series(value: Any, path: str = "$") -> list[tuple[str, str, list[Any]]]:
    # Retain JSON paths to help debug which endpoint contributed a column series.
    found: list[tuple[str, str, list[Any]]] = []
    if isinstance(value, dict):
        for key, item in value.items():
            child_path = f"{path}.{key}"
            if key in COLUMN_SERIES_MAP and isinstance(item, list):
                found.append((child_path, key, item))
            if isinstance(item, (dict, list)):
                found.extend(find_column_series(item, child_path))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            if isinstance(item, (dict, list)):
                found.extend(find_column_series(item, f"{path}[{index}]"))
    return found


def is_sample_like(value: Any) -> bool:
    # A candidate list must look like stream rows before we normalize it.
    if isinstance(value, dict):
        keys = {key.lower() for key in value.keys()}
        aliases = {alias.lower() for names in FIELD_ALIASES.values() for alias in names}
        return bool(keys & aliases)
    if isinstance(value, list):
        return len(value) >= 2 and any(isinstance(item, (int, float)) for item in value)
    return False


def streamish_key(key: str) -> bool:
    lowered = key.lower()
    return any(
        token in lowered
        for token in [
            "metric",
            "chart",
            "sample",
            "track",
            "polyline",
            "point",
            "stream",
            "graph",
            "values",
        ]
    )


def normalize_sample(value: Any, index: int) -> dict[str, Any]:
    # Normalize object rows and compact numeric rows into the same sample schema.
    if isinstance(value, dict):
        sample = {"offset_seconds": index}
        for field, aliases in FIELD_ALIASES.items():
            picked = pick_number(value, *aliases) if field != "timestamp" else pick(value, *aliases)
            if picked is not None:
                sample[field] = picked
        return sample
    if isinstance(value, list):
        offset = number_at(value, 0)
        return {
            "offset_seconds": offset if offset is not None else index,
            "heart_rate": number_at(value, 1),
            "cadence": number_at(value, 2),
            "speed_mps": number_at(value, 3),
            "power_watts": number_at(value, 4),
            "altitude_m": number_at(value, 5),
            "distance_m": number_at(value, 6),
        }
    return {"offset_seconds": index}


def merge_samples(samples: list[dict[str, Any]]) -> list[dict[str, Any]]:
    # Prefer the first non-null value for each field at a timestamp/offset.
    merged: dict[str, dict[str, Any]] = {}
    for index, sample in enumerate(samples):
        if not meaningful_sample(sample):
            continue
        key = sample_key(sample, index)
        merged.setdefault(key, {})
        for field, value in sample.items():
            if value is not None and field not in merged[key]:
                merged[key][field] = value
    return sorted(merged.values(), key=lambda sample: float(sample.get("offset_seconds", 0)))


def sample_key(sample: dict[str, Any], index: int) -> str:
    # Timestamp beats offset, offset beats array index when de-duplicating samples.
    if sample.get("timestamp") is not None:
        return f"ts:{sample['timestamp']}"
    if sample.get("offset_seconds") is not None:
        return f"off:{sample['offset_seconds']}"
    return f"idx:{index}"


def meaningful_sample(sample: dict[str, Any]) -> bool:
    return any(value is not None for key, value in sample.items() if not key.startswith("_") and key != "source_paths")


def series_point(item: Any, index: int) -> tuple[int | float, int | float | None]:
    if isinstance(item, list):
        offset = number_at(item, 0)
        value = number_at(item, 1)
        return (offset if offset is not None else index), value
    if isinstance(item, dict):
        offset = pick_number(item, "offset", "offset_seconds", "timerDuration", "time", "timestamp")
        value = pick_number(item, "value", "y", "heartRate", "speed", "cadence", "power", "elevation", "distance")
        return (offset if offset is not None else index), value
    return index, item if isinstance(item, (int, float)) else None


def available_fields(samples: list[dict[str, Any]]) -> list[str]:
    fields = []
    for field in STREAM_FIELDS:
        if any(sample.get(field) is not None for sample in samples):
            fields.append(field)
    return fields


def missing_notes(missing: list[str], sample_count: int, checked: list[dict[str, Any]] | None = None) -> list[str]:
    # Explain missing fields to AI clients so they do not invent data or fall back elsewhere.
    if sample_count == 0:
        checked_names = [str(item.get("name")) for item in checked or []]
        suffix = f" Checked payloads: {', '.join(checked_names)}." if checked_names else ""
        return [f"No Garmin time-series samples were found in available activity payloads.{suffix}"]
    return [f"{field} is missing because checked Garmin payloads did not contain {field} samples for this activity" for field in missing]


def endpoint_payload(value: Any) -> Any:
    # Endpoint wrappers include call metadata; downstream normalization needs the raw payload.
    if isinstance(value, dict) and "payload" in value and ("method" in value or "available" in value):
        return value.get("payload")
    return value


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


def safe_endpoint_call(func: Callable[..., Any], *args: Any, method_name: str) -> dict[str, Any]:
    # Capture endpoint failures as data so one unavailable Garmin endpoint does not break sync.
    try:
        payload = func(*args)
        return {
            "available": True,
            "method": method_name,
            "payload": payload,
            "error": None,
            "payload_type": type(payload).__name__,
            "top_level_keys": sorted(payload.keys()) if isinstance(payload, dict) else [],
        }
    except Exception as exc:
        return {
            "available": True,
            "method": method_name,
            "payload": None,
            "error": f"{type(exc).__name__}: {exc}",
            "payload_type": None,
            "top_level_keys": [],
        }


def safe_call(func: Callable[..., Any], *args: Any) -> Any:
    return safe_endpoint_call(func, *args, method_name=getattr(func, "__name__", "unknown")).get("payload")
