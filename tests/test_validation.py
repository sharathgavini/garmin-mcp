import json

from sync.validation import filter_activity_stream_payload, filter_valid_rows


def test_filter_valid_rows_rejects_impossible_heart_rate_and_logs(tmp_path):
    rows = [
        {"id": "ok", "date": "2026-06-01", "avg_hr": 140},
        {"id": "bad", "date": "2026-06-01", "avg_hr": 260},
    ]

    valid = filter_valid_rows("activities", rows, tmp_path / "validation_rejections.json")

    assert [row["id"] for row in valid] == ["ok"]
    rejections = json.loads((tmp_path / "validation_rejections.json").read_text())
    assert rejections[0]["dataset"] == "activities"
    assert "avg_hr outside 0-240 bpm" in rejections[0]["reasons"]


def test_filter_activity_stream_payload_removes_bad_samples(tmp_path):
    payload = {
        "activity_id": "a1",
        "samples": [
            {"heart_rate": 120, "speed_mps": 5},
            {"heart_rate": 300, "speed_mps": 5},
        ],
    }

    cleaned = filter_activity_stream_payload(payload, tmp_path / "validation_rejections.json")

    assert cleaned["sample_count"] == 1
    assert cleaned["samples"] == [{"heart_rate": 120, "speed_mps": 5}]
    rejections = json.loads((tmp_path / "validation_rejections.json").read_text())
    assert rejections[0]["dataset"] == "activity_streams"
