from sync.activity_streams import client_method_inventory, normalize_activity_stream


def test_stream_normalization_from_mocked_garmin_payload():
    # Object-row Garmin detail metrics should become normalized stream samples.
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


def test_column_based_streams_are_merged_by_offset():
    # Column arrays from graph endpoints should merge into one timeline by offset.
    stream = normalize_activity_stream(
        "a2",
        {
            "activity_graphs": {
                "payload": {
                    "heartRateValues": [[0, 100], [1, 101]],
                    "speedValues": [[0, 4.0], [1, 4.2]],
                    "cadenceValues": [[1, 82]],
                },
                "method": "get_activity_graphs",
                "available": True,
                "error": None,
            }
        },
    )

    assert stream["sample_count"] == 2
    assert stream["samples"][0]["heart_rate"] == 100
    assert stream["samples"][0]["speed_mps"] == 4.0
    assert stream["samples"][1]["cadence"] == 82
    assert stream["metadata"]["has_heart_rate"] is True


def test_descriptor_metric_streams_extract_garmin_activity_detail_metrics():
    # Descriptor/index payloads are another Garmin stream shape used by activity details.
    stream = normalize_activity_stream(
        "a4",
        {
            "activity_details": {
                "payload": {
                    "metricDescriptors": [
                        {"key": "sumDuration", "metricsIndex": 0},
                        {"key": "directTimestamp", "metricsIndex": 1},
                        {"key": "directHeartRate", "metricsIndex": 2},
                        {"key": "directBikeCadence", "metricsIndex": 3},
                        {"key": "directElevation", "metricsIndex": 4},
                        {"key": "sumDistance", "metricsIndex": 5},
                    ],
                    "activityDetailMetrics": [
                        {"metrics": [0.0, 1781135335000.0, 100.0, 80.0, 497.4, 0.0]},
                        {"metrics": [1.0, 1781135336000.0, 101.0, 82.0, 497.5, 3.2]},
                    ],
                },
                "method": "get_activity_details",
                "available": True,
                "error": None,
            }
        },
    )

    assert stream["sample_count"] == 2
    assert stream["samples"][0]["heart_rate"] == 100.0
    assert stream["samples"][1]["cadence"] == 82.0
    assert stream["samples"][0]["altitude_m"] == 497.4
    assert "distance_m" in stream["fields"]


def test_no_samples_records_checked_payloads_without_false_hr_claim():
    # Missing samples should be explicit so agents do not assume HR data exists.
    stream = normalize_activity_stream(
        "a3",
        {
            "activity_graphs": {
                "payload": {"notSamples": []},
                "method": "get_activity_graphs",
                "available": True,
                "error": None,
            }
        },
    )

    assert stream["sample_count"] == 0
    assert stream["extraction_status"] == "no_samples_found"
    assert stream["checked_payloads"][0]["name"] == "activity_graphs"
    assert "Checked payloads" in stream["availability"]["notes"][0]


def test_method_inventory_captures_matching_client_methods():
    # Inspector method discovery is token-based and ignores unrelated helpers.
    class Client:
        def get_activity_graphs(self):
            return {}

        def get_user_profile(self):
            return {}

    names = [item["name"] for item in client_method_inventory(Client())]

    assert "get_activity_graphs" in names
    assert "get_user_profile" not in names
