from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sync.main import run_sync


def main() -> None:
    parser = argparse.ArgumentParser(description="Compatibility wrapper for python -m sync.main.")
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--out", "--output", dest="output", type=Path, default=Path("sync-output"))
    parser.add_argument("--upload-bucket", default=os.environ.get("GCS_BUCKET"))
    parser.add_argument("--force-login", action="store_true")
    parser.add_argument("--session-file", type=Path, default=Path(".garmin-session.enc"))
    args = parser.parse_args()
    run_sync(
        days=args.days,
        output=args.output,
        upload_bucket=args.upload_bucket,
        force_login=args.force_login,
        session_file=args.session_file,
    )


if __name__ == "__main__":
    main()
