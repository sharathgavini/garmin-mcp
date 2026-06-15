import json

from sync import archive_maintenance, backfill


def write_fixture(tmp_path):
    backfill.write_partitioned_rows(
        tmp_path,
        "activities",
        [
            {"id": "a1", "date": "2026-06-01", "type": "cycling", "duration_seconds": 1800, "distance_meters": 10000},
            {"id": "a2", "date": "2026-06-03", "type": "running", "duration_seconds": 1200, "distance_meters": 5000},
            {"id": "a3", "date": "2026-07-01", "type": "cycling", "duration_seconds": 2400, "distance_meters": 20000},
        ],
    )
    backfill.write_partitioned_rows(
        tmp_path,
        "sleep",
        [
            {"date": "2026-06-01", "total_sleep_seconds": 28000, "sleep_score": 80},
            {"date": "2026-06-02", "total_sleep_seconds": 26000, "sleep_score": 70},
        ],
    )
    backfill.write_partitioned_rows(tmp_path, "daily", [{"date": "2026-06-01"}])


def test_rollup_job_produces_weekly_and_monthly_aggregates(tmp_path):
    write_fixture(tmp_path)

    summary = archive_maintenance.build_rollups(tmp_path, "2026-06-01", "2026-07-31")

    weekly = json.loads((tmp_path / "rollups" / "weekly" / "2026-W23.json").read_text())
    monthly = json.loads((tmp_path / "rollups" / "monthly" / "2026-06.json").read_text())
    sleep = json.loads((tmp_path / "rollups" / "sleep_weekly" / "2026-W23.json").read_text())
    assert weekly["activity_count"] == 2
    assert weekly["total_duration_seconds"] == 3000
    assert monthly["activities_by_sport"]["cycling"] == 1
    assert sleep["avg_sleep_seconds"] == 27000
    assert "rollups/weekly/2026-W23.json" in summary["written"]
    assert weekly["timezone"]
    assert weekly["timezone_offset_minutes"] is not None
    assert summary["local_day_bounds"]["start"].startswith("2026-06-01T00:00:00")


def test_stale_rollups_detect_schema_bump_and_rebuild(tmp_path):
    write_fixture(tmp_path)

    archive_maintenance.build_rollups(tmp_path, "2026-06-01", "2026-06-30", schema_version="v1")

    assert archive_maintenance.stale_rollups(tmp_path, schema_version="v2")
    archive_maintenance.build_rollups(tmp_path, "2026-06-01", "2026-06-30", schema_version="v2")
    assert archive_maintenance.stale_rollups(tmp_path, schema_version="v2") == []


def test_partition_manifest_points_to_partitions_and_verify_flags_drift(tmp_path):
    write_fixture(tmp_path)

    manifest = archive_maintenance.build_partition_manifest(tmp_path)

    assert manifest["datasets"]["activities"]["dates"]["2026-06-01"]["partition"] == "activities/year=2026/month=06/activities.json"
    assert manifest["datasets"]["activities"]["record_count"] == 3

    path = tmp_path / "activities" / "year=2026" / "month=06" / "activities.json"
    path.write_text(json.dumps([{"id": "a1", "date": "2026-06-01"}]), encoding="utf-8")
    verify = archive_maintenance.verify_partition_manifest(tmp_path)
    assert verify["status"] == "warning"
    assert verify["drift"][0]["dataset"] == "activities"
