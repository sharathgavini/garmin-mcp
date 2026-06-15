import json

from sync.renormalize import renormalize


# Renormalize tests prove raw payloads can repair normalized sleep/HRV without Garmin calls.
def test_renormalize_latest_sleep_hrv_from_raw_files(tmp_path):
    raw = tmp_path / "latest" / "raw"
    output = tmp_path / "latest"
    (raw / "sleep").mkdir(parents=True)
    (raw / "hrv").mkdir(parents=True)
    (raw / "sleep" / "sleep.json").write_text(
        json.dumps(
            [
                {
                    "date": "2026-06-14",
                    "payload": {
                        "dailySleepDTO": {
                            "sleepTimeSeconds": 25200,
                            "deepSleepSeconds": 3600,
                            "lightSleepSeconds": 14400,
                            "remSleepSeconds": 5400,
                            "awakeSleepSeconds": 1800,
                            "overallScore": 84,
                        }
                    },
                }
            ]
        ),
        encoding="utf-8",
    )
    (raw / "hrv" / "hrv.json").write_text(
        json.dumps(
            [
                {
                    "date": "2026-06-14",
                    "payload": {
                        "avgOvernightHrv": 51,
                        "hrvSummary": {"status": "BALANCED", "lastNightAvg": 52, "weeklyAvg": 49},
                        "hrvReadings": [{"hrvValue": 40}, {"hrvValue": 60}],
                    },
                }
            ]
        ),
        encoding="utf-8",
    )

    counts = renormalize(raw, output, ["sleep", "hrv"])

    assert counts == {"sleep": 1, "hrv": 1}
    sleep = json.loads((output / "sleep.json").read_text())
    hrv = json.loads((output / "hrv.json").read_text())
    assert sleep[0]["total_sleep_seconds"] == 25200
    assert sleep[0]["raw_payload_path"].endswith("sleep.json")
    assert hrv[0]["last_night_avg"] == 52
    assert hrv[0]["reading_count"] == 2


def test_renormalize_archive_partition_from_raw_files(tmp_path):
    raw = tmp_path / "archive" / "raw"
    output = tmp_path / "archive"
    partition = raw / "sleep" / "year=2026" / "month=06"
    partition.mkdir(parents=True)
    (partition / "sleep.json").write_text(
        json.dumps([{"date": "2026-06-14", "payload": {"dailySleepDTO": {"sleepTimeSeconds": 25200}}}]),
        encoding="utf-8",
    )

    counts = renormalize(raw, output, ["sleep"])

    assert counts == {"sleep": 1}
    sleep = json.loads((output / "sleep" / "year=2026" / "month=06" / "sleep.json").read_text())
    assert sleep[0]["total_sleep_seconds"] == 25200
