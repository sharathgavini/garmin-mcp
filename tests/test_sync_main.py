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


def test_run_sync_writes_normalized_json(monkeypatch, tmp_path):
    monkeypatch.setattr(sync_main, "login_or_restore", lambda **kwargs: FakeClient())
    monkeypatch.setattr(sync_main, "_date_range", lambda days: [sync_main.date(2999, 1, 1)])

    sync_main.run_sync(days=1, output=tmp_path)

    daily = json.loads((tmp_path / "daily.json").read_text())
    assert daily[0]["steps"] == 1000
    assert daily[0]["training_readiness"] == 72

    detail = json.loads((tmp_path / "activity_details" / "123.json").read_text())
    assert detail["streams_omitted"] is True
    assert "activityType" not in detail
