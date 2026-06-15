import json
from datetime import datetime, timezone

from sync import sync_now


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
