from __future__ import annotations

"""Preferred source rules for duplicate fitness records."""

from typing import Any

PREFERRED_SOURCE = "garmin"


def preferred_activity_source(candidates: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not candidates:
        return None
    for candidate in candidates:
        source = str(candidate.get("source") or candidate.get("provider") or "").lower()
        if source in {"garmin", "garmin-connect", "garmin_connect"}:
            return candidate | {"preferred_source": PREFERRED_SOURCE}
    return candidates[0] | {"preferred_source": str(candidates[0].get("source") or "unknown")}


def resolve_metric_source(metric: str, garmin_value: Any, strava_value: Any) -> dict[str, Any]:
    if garmin_value is not None:
        return {"metric": metric, "value": garmin_value, "source": PREFERRED_SOURCE}
    return {"metric": metric, "value": strava_value, "source": "strava" if strava_value is not None else None}
