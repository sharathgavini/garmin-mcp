import json

from sync import main as sync_main


class FakeGarth:
    def dumps(self):
        return "serialized"


class FakeClient:
    garth = FakeGarth()

    def get_stats(self, day):
        return {"totalSteps": 1000, "recoveryTime": 8}

    def get_training_readiness(self, day):
        return {"score": 72}

    def get_sleep_data(self, day):
        return {"sleepTimeSeconds": 3600, "overallScore": 80}

    def get_hrv_data(self, day):
        return {"status": "balanced", "lastNightAvg": 55}

    def get_stress_data(self, day):
        return {"avgStressLevel": 30}

    def get_body_battery(self, start, end):
        return [{"bodyBatteryValuesArray": [[start, 80], [end, 40]]}]

    def get_activities(self, start, limit):
        return [
            {
                "activityId": 123,
                "activityType": {"typeKey": "running"},
                "startTimeLocal": "2999-01-01 06:00:00",
                "distance": 5000,
                "duration": 1800,
            }
        ]

    def get_activity(self, activity_id):
        return {
            "activityId": activity_id,
            "activityType": {"typeKey": "running"},
            "startTimeLocal": "2999-01-01 06:00:00",
            "distance": 5000,
            "duration": 1800,
            "maxHR": 170,
        }

    def get_activity_details(self, activity_id, maxchart=2000, maxpoly=4000):
        return {
            "activityId": activity_id,
            "activityDetailMetrics": [
                {"timerDuration": 0, "heartRate": 100, "cadence": 80, "speed": 3.2, "distance": 0},
                {"timerDuration": 1, "heartRate": 101, "cadence": 81, "speed": 3.3, "distance": 3.2},
            ],
        }

    def get_activity_splits(self, activity_id):
        return [{"lap": 1, "distance": 1000}]

    def get_activity_typed_splits(self, activity_id):
        return []

    def get_activity_split_summaries(self, activity_id):
        return []

    def get_activity_hr_in_timezones(self, activity_id):
        return {}

    def get_activity_gear(self, activity_id):
        return {}

    def get_activity_weather(self, activity_id):
        return {}


def test_run_sync_writes_normalized_json(monkeypatch, tmp_path):
    monkeypatch.setattr(sync_main, "login_or_restore", lambda **kwargs: FakeClient())
    monkeypatch.setattr(sync_main, "_date_range", lambda days: [sync_main.date(2999, 1, 1)])

    sync_main.run_sync(days=1, output=tmp_path)

    daily = json.loads((tmp_path / "daily.json").read_text())
    assert daily[0]["steps"] == 1000
    assert daily[0]["training_readiness"] == 72

    status = json.loads((tmp_path / "latest_sync_status.json").read_text())
    assert status["status"] == "success"
    assert status["activities_synced"] == 1
    assert status["latest_activity_id"] == "123"

    detail = json.loads((tmp_path / "activity_details" / "123.json").read_text())
    assert detail["streams_omitted"] is True
    assert "activityType" not in detail

    stream = json.loads((tmp_path / "activity_streams" / "123.json").read_text())
    assert stream["sample_count"] == 2
    assert "heart_rate" in stream["fields"]
    assert (tmp_path / "raw" / "daily" / "daily.json").exists()
    assert (tmp_path / "raw" / "activity_details" / "123.json").exists()
    assert (tmp_path / "raw" / "activity_streams" / "123.json").exists()


def test_run_sync_removes_stale_activity_details(monkeypatch, tmp_path):
    monkeypatch.setattr(sync_main, "login_or_restore", lambda **kwargs: FakeClient())
    monkeypatch.setattr(sync_main, "_date_range", lambda days: [sync_main.date(2999, 1, 1)])
    stale_dir = tmp_path / "activity_details"
    stale_dir.mkdir()
    stale_file = stale_dir / "stale.json"
    stale_file.write_text("{}", encoding="utf-8")

    sync_main.run_sync(days=1, output=tmp_path)

    assert not stale_file.exists()


def test_run_sync_upload_failure_marks_status_failed(monkeypatch, tmp_path):
    monkeypatch.setattr(sync_main, "login_or_restore", lambda **kwargs: FakeClient())
    monkeypatch.setattr(sync_main, "_date_range", lambda days: [sync_main.date(2999, 1, 1)])

    def fail_upload(*args, **kwargs):
        raise RuntimeError("upload failed")

    monkeypatch.setattr(sync_main, "upload_directory_to_gcs", fail_upload)

    try:
        sync_main.run_sync(days=1, output=tmp_path, upload_gcs=True, upload_bucket="bucket-name")
    except RuntimeError:
        pass
    else:
        raise AssertionError("upload failure should propagate")

    status = json.loads((tmp_path / "latest_sync_status.json").read_text())
    assert status["status"] == "failed"
