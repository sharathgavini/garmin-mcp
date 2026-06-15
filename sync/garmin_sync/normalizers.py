from __future__ import annotations

"""Garmin payload normalizers.

Normalizers convert varied Garmin API payloads into stable MCP-friendly JSON.
They omit missing values instead of inventing data.
"""

from datetime import date
from typing import Any


def pick(source: dict[str, Any], *keys: str) -> Any:
    # Garmin field names change across endpoints; first present value wins.
    for key in keys:
        if key in source and source[key] is not None:
            return source[key]
    return None


def pick_path(source: dict[str, Any], *paths: tuple[str, ...]) -> Any:
    # Nested Garmin objects often hold the same metric under different paths.
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


def pick_any(sources: list[dict[str, Any]], *keys: str) -> Any:
    # Search top-level and nested Garmin DTOs in priority order.
    for source in sources:
        if isinstance(source, dict):
            value = pick(source, *keys)
            if value is not None:
                return value
    return None


def normalize_daily(raw: dict[str, Any], day: date | str) -> dict[str, Any]:
    # Daily summary combines Garmin stats with optional training readiness.
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


def normalize_sleep(raw: dict[str, Any], day: date | str, raw_payload_path: str | None = None) -> dict[str, Any]:
    # Sleep payloads may be top-level or nested under dailySleepDTO; keep both
    # paths active so raw payload reprocessing can recover richer fields.
    daily_sleep = raw.get("dailySleepDTO") if isinstance(raw.get("dailySleepDTO"), dict) else {}
    sleep_score_payload = pick_any([raw, daily_sleep], "sleepScore")
    if not isinstance(sleep_score_payload, dict):
        sleep_score_payload = {}
    naps = pick_any([raw, daily_sleep], "dailyNapDTOS", "naps") or []
    sleep_need = pick_any([raw, daily_sleep], "sleepNeed")
    sleep_alignment = pick_any([raw, daily_sleep], "sleepAlignment")
    breathing = pick_any([raw, daily_sleep], "breathingDisruptionData") or {}
    row = {
        "date": str(day),
        "sleep_start_gmt": pick_any([raw, daily_sleep], "sleepStartTimestampGMT", "sleepStartGMT"),
        "sleep_end_gmt": pick_any([raw, daily_sleep], "sleepEndTimestampGMT", "sleepEndGMT"),
        "sleep_start_local": pick_any([raw, daily_sleep], "sleepStartTimestampLocal", "sleepStartLocal"),
        "sleep_end_local": pick_any([raw, daily_sleep], "sleepEndTimestampLocal", "sleepEndLocal"),
        "total_sleep_seconds": pick_any([raw, daily_sleep], "sleepTimeSeconds", "totalSleepSeconds", "durationSeconds"),
        "deep_sleep_seconds": pick_any([raw, daily_sleep], "deepSleepSeconds", "deepSeconds"),
        "light_sleep_seconds": pick_any([raw, daily_sleep], "lightSleepSeconds", "lightSeconds"),
        "rem_sleep_seconds": pick_any([raw, daily_sleep], "remSleepSeconds", "remSeconds"),
        "awake_sleep_seconds": pick_any([raw, daily_sleep], "awakeSleepSeconds", "awakeSeconds"),
        "sleep_score": pick_any([raw, daily_sleep], "overallScore", "score")
        or pick_any([sleep_score_payload], "overallScore", "score", "value")
        or pick_path(
            raw,
            ("sleepScores", "overall", "value"),
            ("sleepScores", "overallScore", "value"),
            ("sleepScore", "overallScore", "value"),
            ("sleepScore", "score", "value"),
        )
        or pick_path(
            daily_sleep,
            ("sleepScores", "overall", "value"),
            ("sleepScores", "overallScore", "value"),
            ("sleepScore", "overallScore", "value"),
            ("sleepScore", "score", "value"),
        ),
        "sleep_score_qualifier": pick_any([raw, daily_sleep, sleep_score_payload], "sleepScoreQualifier", "scoreQualifier", "overallScoreQualifier", "qualifier"),
        "sleep_quality": pick_any([raw, daily_sleep, sleep_score_payload], "sleepQuality", "sleepQualityTypePK", "qualifier"),
        "avg_sleep_stress": pick_any([raw, daily_sleep], "avgSleepStress", "averageSleepStress"),
        "avg_heart_rate": pick_any([raw, daily_sleep], "avgHeartRate", "averageHeartRate"),
        "lowest_spo2": pick_any([raw, daily_sleep], "lowestSpO2Value", "lowestSpO2", "lowestSpo2", "minSpO2"),
        "avg_spo2": pick_any([raw, daily_sleep], "averageSpO2Value", "avgSpO2", "averageSpo2"),
        "avg_respiration": pick_any([raw, daily_sleep], "averageRespirationValue", "avgRespiration"),
        "lowest_respiration": pick_any([raw, daily_sleep], "lowestRespirationValue", "minRespiration"),
        "highest_respiration": pick_any([raw, daily_sleep], "highestRespirationValue", "maxRespiration"),
        "body_battery_change": pick_any([raw, daily_sleep], "bodyBatteryChange"),
        "body_battery_recharge": pick_any([raw, daily_sleep], "bodyBatteryRecharge", "bodyBatteryChange"),
        "nap_time_seconds": pick_any([raw, daily_sleep], "napTimeSeconds", "dailyNapSeconds"),
        "naps": naps,
        "sleep_need": sleep_need,
        "sleep_alignment": sleep_alignment,
        "breathing_disruption_severity": pick(breathing, "severity", "breathingDisruptionSeverity")
        if isinstance(breathing, dict)
        else pick_any([raw, daily_sleep], "breathingDisruptionSeverity"),
        "raw_payload_path": raw_payload_path,
    }
    required = [
        "sleep_start_gmt",
        "sleep_end_gmt",
        "total_sleep_seconds",
        "deep_sleep_seconds",
        "light_sleep_seconds",
        "rem_sleep_seconds",
        "awake_sleep_seconds",
        "sleep_score",
        "avg_sleep_stress",
        "avg_heart_rate",
        "avg_spo2",
        "body_battery_change",
    ]
    missing = [field for field in required if row.get(field) is None]
    # data_available means "we extracted any meaningful sleep metric", not full completeness.
    row["data_available"] = any(row.get(field) is not None for field in required)
    row["missing_fields"] = missing
    row["extraction_notes"] = ["dailySleepDTO found"] if daily_sleep else ["dailySleepDTO missing; normalized from top-level payload only"]
    legacy = {
        "duration_minutes": minutes(row.get("total_sleep_seconds")),
        "score": row.get("sleep_score"),
        "deep_minutes": minutes(row.get("deep_sleep_seconds")),
        "rem_minutes": minutes(row.get("rem_sleep_seconds")),
        "awake_minutes": minutes(row.get("awake_sleep_seconds")),
    }
    return compact(row | legacy)


