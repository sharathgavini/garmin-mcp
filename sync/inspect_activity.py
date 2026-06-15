from __future__ import annotations

"""Inspect one Garmin activity and save debug payloads/inventories."""

import argparse
import json
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

from .activity_streams import (
    client_method_inventory,
    extract_column_samples,
    extract_row_samples,
    fetch_activity_payloads,
    normalize_activity_stream,
)
from .garmin_sync.normalizers import normalize_activity_detail
from .garmin_sync.write_json import write_json
from .session_manager import DEFAULT_SESSION_FILE, login_or_restore


RAW_FILE_NAMES = {
    "activity": "raw_activity.json",
    "activity_details": "raw_activity_details.json",
    "activity_detail": "raw_activity_detail.json",
    "activity_streams": "raw_activity_streams.json",
    "activity_stream": "raw_activity_stream.json",
    "activity_splits": "raw_activity_splits.json",
    "activity_laps": "raw_activity_laps.json",
    "activity_graphs": "raw_activity_graphs.json",
    "activity_graph": "raw_activity_graph.json",
    "activity_typed_splits": "raw_activity_typed_splits.json",
    "activity_weather": "raw_activity_weather.json",
    "activity_polyline": "raw_activity_polyline.json",
}


def inspect_activity(activity_id: str, output: Path, *, session_file: Path = DEFAULT_SESSION_FILE, client: Any | None = None) -> Path:
    # Inspector output is deliberately verbose; it is for debugging Garmin payloads.
    garmin = client or login_or_restore(session_file=session_file)
    debug_dir = output / f"activity_{activity_id}"
    debug_dir.mkdir(parents=True, exist_ok=True)

    method_inventory = client_method_inventory(garmin)
    write_json(debug_dir / "client_method_inventory.json", method_inventory)
    (debug_dir / "client_method_inventory.txt").write_text(
        "\n".join(item["name"] for item in method_inventory) + "\n",
        encoding="utf-8",
    )

    payloads = fetch_activity_payloads(garmin, activity_id)
    # Persist every wrapped endpoint response so a future normalizer can be built from it.
    for key, wrapped in payloads.items():
        write_json(debug_dir / RAW_FILE_NAMES.get(key, f"raw_{key}.json"), wrapped)

    key_inventory = nested_key_inventory(payloads)
    write_json(debug_dir / "key_inventory.json", key_inventory)
    (debug_dir / "key_inventory.txt").write_text(format_key_inventory(key_inventory), encoding="utf-8")

    stream = normalize_activity_stream(activity_id, payloads)
    stream_inventory = {
        "activity_id": activity_id,
        "sample_count": stream["sample_count"],
        "fields": stream["fields"],
        "availability": stream["availability"],
        "checked_payloads": stream["checked_payloads"],
        "row_sample_candidates": sum(len(extract_row_samples(endpoint_payload(item))) for item in payloads.values()),
        "column_sample_candidates": sum(len(extract_column_samples(endpoint_payload(item))) for item in payloads.values()),
    }
    write_json(debug_dir / "stream_inventory.json", stream_inventory)

    detail_payload = endpoint_payload(payloads.get("activity")) or endpoint_payload(payloads.get("activity_details")) or {}
    detail = normalize_activity_detail(detail_payload if isinstance(detail_payload, dict) else {}, fallback={"id": activity_id})
    summary = {
        "activity_id": activity_id,
        "debug_dir": str(debug_dir),
        "payloads_checked": stream["checked_payloads"],
        "method_inventory_count": len(method_inventory),
        "stream_inventory": stream_inventory,
        "normalized_detail": detail,
    }
    write_json(debug_dir / "summary.json", summary)
    return debug_dir


def endpoint_payload(value: Any) -> Any:
    # Match sync.activity_streams.endpoint_payload without importing a private helper.
    if isinstance(value, dict) and "payload" in value and ("method" in value or "available" in value):
        return value.get("payload")
    return value


def nested_key_inventory(value: Any, path: str = "$") -> list[dict[str, Any]]:
    # Limit list traversal to the first ten items to avoid giant debug text files.
    rows: list[dict[str, Any]] = []
    if isinstance(value, dict):
        rows.append({"path": path, "type": "dict", "keys": sorted(str(key) for key in value.keys())})
        for key, item in value.items():
            rows.extend(nested_key_inventory(item, f"{path}.{key}"))
    elif isinstance(value, list):
        rows.append({"path": path, "type": "list", "length": len(value)})
        for index, item in enumerate(value[:10]):
            rows.extend(nested_key_inventory(item, f"{path}[{index}]"))
    else:
        rows.append({"path": path, "type": type(value).__name__})
    return rows


def format_key_inventory(rows: list[dict[str, Any]]) -> str:
    # Text format is easier to skim than JSON when exploring unknown payloads.
    lines = []
    for row in rows:
        line = f"{row['path']} ({row['type']})"
        if "keys" in row:
            line += f": {', '.join(row['keys'])}"
        if "length" in row:
            line += f": length={row['length']}"
        lines.append(line)
    return "\n".join(lines) + "\n"


def main() -> None:
    load_dotenv()
    parser = argparse.ArgumentParser(description="Inspect raw Garmin payloads and stream availability for one activity.")
    parser.add_argument("--activity-id", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--session-file", type=Path, default=DEFAULT_SESSION_FILE)
    args = parser.parse_args()
    debug_dir = inspect_activity(args.activity_id, args.output, session_file=args.session_file)
    print(debug_dir)


if __name__ == "__main__":
    main()
