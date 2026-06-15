import json

from sync import backfill, repair_activity_details


class FakeRepairClient:
    def __init__(self):
        self.calls = []

    def get_activity(self, activity_id):
        self.calls.append(activity_id)
        return {
            "activityId": activity_id,
            "activityName": f"Detail {activity_id}",
            "activityType": {"typeKey": "cycling"},
            "startTimeLocal": "2026-06-01 06:00:00",
            "distance": 1000,
            "duration": 300,
        }


def write_archive_activities(tmp_path):
    backfill.write_partitioned_rows(
        tmp_path,
        "activities",
        [
            {"id": "a1", "date": "2026-06-01", "type": "cycling"},
            {"id": "a2", "date": "2026-06-02", "type": "cycling"},
            {"id": "a3", "date": "2026-06-03", "type": "running"},
        ],
    )


def test_detects_missing_and_skips_existing_details(tmp_path):
    write_archive_activities(tmp_path)
    existing = tmp_path / "activity_details"
    existing.mkdir()
    (existing / "a1.json").write_text("{}", encoding="utf-8")
    client = FakeRepairClient()

    status = repair_activity_details.run_repair(
        start_date="2026-06-01",
        end_date="2026-06-03",
        output=tmp_path,
        sleep_seconds=0,
        client=client,
    )

    assert status["total_activities"] == 3
    assert status["existing_details"] == 1
    assert status["missing_details"] == 2
    assert status["repaired_details"] == 2
    assert client.calls == ["a2", "a3"]
    assert (tmp_path / "activity_details" / "a2.json").exists()


def test_force_refetches_existing_details(tmp_path):
    write_archive_activities(tmp_path)
    details = tmp_path / "activity_details"
    details.mkdir()
    (details / "a1.json").write_text("{}", encoding="utf-8")
    client = FakeRepairClient()

    repair_activity_details.run_repair(
        start_date="2026-06-01",
        end_date="2026-06-01",
        output=tmp_path,
        force=True,
        sleep_seconds=0,
        client=client,
    )

    assert client.calls == ["a1"]
    detail = json.loads((details / "a1.json").read_text(encoding="utf-8"))
    assert detail["activity_name"] == "Detail a1"


def test_writes_raw_and_normalized_detail(tmp_path):
    write_archive_activities(tmp_path)

    repair_activity_details.run_repair(
        start_date="2026-06-01",
        end_date="2026-06-01",
        output=tmp_path,
        include_raw=True,
        sleep_seconds=0,
        client=FakeRepairClient(),
    )

    assert (tmp_path / "activity_details" / "a1.json").exists()
    assert (tmp_path / "raw" / "activity_details" / "a1.json").exists()


def test_continues_after_failures_and_writes_status(monkeypatch, tmp_path):
    write_archive_activities(tmp_path)

    def fake_fetch(client, activity_id):
        if activity_id == "a2":
            raise RuntimeError("boom")
        return {"activity": {"payload": client.get_activity(activity_id), "error": None}}

    monkeypatch.setattr(repair_activity_details, "fetch_activity_payloads", fake_fetch)
    status = repair_activity_details.run_repair(
        start_date="2026-06-01",
        end_date="2026-06-03",
        output=tmp_path,
        sleep_seconds=0,
        client=FakeRepairClient(),
    )

    status_file = json.loads((tmp_path / "activity_detail_repair_status.json").read_text(encoding="utf-8"))
    assert status["status"] == "warning"
    assert status["repaired_details"] == 2
    assert status["failed_details"] == 1
    assert status["failures"][0]["activity_id"] == "a2"
    assert status_file["failed_details"] == 1
    assert (tmp_path / "activity_details" / "a1.json").exists()
    assert not (tmp_path / "activity_details" / "a2.json").exists()
