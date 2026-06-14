from __future__ import annotations

"""Compatibility wrapper for the shared GCS directory uploader."""

from pathlib import Path

from sync.gcs_upload import upload_directory_to_gcs


def upload_directory(bucket_name: str, source_dir: Path, prefix: str = "latest") -> None:
    upload_directory_to_gcs(source_dir, bucket_name, prefix)