def normalize_hrv(raw: dict[str, Any], day: date | str, raw_payload_path: str | None = None) -> dict[str, Any]:
    # HRV summaries and 5-minute readings are both useful: summaries for quick
    # recovery state, readings for deeper overnight analysis.
    summary = raw.get("hrvSummary") if isinstance(raw.get("hrvSummary"), dict) else {}
    readings_raw = pick(raw, "hrvReadings", "readings") or []
    readings = [_normalize_hrv_reading(item) for item in readings_raw if isinstance(item, dict)]
    hrv_values = [item["hrv_value"] for item in readings if isinstance(item.get("hrv_value"), (int, float))]
    row = {
        "date": str(day),
        "avg_overnight_hrv": pick(raw, "avgOvernightHrv", "averageOvernightHrv"),
        "last_night_avg": pick_any([raw, summary], "lastNightAvg", "last_night_avg"),
        "last_night_5min_high": pick_any([raw, summary], "lastNight5MinHigh", "lastNight5minHigh", "lastNightFiveMinuteHigh"),
        "weekly_avg": pick_any([raw, summary], "weeklyAvg", "sevenDayAvg", "weekly_avg"),
        "hrv_status": pick_any([raw, summary], "status", "hrvStatus"),
        "feedback_phrase": pick_any([raw, summary], "feedbackPhrase", "feedback_phrase"),
        "baseline_balanced_low": pick_any([raw, summary], "baselineBalancedLow", "balancedLow"),
        "baseline_balanced_upper": pick_any([raw, summary], "baselineBalancedUpper", "balancedUpper"),
        "baseline_low_upper": pick_any([raw, summary], "baselineLowUpper", "lowUpper"),
        "readings": readings,
        "reading_count": len(readings),
        "min_hrv": min(hrv_values) if hrv_values else None,
        "max_hrv": max(hrv_values) if hrv_values else None,
        "data_available": bool(summary or readings or pick(raw, "avgOvernightHrv")),
        "raw_payload_path": raw_payload_path,
    }
    row["status"] = row["hrv_status"]
    row["overnight_avg"] = row["avg_overnight_hrv"] or row["last_night_avg"]
    row["seven_day_avg"] = row["weekly_avg"]
    return compact(row)


