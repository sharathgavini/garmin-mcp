import json

from sync.inspect_activity import inspect_activity


class InspectClient:
    def get_activity(self, activity_id):
        return {
            "activityId": activity_id,
            "activityName": "Debug Ride",
            "activityType": {"typeKey": "road_biking"},
            "startTimeLocal": "2026-06-11 06:00:00",
            "distance": 22447.1,
            "duration": 4410.0,
            "averageHR": 116,
            "maxHR": 150,
        }

    def get_activity_details(self, activity_id):
        return {
            "activityDetailMetrics": [
                {"timerDuration": 0, "heartRate": 100, "speed": 3.0, "elevation": 421.0},
                {"timerDuration": 1, "heartRate": 101, "speed": 3.1, "elevation": 421.2},
            ]
        }

    def get_activity_graphs(self, activity_id):
        raise RuntimeError("not available")


def test_inspect_activity_creates_debug_folder_and_continues_after_failures(tmp_path):
    debug_dir = inspect_activity("23206576686", tmp_path, client=InspectClient())

    assert debug_dir.name == "activity_23206576686"
    assert (debug_dir / "raw_activity.json").exists()
    assert (debug_dir / "raw_activity_detail.json").exists()
    assert (debug_dir / "raw_activity_details.json").exists()
    assert (debug_dir / "raw_activity_streams.json").exists()
    assert (debug_dir / "raw_activity_graphs.json").exists()
    assert (debug_dir / "client_method_inventory.json").exists()
    assert (debug_dir / "key_inventory.txt").exists()
    assert (debug_dir / "stream_inventory.json").exists()
    assert (debug_dir / "summary.json").exists()

    failed_graphs = json.loads((debug_dir / "raw_activity_graphs.json").read_text())
    assert "RuntimeError" in failed_graphs["error"]

    summary = json.loads((debug_dir / "summary.json").read_text())
    assert summary["stream_inventory"]["sample_count"] == 2
    assert "heart_rate" in summary["stream_inventory"]["fields"]
    assert summary["normalized_detail"]["activity_name"] == "Debug Ride"
