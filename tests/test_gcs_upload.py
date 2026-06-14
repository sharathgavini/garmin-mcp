import pytest

from sync import gcs_upload


def test_json_upload_mappings_include_nested_activity_details(tmp_path):
    (tmp_path / "manifest.json").write_text("{}", encoding="utf-8")
    (tmp_path / "raw_garmin_payload.json").write_text("{}", encoding="utf-8")
    details = tmp_path / "activity_details"
    details.mkdir()
    (details / "123.json").write_text("{}", encoding="utf-8")
    streams = tmp_path / "activity_streams"
    streams.mkdir()
    (streams / "123.json").write_text("{}", encoding="utf-8")

    mappings = gcs_upload.json_upload_mappings(tmp_path, "latest")

    assert [(path.name, object_name) for path, object_name in mappings] == [
        ("123.json", "latest/activity_details/123.json"),
        ("123.json", "latest/activity_streams/123.json"),
        ("manifest.json", "latest/manifest.json"),
    ]


def test_upload_directory_requires_bucket_for_real_upload(tmp_path):
    (tmp_path / "manifest.json").write_text("{}", encoding="utf-8")

    with pytest.raises(ValueError, match="GCS_BUCKET"):
        gcs_upload.upload_directory_to_gcs(tmp_path, "", "latest")


def test_dry_run_does_not_contact_gcs(monkeypatch, tmp_path, capsys):
    (tmp_path / "manifest.json").write_text("{}", encoding="utf-8")

    def fail_if_called(*args, **kwargs):
        raise AssertionError("GCS upload should not be called during dry run")

    monkeypatch.setattr(gcs_upload, "upload_file_to_gcs", fail_if_called)
    mappings = gcs_upload.upload_directory_to_gcs(tmp_path, "", "latest", dry_run=True)

    assert len(mappings) == 1
    assert "DRY RUN upload" in capsys.readouterr().out


def test_upload_directory_calls_upload_file(monkeypatch, tmp_path):
    (tmp_path / "manifest.json").write_text("{}", encoding="utf-8")
    details = tmp_path / "activity_details"
    details.mkdir()
    (details / "123.json").write_text("{}", encoding="utf-8")
    streams = tmp_path / "activity_streams"
    streams.mkdir()
    (streams / "123.json").write_text("{}", encoding="utf-8")
    calls = []

    monkeypatch.setattr(
        gcs_upload,
        "upload_file_to_gcs",
        lambda local_path, bucket, object_name: calls.append((local_path.name, bucket, object_name)),
    )

    gcs_upload.upload_directory_to_gcs(tmp_path, "bucket-name", "latest")

    assert calls == [
        ("123.json", "bucket-name", "latest/activity_details/123.json"),
        ("123.json", "bucket-name", "latest/activity_streams/123.json"),
        ("manifest.json", "bucket-name", "latest/manifest.json"),
    ]
