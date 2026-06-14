from __future__ import annotations

"""JSON writer helper used by sync and backfill commands."""

import json
from pathlib import Path
from typing import Any


def write_json(path: Path, data: Any) -> None:
    # All writers create parents so callers can write nested partition paths directly.
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
