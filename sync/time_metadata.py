from __future__ import annotations

"""Timezone and unit metadata for normalized Garmin records."""

import os
from datetime import date, datetime, time
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULT_TIMEZONE = "Asia/Kolkata"


def local_timezone_name() -> str:
    return os.environ.get("TZ") or DEFAULT_TIMEZONE


def local_timezone() -> ZoneInfo:
    name = local_timezone_name()
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError:
        return ZoneInfo(DEFAULT_TIMEZONE)


def timezone_offset_minutes(day: date | str | None = None) -> int:
    try:
        target_day = date.fromisoformat(str(day)[:10]) if day else datetime.now().date()
    except ValueError:
        target_day = datetime.now().date()
    local_midday = datetime.combine(target_day, time(12, 0), tzinfo=local_timezone())
    offset = local_midday.utcoffset()
    return int(offset.total_seconds() // 60) if offset else 0


def local_day_bounds(day: date | str) -> dict[str, str]:
    target_day = date.fromisoformat(str(day)[:10])
    tz = local_timezone()
    start = datetime.combine(target_day, time.min, tzinfo=tz)
    end = datetime.combine(target_day, time.max, tzinfo=tz)
    return {"local_day_start": start.isoformat(), "local_day_end": end.isoformat()}


def canonical_units() -> dict[str, str]:
    return {
        "distance": "meters",
        "duration": "seconds",
        "speed": "meters_per_second",
        "elevation": "meters",
        "heart_rate": "beats_per_minute",
        "cadence": "steps_or_revolutions_per_minute",
        "power": "watts",
        "temperature": "celsius",
        "stress": "garmin_0_to_100",
        "body_battery": "garmin_0_to_100",
        "hrv": "milliseconds",
    }


def normalized_metadata(day: date | str | None = None) -> dict[str, object]:
    return {
        "timezone": local_timezone_name(),
        "timezone_offset_minutes": timezone_offset_minutes(day),
        "units": canonical_units(),
    }
