import json
from datetime import datetime, timezone

from sync import backfill, renormalize, sync_now
from sync.garmin_sync.normalizers import CURRENT_SCHEMA_VERSION


def fake_run_sync_factory(calls):
    def fake_run_sync(**kwargs):
        calls.append(kwargs)
        output = kwargs["output"]
        output.mkdir(parents=True, exist_ok=True)
        (output / "latest_sync_status.json").write_text(
            json.dumps(
                {
                    "status": "success",
                    "activities_synced": 2,
                    "latest_available_dates": {
                        "daily": "2026-06-15",
                        "sleep": "2026-06-15",
                        "hrv": "2026-06-15",
                        "stress": "2026-06-15",
                        "body_battery": "2026-06-15",
                    },
                }
            ),
            encoding="utf-8",
        )

    return fake_run_sync


def write_state(latest, completed_at="2026-06-15T00:00:00+00:00"):
    state_path = latest.parent / "archive" / "sync_state.json"
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(
        json.dumps(
            {
                "last_sync_completed_at": completed_at,
                "datasets": {
                    name: {"last_synced_at": "2026-06-13T00:00:00+00:00"}
                    for name in sync_now.DATASETS
                },
            }
        ),
        encoding="utf-8",
    )
    return state_path


def test_second_run_within_cooldown_is_light(monkeypatch, tmp_path):
    latest = tmp_path / "latest"
    write_state(latest)
    calls = []
    monkeypatch.setattr(sync_now, "run_sync", fake_run_sync_factory(calls))

    status = sync_now.run_incremental_sync(
        output=latest,
        now=datetime(2026, 6, 15, 0, 2, tzinfo=timezone.utc),
        min_interval_minutes=5,
    )

    assert status["run_type"] == "cooldown-light"
    assert calls[0]["days"] == 1


def test_force_overrides_cooldown(monkeypatch, tmp_path):
    latest = tmp_path / "latest"
    write_state(latest)
    calls = []
    monkeypatch.setattr(sync_now, "run_sync", fake_run_sync_factory(calls))

    status = sync_now.run_incremental_sync(
        output=latest,
        force=True,
        now=datetime(2026, 6, 15, 0, 2, tzinfo=timezone.utc),
        min_interval_minutes=5,
    )

    assert status["run_type"] == "delta"
    assert calls[0]["days"] == 5


def test_delta_window_uses_watermark_minus_lookback(monkeypatch, tmp_path):
    latest = tmp_path / "latest"
    write_state(latest, completed_at="2026-06-01T00:00:00+00:00")
    calls = []
    monkeypatch.setattr(sync_now, "run_sync", fake_run_sync_factory(calls))

    sync_now.run_incremental_sync(
        output=latest,
        now=datetime(2026, 6, 15, 0, 0, tzinfo=timezone.utc),
        lookback_days=2,
    )

    assert calls[0]["days"] == 5


def test_full_ignores_watermarks(monkeypatch, tmp_path):
    latest = tmp_path / "latest"
    write_state(latest)
    calls = []
    monkeypatch.setattr(sync_now, "run_sync", fake_run_sync_factory(calls))

    status = sync_now.run_incremental_sync(
        output=latest,
        full=True,
        days=30,
        now=datetime(2026, 6, 15, 0, 2, tzinfo=timezone.utc),
    )

    assert status["run_type"] == "full"
    assert calls[0]["days"] == 30


def test_status_reports_dataset_watermarks(monkeypatch, tmp_path):
    latest = tmp_path / "latest"
    write_state(latest, completed_at="2026-06-01T00:00:00+00:00")
    calls = []
    monkeypatch.setattr(sync_now, "run_sync", fake_run_sync_factory(calls))

    status = sync_now.run_incremental_sync(
        output=latest,
        now=datetime(2026, 6, 15, 0, 0, tzinfo=timezone.utc),
    )

    stored = json.loads((latest / "latest_sync_status.json").read_text(encoding="utf-8"))
    state = json.loads((latest.parent / "archive" / "sync_state.json").read_text(encoding="utf-8"))
    assert status["dataset_watermarks"]["daily"]["watermark_before"] == "2026-06-13T00:00:00+00:00"
    assert stored["dataset_watermarks"]["activities"]["records_fetched"] == 2
    assert state["datasets"]["daily"]["last_synced_at"]


