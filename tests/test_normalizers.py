from sync.garmin_sync.normalizers import normalize_activity, normalize_hrv, normalize_sleep


def test_sleep_tolerates_missing_fields():
    sleep = normalize_sleep({}, "2026-06-13")
    assert sleep["date"] == "2026-06-13"
    assert sleep["data_available"] is False
    assert "total_sleep_seconds" in sleep["missing_fields"]


def test_sleep_converts_seconds_to_minutes():
    assert normalize_sleep({"sleepTimeSeconds": 3600}, "2026-06-13")["duration_minutes"] == 60


def test_sleep_extracts_rich_garmin_payload():
    sleep = normalize_sleep(
        {
            "dailySleepDTO": {
                "sleepStartTimestampGMT": "2026-06-13T18:30:00.0",
                "sleepEndTimestampGMT": "2026-06-14T01:30:00.0",
                "sleepStartTimestampLocal": "2026-06-14T00:00:00.0",
                "sleepEndTimestampLocal": "2026-06-14T07:00:00.0",
                "sleepTimeSeconds": 25200,
                "deepSleepSeconds": 3600,
                "lightSleepSeconds": 14400,
                "remSleepSeconds": 5400,
                "awakeSleepSeconds": 1800,
                "overallScore": 84,
                "sleepScoreQualifier": "GOOD",
                "avgSleepStress": 18,
                "avgHeartRate": 52,
                "lowestSpO2": 91,
                "averageSpO2Value": 96,
                "averageRespirationValue": 14.2,
                "lowestRespirationValue": 10.1,
                "highestRespirationValue": 18.4,
                "bodyBatteryChange": 58,
                "dailyNapDTOS": [{"durationSeconds": 1200}],
                "sleepNeed": {"baseline": 28800},
                "sleepAlignment": {"score": 70},
                "breathingDisruptionData": {"severity": "LOW"},
            }
        },
        "2026-06-14",
        raw_payload_path="raw/sleep/sleep.json",
    )

    assert sleep["total_sleep_seconds"] == 25200
    assert sleep["deep_sleep_seconds"] == 3600
    assert sleep["rem_sleep_seconds"] == 5400
    assert sleep["sleep_score"] == 84
    assert sleep["avg_sleep_stress"] == 18
    assert sleep["avg_spo2"] == 96
    assert sleep["body_battery_change"] == 58
    assert sleep["breathing_disruption_severity"] == "LOW"
    assert sleep["raw_payload_path"] == "raw/sleep/sleep.json"
    assert sleep["data_available"] is True


def test_hrv_extracts_summary_and_readings():
    hrv = normalize_hrv(
        {
            "avgOvernightHrv": 51,
            "hrvSummary": {
                "status": "BALANCED",
                "lastNightAvg": 52,
                "lastNight5MinHigh": 82,
                "weeklyAvg": 49,
                "feedbackPhrase": "Balanced",
                "baselineBalancedLow": 44,
                "baselineBalancedUpper": 62,
                "baselineLowUpper": 35,
            },
            "hrvReadings": [
                {"hrvValue": 40, "readingTimeGMT": "2026-06-13T20:00:00.0", "readingTimeLocal": "2026-06-14T01:30:00.0"},
                {"hrvValue": 60, "readingTimeGMT": "2026-06-13T20:05:00.0", "readingTimeLocal": "2026-06-14T01:35:00.0"},
            ],
        },
        "2026-06-14",
        raw_payload_path="raw/hrv/hrv.json",
    )

    assert hrv["avg_overnight_hrv"] == 51
    assert hrv["last_night_avg"] == 52
    assert hrv["last_night_5min_high"] == 82
    assert hrv["weekly_avg"] == 49
    assert hrv["hrv_status"] == "BALANCED"
    assert hrv["baseline_balanced_low"] == 44
    assert hrv["reading_count"] == 2
    assert hrv["min_hrv"] == 40
    assert hrv["max_hrv"] == 60
    assert hrv["readings"][0]["reading_time_gmt"] == "2026-06-13T20:00:00.0"
    assert hrv["raw_payload_path"] == "raw/hrv/hrv.json"


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
