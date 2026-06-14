from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sync.main import run_sync


def main() -> None:
    load_dotenv()
    parser = argparse.ArgumentParser(description="Compatibility wrapper for python -m sync.main.")
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--out", "--output", dest="output", type=Path, default=Path("sync-output"))
    parser.add_argument("--upload-bucket", default=os.environ.get("GCS_BUCKET"))
    parser.add_argument("--upload-gcs", action="store_true")
    parser.add_argument("--gcs-prefix", default=os.environ.get("GCS_PREFIX", "latest"))
    parser.add_argument("--dry-run-upload", action="store_true")
    parser.add_argument("--force-login", action="store_true")
    parser.add_argument("--session-file", type=Path, default=Path(".garmin-session.enc"))
    args = parser.parse_args()
    run_sync(
        days=args.days,
        output=args.output,
        upload_bucket=args.upload_bucket,
        upload_gcs=args.upload_gcs,
        gcs_prefix=args.gcs_prefix,
        dry_run_upload=args.dry_run_upload,
        force_login=args.force_login,
        session_file=args.session_file,
    )


if __name__ == "__main__":
    main()
