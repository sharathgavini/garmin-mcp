from sync.activity_streams import normalize_activity_stream


def test_stream_normalization_from_mocked_garmin_payload():
    stream = normalize_activity_stream(
        "a1",
        {
            "activity_details": {
                "activityDetailMetrics": [
                    {"timerDuration": 0, "heartRate": 92, "cadence": 0, "speed": 0, "distance": 0, "elevation": 421.2},
                    {"timerDuration": 1, "heartRate": 93, "cadence": 80, "speed": 3.1, "distance": 3.1, "elevation": 421.4},
                ]
            },
            "splits": [{"lap": 1}],
        },
    )

    assert stream["sample_count"] == 2
    assert stream["samples"][0]["heart_rate"] == 92
    assert "heart_rate" in stream["availability"]["available_fields"]
    assert "power_watts" in stream["availability"]["missing_fields"]
    assert stream["metadata"]["has_heart_rate"] is True