def normalize_stress(raw: dict[str, Any], day: date | str) -> dict[str, Any]:
    # Stress is intentionally compact; raw payloads remain available for future fields.
    return compact(
        {
            "date": str(day),
            "avg_stress": pick(raw, "avgStressLevel", "averageStressLevel", "avg_stress"),
            "max_stress": pick(raw, "maxStressLevel", "max_stress"),
            "rest_minutes": minutes(pick(raw, "restStressDuration", "restSeconds")),
        }
    )


def normalize_body_battery(raw: dict[str, Any] | list[Any], day: date | str) -> dict[str, Any]:
    # Garmin body battery commonly arrives as an array of timestamp/value pairs.
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
    # Activity summaries are the index used by range tools; details/streams stay separate.
    summary = raw.get("summaryDTO") if isinstance(raw.get("summaryDTO"), dict) else {}
    activity_type = pick(raw, "activityType", "activityTypeDTO", "activity_type", "type")
    if isinstance(activity_type, dict):
        activity_type = pick(activity_type, "typeKey", "typeId", "parentTypeId")
    activity_id = pick(raw, "activityId", "id")

    return compact(
        {
            "id": str(activity_id) if activity_id is not None else None,
            "type": activity_type,
            "date": str(pick(raw, "startTimeLocal", "date", "startDateLocal") or pick(summary, "startTimeLocal", "startTimeGMT"))[:10],
            "distance_meters": pick(raw, "distance", "distanceMeters") or pick(summary, "distance"),
            "duration_seconds": pick(raw, "duration", "elapsedDuration") or pick(summary, "duration"),
            "avg_hr": pick(raw, "averageHR", "avg_hr") or pick(summary, "averageHR"),
            "calories": pick(raw, "calories") or pick(summary, "calories"),
            "training_effect": pick(raw, "aerobicTrainingEffect", "trainingEffect") or pick(summary, "trainingEffect"),
        }
    )


