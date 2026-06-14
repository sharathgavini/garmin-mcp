from sync.garmin_sync.normalizers import normalize_activity, normalize_sleep


def test_sleep_tolerates_missing_fields():
    assert normalize_sleep({}, "2026-06-13") == {"date": "2026-06-13"}


def test_sleep_converts_seconds_to_minutes():
    assert normalize_sleep({"sleepTimeSeconds": 3600}, "2026-06-13")["duration_minutes"] == 60


def test_activity_extracts_nested_type():
    activity = normalize_activity(
        {
            "activityId": 123,
            "activityType": {"typeKey": "running"},
            "startTimeLocal": "2026-06-13 06:10:00",
            "distance": 5000,
        }
    )
    assert activity["id"] == "123"
    assert activity["type"] == "running"
    assert activity["date"] == "2026-06-13"
