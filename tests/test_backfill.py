import json
from datetime import date

import pytest

from sync import backfill


class FakeBackfillClient:
    def __init__(self):
        self.detail_calls = []

    def get_stats(self, day):
        return {"totalSteps": 1000}

    def get_training_readiness(self, day):
        return {"score": 70}

    def get_sleep_data(self, day):
        return {"sleepTimeSeconds": 3600, "overallScore": 80}

    def get_hrv_data(self, day):
        return {"status": "balanced", "lastNightAvg": 55}

    def get_stress_data(self, day):
        return {"avgStressLevel": 30}

    def get_body_battery(self, start, end):
        return [{"bodyBatteryValuesArray": [[start, 80], [end, 40]]}]

    def get_activities_by_date(self, start, end):
        return [
            {
                "activityId": f"activity-{start}",
                "activityType": {"typeKey": "running"},
                "startTimeLocal": f"{start} 06:00:00",
                "distance": 5000,
                "duration": 1800,
            }
        ]

    def get_activity(self, activity_id):
        self.detail_calls.append(activity_id)
        day = activity_id.replace("activity-", "")
        return {
            "activityId": activity_id,
            "activityType": {"typeKey": "running"},
            "startTimeLocal": f"{day} 06:00:00",
            "distance": 5000,
            "duration": 1800,
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


def test_chunk_ranges_are_inclusive():
    assert backfill.chunk_ranges(date(2026, 6, 1), date(2026, 6, 8), 3) == [
        (date(2026, 6, 1), date(2026, 6, 3)),
        (date(2026, 6, 4), date(2026, 6, 6)),
        (date(2026, 6, 7), date(2026, 6, 8)),
    ]


def test_write_partitioned_rows_by_month(tmp_path):
    backfill.write_partitioned_rows(
        tmp_path,
        "daily",
        [{"date": "2026-05-31", "steps": 1}, {"date": "2026-06-01", "steps": 2}],
    )

    assert (tmp_path / "daily" / "year=2026" / "month=05" / "daily.json").exists()
    june = json.loads((tmp_path / "daily" / "year=2026" / "month=06" / "daily.json").read_text())
    assert june == [{"date": "2026-06-01", "steps": 2}]


def test_resume_date_uses_completed_until():
    checkpoint = {"completed_until": "2026-06-03"}

    assert backfill.resume_date(date(2026, 6, 1), checkpoint) == date(2026, 6, 4)


def test_existing_activity_details_are_not_downloaded(tmp_path):
    client = FakeBackfillClient()
    details = tmp_path / "activity_details"
    details.mkdir()
    (details / "activity-2026-06-01.json").write_text("{}", encoding="utf-8")

    backfill.write_activity_details(tmp_path, client, [{"id": "activity-2026-06-01", "date": "2026-06-01"}])

    assert client.detail_calls == []


def test_existing_activity_streams_are_not_downloaded(tmp_path):
    client = FakeBackfillClient()
    streams = tmp_path / "activity_streams"
    streams.mkdir()
    (streams / "activity-2026-06-01.json").write_text("{}", encoding="utf-8")

    backfill.write_activity_streams(tmp_path, client, [{"id": "activity-2026-06-01", "date": "2026-06-01"}])

    assert client.detail_calls == []


def test_generate_archive_manifest_counts_rows(tmp_path):
    backfill.write_partitioned_rows(tmp_path, "daily", [{"date": "2026-06-01"}])
    backfill.write_partitioned_rows(tmp_path, "activities", [{"id": "a1", "date": "2026-06-01"}])

    manifest = backfill.generate_archive_manifest(tmp_path, date(2026, 6, 1), date(2026, 6, 1))

    assert manifest["dataset_counts"]["daily"] == 1
    assert manifest["total_activities"] == 1


def test_backfill_partial_failure_writes_checkpoint(monkeypatch, tmp_path):
    client = FakeBackfillClient()

    def fail_fetch(*args, **kwargs):
        raise RuntimeError("garmin unavailable")

    monkeypatch.setattr(backfill, "fetch_chunk", fail_fetch)

    with pytest.raises(RuntimeError):
        backfill.run_backfill(
            start_date="2026-06-01",
            end_date="2026-06-02",
            output=tmp_path,
            sleep_seconds=0,
            client=client,
        )

    checkpoint = json.loads((tmp_path / "backfill_checkpoint.json").read_text())
    assert checkpoint["status"] == "failed"
    assert checkpoint["last_error"] == "garmin unavailable"


def test_run_backfill_writes_partitions_and_manifest(tmp_path):
    client = FakeBackfillClient()

    backfill.run_backfill(
        start_date="2026-06-01",
        end_date="2026-06-02",
        output=tmp_path,
        chunk_days=1,
        sleep_seconds=0,
        client=client,
    )

    assert (tmp_path / "daily" / "year=2026" / "month=06" / "daily.json").exists()
    assert (tmp_path / "activity_details" / "activity-2026-06-01.json").exists()
    assert (tmp_path / "activity_streams" / "activity-2026-06-01.json").exists()
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest["backfill_status"] == "success"
    assert manifest["dataset_counts"]["daily"] == 2


def test_include_raw_writes_raw_partition(tmp_path):
    client = FakeBackfillClient()

    backfill.run_backfill(
        start_date="2026-06-01",
        end_date="2026-06-01",
        output=tmp_path,
        sleep_seconds=0,
        include_raw=True,
        activity_details=False,
        client=client,
    )

    assert (tmp_path / "raw" / "daily" / "year=2026" / "month=06" / "daily.json").exists()
    assert (tmp_path / "raw" / "activity_streams" / "activity-2026-06-01.json").exists()


def test_archive_output_writes_raw_to_sibling_raw_dir(tmp_path):
    client = FakeBackfillClient()
    archive = tmp_path / "archive"

    backfill.run_backfill(
        start_date="2026-06-01",
        end_date="2026-06-01",
        output=archive,
        sleep_seconds=0,
        include_raw=True,
        activity_details=False,
        client=client,
    )

    assert (tmp_path / "raw" / "daily" / "year=2026" / "month=06" / "daily.json").exists()


def test_backfill_bool_flags_accept_true_false(tmp_path):
    parser_value = backfill.bool_arg("true")
    assert parser_value is True
    assert backfill.bool_arg("false") is False