def test_delta_run_updates_and_verifies_partition_manifest(monkeypatch, tmp_path):
    latest = tmp_path / "latest"
    archive = tmp_path / "archive"
    write_state(latest, completed_at="2026-06-01T00:00:00+00:00")
    backfill.write_partitioned_rows(archive, "daily", [{"date": "2026-06-15", "steps": 1000}])
    calls = []
    monkeypatch.setattr(sync_now, "run_sync", fake_run_sync_factory(calls))

    status = sync_now.run_incremental_sync(
        output=latest,
        now=datetime(2026, 6, 15, 0, 0, tzinfo=timezone.utc),
    )

    manifest = json.loads((archive / "partition_manifest.json").read_text(encoding="utf-8"))
    verify = json.loads((archive / "partition_manifest_verify.json").read_text(encoding="utf-8"))
    assert manifest["datasets"]["daily"]["record_count"] == 1
    assert verify["status"] == "ok"
    assert status["partition_manifest_verify"]["status"] == "ok"


def test_interrupted_delta_resumes_from_checkpoint(monkeypatch, tmp_path):
    latest = tmp_path / "latest"
    write_state(latest, completed_at="2026-06-01T00:00:00+00:00")
    checkpoint = latest.parent / "archive" / "sync_checkpoint.json"
    checkpoint.write_text(
        json.dumps({"status": "running", "run_type": "delta", "days_requested": 4, "started_at": "2026-06-15T00:00:00+00:00"}),
        encoding="utf-8",
    )
    calls = []
    monkeypatch.setattr(sync_now, "run_sync", fake_run_sync_factory(calls))

    status = sync_now.run_incremental_sync(
        output=latest,
        now=datetime(2026, 6, 15, 0, 0, tzinfo=timezone.utc),
        lookback_days=2,
    )

    stored_checkpoint = json.loads(checkpoint.read_text(encoding="utf-8"))
    assert calls[0]["days"] == 4
    assert status["days_requested"] == 4
    assert stored_checkpoint["status"] == "success"


def test_delta_written_records_carry_current_schema_version(monkeypatch, tmp_path):
    latest = tmp_path / "latest"
    write_state(latest, completed_at="2026-06-01T00:00:00+00:00")

    def fake_run_sync(**kwargs):
        output = kwargs["output"]
        output.mkdir(parents=True, exist_ok=True)
        (output / "daily.json").write_text(json.dumps([{"date": "2026-06-15", "schema_version": CURRENT_SCHEMA_VERSION}]), encoding="utf-8")
        (output / "latest_sync_status.json").write_text(
            json.dumps({"status": "success", "activities_synced": 0, "latest_available_dates": {"daily": "2026-06-15"}}),
            encoding="utf-8",
        )

    monkeypatch.setattr(sync_now, "run_sync", fake_run_sync)

    sync_now.run_incremental_sync(output=latest, now=datetime(2026, 6, 15, 0, 0, tzinfo=timezone.utc))

    daily = json.loads((latest / "daily.json").read_text(encoding="utf-8"))
    assert daily[0]["schema_version"] == CURRENT_SCHEMA_VERSION


def test_renormalize_picks_up_older_delta_records(tmp_path):
    raw = tmp_path / "latest" / "raw" / "sleep"
    output = tmp_path / "latest"
    raw.mkdir(parents=True)
    (raw / "sleep.json").write_text(json.dumps([{"date": "2026-06-15", "payload": {"sleepTimeSeconds": 3600}}]), encoding="utf-8")
    (output / "sleep.json").write_text(json.dumps([{"date": "2026-06-15", "schema_version": 1}]), encoding="utf-8")

    counts = renormalize.renormalize(raw.parent, output, ["sleep"], since_version=CURRENT_SCHEMA_VERSION)

    sleep = json.loads((output / "sleep.json").read_text(encoding="utf-8"))
    assert counts["sleep"] == 1
    assert sleep[0]["schema_version"] == CURRENT_SCHEMA_VERSION
    assert sleep[0]["total_sleep_seconds"] == 3600
