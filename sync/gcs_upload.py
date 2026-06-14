from __future__ import annotations

"""Upload normalized sync output to Google Cloud Storage."""

from pathlib import Path

from google.cloud import storage

NORMALIZED_TOP_LEVEL_FILES = {
    "activities.json",
    "body_battery.json",
    "coach_context_14d.json",
    "daily.json",
    "hrv.json",
    "latest_sync_status.json",
    "manifest.json",
    "sleep.json",
    "stress.json",
}


def upload_file_to_gcs(local_path: Path, bucket: str, object_name: str) -> None:
    client = storage.Client()
    blob = client.bucket(bucket).blob(object_name)
    blob.upload_from_filename(str(local_path), content_type="application/json")


def upload_directory_to_gcs(
    local_dir: Path,
    bucket: str,
    prefix: str = "latest",
    *,
    dry_run: bool = False,
) -> list[tuple[Path, str]]:
    # Dry-run mode validates path mapping without requiring local GCP credentials.
    if not bucket and not dry_run:
        raise ValueError("GCS_BUCKET is required for upload.")

    mappings = json_upload_mappings(local_dir, prefix)
    if dry_run:
        for local_path, object_name in mappings:
            target_bucket = bucket or "<GCS_BUCKET>"
            print(f"DRY RUN upload {local_path} -> gs://{target_bucket}/{object_name}")
        return mappings

    for local_path, object_name in mappings:
        upload_file_to_gcs(local_path, bucket, object_name)
    return mappings


def json_upload_mappings(local_dir: Path, prefix: str = "latest") -> list[tuple[Path, str]]:
    # Only upload normalized JSON outputs; secrets, logs, sessions, and raw payloads stay out.
    clean_prefix = prefix.strip("/")
    mappings: list[tuple[Path, str]] = []
    for path in sorted(local_dir.rglob("*.json")):
        if not _is_normalized_output(local_dir, path):
            continue
        relative = path.relative_to(local_dir).as_posix()
        object_name = f"{clean_prefix}/{relative}" if clean_prefix else relative
        mappings.append((path, object_name))
    return mappings


def _is_normalized_output(local_dir: Path, path: Path) -> bool:
    relative = path.relative_to(local_dir)
    parts = relative.parts
    if len(parts) == 1:
        return parts[0] in NORMALIZED_TOP_LEVEL_FILES
    return len(parts) == 2 and parts[0] in {"activity_details", "activity_streams"}
