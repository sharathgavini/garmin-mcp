import base64

from sync.session_manager import load_session


# Session restore should fail gracefully so sync can fall back to login.
def test_load_session_missing_file_returns_none(monkeypatch, tmp_path):
    monkeypatch.setenv("GARMIN_SESSION_KEY", base64.b64encode(b"1" * 32).decode("ascii"))

    assert load_session(tmp_path / "missing.enc") is None


def test_load_session_corrupted_file_returns_none(monkeypatch, tmp_path):
    monkeypatch.setenv("GARMIN_SESSION_KEY", base64.b64encode(b"1" * 32).decode("ascii"))
    path = tmp_path / "session.enc"
    path.write_text("not-json", encoding="utf-8")

    assert load_session(path) is None
