from __future__ import annotations

from datetime import date
from typing import Any


def pick(source: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in source and source[key] is not None:
            return source[key]
    return None


def pick_path(source: dict[str, Any], *paths: tuple[str, ...]) -> Any:
    for path in paths:
        current: Any = source
        for key in path:
            if not isinstance(current, dict) or key not in current:
                current = None
                break
            current = current[key]
        if current is not None:
            return current
    return None


def normalize_daily(raw: dict[str, Any], day: date | str) -> dict[str, Any]:
    readiness = pick(raw, "trainingReadiness")
    if not isinstance(readiness, dict):
        readiness = {}
    return compact(
        {
            "date": str(day),
            "steps": pick(raw, "totalSteps", "steps"),
            "calories": pick(raw, "totalKilocalories", "calories"),
            "active_calories": pick(raw, "activeKilocalories", "activeCalories"),
            "resting_hr": pick(raw, "restingHeartRate", "restingHR"),
            "intensity_minutes": pick(raw, "moderateIntensityMinutes", "intensityMinutes"),
            "floors": pick(raw, "floorsAscended", "floors"),
            "training_readiness": pick(raw, "trainingReadinessScore", "training_readiness")
            or pick(readiness, "score", "trainingReadinessScore", "readinessScore"),
            "acute_load": pick(raw, "acuteTrainingLoad", "acute_load"),
            "recovery_hours": pick(raw, "recoveryTime", "recovery_hours"),
        }
    )


def normalize_sleep(raw: dict[str, Any], day: date | str) -> dict[str, Any]:
    return compact(
        {
            "date": str(day),
            "duration_minutes": minutes(pick(raw, "sleepTimeSeconds", "durationSeconds")),
            "score": pick(raw, "overallScore", "score")
            or pick_path(raw, ("sleepScores", "overall", "value"), ("sleepScores", "overallScore", "value")),
            "deep_minutes": minutes(pick(raw, "deepSleepSeconds", "deepSeconds")),
            "rem_minutes": minutes(pick(raw, "remSleepSeconds", "remSeconds")),
            "awake_minutes": minutes(pick(raw, "awakeSleepSeconds", "awakeSeconds")),
        }
    )


def normalize_hrv(raw: dict[str, Any], day: date | str) -> dict[str, Any]:
    return compact(
        {
            "date": str(day),
            "status": pick(raw, "status", "hrvStatus"),
            "overnight_avg": pick(raw, "lastNightAvg", "overnightAvg", "overnight_avg"),
            "seven_day_avg": pick(raw, "weeklyAvg", "sevenDayAvg", "seven_day_avg"),
        }
    )


def normalize_stress(raw: dict[str, Any], day: date | str) -> dict[str, Any]:
    return compact(
        {
            "date": str(day),
            "avg_stress": pick(raw, "avgStressLevel", "averageStressLevel", "avg_stress"),
            "max_stress": pick(raw, "maxStressLevel", "max_stress"),
            "rest_minutes": minutes(pick(raw, "restStressDuration", "restSeconds")),
        }
    )


def normalize_body_battery(raw: dict[str, Any] | list[Any], day: date | str) -> dict[str, Any]:
    if isinstance(raw, list):
        values = []
        for item in raw:
            if isinstance(item, dict):
                values.extend(pick(item, "bodyBatteryValuesArray", "values") or [])
            elif isinstance(item, list):
                values.append(item)
    else:
        values = pick(raw, "bodyBatteryValuesArray", "values") or []
    numeric_values = [item[-1] for item in values if isinstance(item, list) and item and isinstance(item[-1], (int, float))]
    return compact(
        {
            "date": str(day),
            "morning": numeric_values[0] if numeric_values else pick(raw, "morning") if isinstance(raw, dict) else None,
            "low": min(numeric_values) if numeric_values else pick(raw, "low") if isinstance(raw, dict) else None,
            "high": max(numeric_values) if numeric_values else pick(raw, "high") if isinstance(raw, dict) else None,
            "evening": numeric_values[-1] if numeric_values else pick(raw, "evening") if isinstance(raw, dict) else None,
        }
    )


def normalize_activity(raw: dict[str, Any]) -> dict[str, Any]:
    activity_type = pick(raw, "activityType", "activity_type", "type")
    if isinstance(activity_type, dict):
        activity_type = pick(activity_type, "typeKey", "typeId", "parentTypeId")
    activity_id = pick(raw, "activityId", "id")

    return compact(
        {
            "id": str(activity_id) if activity_id is not None else None,
            "type": activity_type,
            "date": str(pick(raw, "startTimeLocal", "date", "startDateLocal"))[:10],
            "distance_meters": pick(raw, "distance", "distanceMeters"),
            "duration_seconds": pick(raw, "duration", "elapsedDuration"),
            "avg_hr": pick(raw, "averageHR", "avg_hr"),
            "calories": pick(raw, "calories"),
            "training_effect": pick(raw, "aerobicTrainingEffect", "trainingEffect"),
        }
    )


def normalize_activity_detail(raw: dict[str, Any], fallback: dict[str, Any] | None = None) -> dict[str, Any]:
    fallback = fallback or {}
    summary = normalize_activity(raw) if raw else {}
    laps = pick(raw, "laps", "lapDTOs") or []
    return compact(
        {
            "id": summary.get("id") or fallback.get("id"),
            "type": summary.get("type") or fallback.get("type"),
            "date": summary.get("date") or fallback.get("date"),
            "distance_meters": summary.get("distance_meters") or fallback.get("distance_meters"),
            "duration_seconds": summary.get("duration_seconds") or fallback.get("duration_seconds"),
            "avg_hr": summary.get("avg_hr") or fallback.get("avg_hr"),
            "max_hr": pick(raw, "maxHR", "maxHr", "maxHeartRate"),
            "calories": summary.get("calories") or fallback.get("calories"),
            "training_effect": summary.get("training_effect") or fallback.get("training_effect"),
            "aerobic_training_effect": pick(raw, "aerobicTrainingEffect"),
            "anaerobic_training_effect": pick(raw, "anaerobicTrainingEffect"),
            "elevation_gain_meters": pick(raw, "elevationGain", "elevationGainMeters"),
            "laps": [_normalize_lap(lap, index + 1) for index, lap in enumerate(laps[:50]) if isinstance(lap, dict)],
            "streams_omitted": True,
        }
    )


def _normalize_lap(raw: dict[str, Any], lap_number: int) -> dict[str, Any]:
    return compact(
        {
            "lap": pick(raw, "lapNumber", "lap") or lap_number,
            "distance_meters": pick(raw, "distance", "distanceMeters"),
            "duration_seconds": pick(raw, "duration", "elapsedDuration"),
            "avg_hr": pick(raw, "averageHR", "avg_hr"),
        }
    )


def compact(value: dict[str, Any]) -> dict[str, Any]:
    return {key: item for key, item in value.items() if item is not None and item != ""}


def minutes(seconds: Any) -> int | None:
    if seconds is None:
        return None
    try:
        return round(float(seconds) / 60)
    except (TypeError, ValueError):
        return None