def normalize_activity_detail(raw: dict[str, Any], fallback: dict[str, Any] | None = None) -> dict[str, Any]:
    # Detail normalization enriches the summary while keeping streams in their own file.
    fallback = fallback or {}
    summary = normalize_activity(raw) if raw else {}
    raw_summary = raw.get("summaryDTO") if isinstance(raw.get("summaryDTO"), dict) else raw
    laps = pick(raw, "laps", "lapDTOs") or []
    splits = pick(raw, "splits", "splitDTOs", "activitySplits") or []
    activity_id = summary.get("id") or fallback.get("id")
    return compact(
        {
            "activity_id": activity_id,
            "id": activity_id,
            "activity_name": pick(raw, "activityName", "activity_name", "name"),
            "activity_type": summary.get("type") or fallback.get("type"),
            "type": summary.get("type") or fallback.get("type"),
            "sport_category": pick(raw, "sportType", "sport_type", "parentTypeId"),
            "start_time": pick(raw, "startTimeLocal", "startTimeGMT", "start_time") or pick(raw_summary, "startTimeLocal", "startTimeGMT"),
            "date": summary.get("date") or fallback.get("date"),
            "elapsed_duration_seconds": pick(raw, "elapsedDuration", "elapsed_duration_seconds") or pick(raw_summary, "elapsedDuration"),
            "moving_duration_seconds": pick(raw, "movingDuration", "moving_duration_seconds") or pick(raw_summary, "movingDuration"),
            "distance_meters": summary.get("distance_meters") or fallback.get("distance_meters"),
            "duration_seconds": summary.get("duration_seconds") or fallback.get("duration_seconds"),
            "avg_hr": summary.get("avg_hr") or fallback.get("avg_hr"),
            "max_hr": pick(raw, "maxHR", "maxHr", "maxHeartRate") or pick(raw_summary, "maxHR"),
            "avg_cadence": pick(raw, "averageBikingCadenceInRevPerMinute", "averageRunningCadenceInStepsPerMinute", "averageCadence", "avg_cadence")
            or pick(raw_summary, "averageBikeCadence", "averageRunCadence"),
            "max_cadence": pick(raw, "maxBikingCadenceInRevPerMinute", "maxRunningCadenceInStepsPerMinute", "maxCadence", "max_cadence")
            or pick(raw_summary, "maxBikeCadence", "maxRunCadence"),
            "avg_speed_mps": pick(raw, "averageSpeed", "avgSpeed", "avg_speed_mps") or pick(raw_summary, "averageSpeed"),
            "max_speed_mps": pick(raw, "maxSpeed", "max_speed_mps") or pick(raw_summary, "maxSpeed"),
            "calories": summary.get("calories") or fallback.get("calories"),
            "training_effect": summary.get("training_effect") or fallback.get("training_effect"),
            "aerobic_training_effect": pick(raw, "aerobicTrainingEffect") or pick(raw_summary, "trainingEffect"),
            "anaerobic_training_effect": pick(raw, "anaerobicTrainingEffect") or pick(raw_summary, "anaerobicTrainingEffect"),
            "training_load": pick(raw, "trainingLoad", "exerciseLoad", "training_load") or pick(raw_summary, "activityTrainingLoad"),
            "recovery_time": pick(raw, "recoveryTime", "recovery_time") or pick(raw_summary, "recoveryTime"),
            "avg_power": pick(raw, "avgPower", "averagePower", "avg_power") or pick(raw_summary, "averagePower"),
            "normalized_power": pick(raw, "normPower", "normalizedPower", "normalized_power") or pick(raw_summary, "normPower", "normalizedPower"),
            "max_power": pick(raw, "maxPower", "max_power") or pick(raw_summary, "maxPower"),
            "ftp": pick(raw, "ftp"),
            "vo2max": pick(raw, "vO2MaxValue", "vo2max", "VO2Max"),
            "performance_condition": pick(raw, "performanceCondition", "performance_condition"),
            "elevation_gain_m": pick(raw, "elevationGain", "elevationGainMeters") or pick(raw_summary, "elevationGain"),
            "elevation_gain_meters": pick(raw, "elevationGain", "elevationGainMeters") or pick(raw_summary, "elevationGain"),
            "elevation_loss_m": pick(raw, "elevationLoss", "elevationLossMeters") or pick(raw_summary, "elevationLoss"),
            "weather": pick(raw, "weather", "weatherDTO"),
            "device_info": pick(raw, "deviceInfo", "metadataDTO", "deviceDTO"),
            "laps": [_normalize_lap(lap, index + 1) for index, lap in enumerate(laps[:50]) if isinstance(lap, dict)],
            "splits": [_normalize_lap(split, index + 1) for index, split in enumerate(splits[:100]) if isinstance(split, dict)],
            "streams_stored_separately": True if activity_id else None,
            "stream_path": f"activity_streams/{activity_id}.json" if activity_id else None,
        }
    )


def _normalize_lap(raw: dict[str, Any], lap_number: int) -> dict[str, Any]:
    # Laps and splits share the same compact shape for downstream analysis.
    return compact(
        {
            "lap": pick(raw, "lapNumber", "lap") or lap_number,
            "distance_meters": pick(raw, "distance", "distanceMeters"),
            "duration_seconds": pick(raw, "duration", "elapsedDuration"),
            "avg_hr": pick(raw, "averageHR", "avg_hr"),
        }
    )


def _normalize_hrv_reading(raw: dict[str, Any]) -> dict[str, Any]:
    # Preserve both GMT and local times so clients can align readings with sleep windows.
    return compact(
        {
            "hrv_value": pick(raw, "hrvValue", "hrv_value", "value"),
            "reading_time_gmt": pick(raw, "readingTimeGMT", "reading_time_gmt", "timestampGMT"),
            "reading_time_local": pick(raw, "readingTimeLocal", "reading_time_local", "timestampLocal"),
        }
    )


def compact(value: dict[str, Any]) -> dict[str, Any]:
    # Keep normalized JSON small while preserving meaningful false/zero values.
    return {key: item for key, item in value.items() if item is not None and item != ""}


def minutes(seconds: Any) -> int | None:
    if seconds is None:
        return None
    try:
        return round(float(seconds) / 60)
    except (TypeError, ValueError):
        return None
