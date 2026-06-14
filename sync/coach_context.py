from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from typing import Any


def generate_coach_context(
    *,
    daily: list[dict[str, Any]],
    sleep: list[dict[str, Any]],
    hrv: list[dict[str, Any]],
    stress: list[dict[str, Any]],
    body_battery: list[dict[str, Any]],
    activities: list[dict[str, Any]],
    days: int = 14,
) -> dict[str, Any]:
    daily_window = daily[-days:]
    sleep_window = sleep[-days:]
    hrv_window = hrv[-days:]
    stress_window = stress[-days:]
    body_battery_window = body_battery[-days:]
    start = _first_date([daily_window, sleep_window, hrv_window, stress_window, body_battery_window, activities])
    end = _last_date([daily_window, sleep_window, hrv_window, stress_window, body_battery_window, activities])
    recent_activities = [activity for activity in activities if _in_range(activity.get("date"), start, end)]

    return _compact(
        {
            "days": days,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "date_range": {"start": start, "end": end},
            "recent_activity_counts": dict(Counter(str(item.get("type", "unknown")) for item in recent_activities)),
            "activity_totals": {
                "count": len(recent_activities),
                "distance_meters": _sum_number(recent_activities, "distance_meters"),
                "duration_seconds": _sum_number(recent_activities, "duration_seconds"),
                "calories": _sum_number(recent_activities, "calories"),
            },
            "sleep_trend": _trend(sleep_window, ["date", "duration_minutes", "score"]),
            "hrv_trend": _trend(hrv_window, ["date", "status", "overnight_avg", "seven_day_avg"]),
            "stress_trend": _trend(stress_window, ["date", "avg_stress", "rest_minutes"]),
            "body_battery_trend": _trend(body_battery_window, ["date", "morning", "low", "high", "evening"]),
            "recovery_indicators": _recovery_indicators(daily_window, sleep_window, hrv_window, body_battery_window),
            "training_indicators": _training_indicators(daily_window, recent_activities),
            "injury_notes": [],
        }
    )


def _trend(rows: list[dict[str, Any]], keys: list[str]) -> list[dict[str, Any]]:
    return [_compact({key: row.get(key) for key in keys}) for row in rows]


def _recovery_indicators(
    daily: list[dict[str, Any]],
    sleep: list[dict[str, Any]],
    hrv: list[dict[str, Any]],
    body_battery: list[dict[str, Any]],
) -> dict[str, Any]:
    latest_daily = daily[-1] if daily else {}
    latest_sleep = sleep[-1] if sleep else {}
    latest_hrv = hrv[-1] if hrv else {}
    latest_body_battery = body_battery[-1] if body_battery else {}
    return _compact(
        {
            "latest_sleep_score": latest_sleep.get("score"),
            "latest_sleep_minutes": latest_sleep.get("duration_minutes"),
            "latest_hrv_status": latest_hrv.get("status"),
            "latest_hrv_overnight_avg": latest_hrv.get("overnight_avg"),
            "latest_body_battery_morning": latest_body_battery.get("morning"),
            "latest_body_battery_evening": latest_body_battery.get("evening"),
            "recovery_hours": latest_daily.get("recovery_hours"),
            "training_readiness": latest_daily.get("training_readiness"),
        }
    )


def _training_indicators(daily: list[dict[str, Any]], activities: list[dict[str, Any]]) -> dict[str, Any]:
    latest_daily = daily[-1] if daily else {}
    training_effects = [item["training_effect"] for item in activities if isinstance(item.get("training_effect"), (int, float))]
    return _compact(
        {
            "acute_load": latest_daily.get("acute_load"),
            "activity_count": len(activities),
            "max_training_effect": max(training_effects) if training_effects else None,
            "avg_training_effect": round(sum(training_effects) / len(training_effects), 2) if training_effects else None,
        }
    )


def _first_date(collections: list[list[dict[str, Any]]]) -> str | None:
    dates = sorted(str(item["date"]) for rows in collections for item in rows if item.get("date"))
    return dates[0] if dates else None


def _last_date(collections: list[list[dict[str, Any]]]) -> str | None:
    dates = sorted(str(item["date"]) for rows in collections for item in rows if item.get("date"))
    return dates[-1] if dates else None


def _in_range(value: Any, start: str | None, end: str | None) -> bool:
    if not value or not start or not end:
        return False
    text = str(value)
    return start <= text <= end


def _sum_number(rows: list[dict[str, Any]], key: str) -> int | float:
    values = [row[key] for row in rows if isinstance(row.get(key), (int, float))]
    total = sum(values)
    return round(total, 2) if isinstance(total, float) else total


def _compact(value: dict[str, Any]) -> dict[str, Any]:
    return {key: item for key, item in value.items() if item not in (None, "", [], {})}
