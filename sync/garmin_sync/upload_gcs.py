from __future__ import annotations

from pathlib import Path

from google.cloud import storage


def upload_directory(bucket_name: str, source_dir: Path, prefix: str = "latest") -> None:
    client = storage.Client()
    bucket = client.bucket(bucket_name)
    for path in source_dir.rglob("*.json"):
        relative = path.relative_to(source_dir).as_posix()
        blob = bucket.blob(f"{prefix}/{relative}")
        blob.upload_from_filename(path, content_type="application/json")
