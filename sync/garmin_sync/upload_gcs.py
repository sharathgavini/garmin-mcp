from __future__ import annotations

from pathlib import Path

from sync.gcs_upload import upload_directory_to_gcs


def upload_directory(bucket_name: str, source_dir: Path, prefix: str = "latest") -> None:
    upload_directory_to_gcs(source_dir, bucket_name, prefix)
