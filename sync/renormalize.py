from __future__ import annotations

"""Rebuild normalized JSON datasets from already-preserved raw payloads."""

import argparse
import json
from pathlib import Path
from typing import Any, Callable

from .garmin_sync.normalizers import normalize_hrv, normalize_sleep
from .garmin_sync.write_json import write_json

Normalizer = Callable[[dict[str, Any], str, str | None], dict[str, Any]]

DATASET_NORMALIZERS: dict[str, Normalizer] = {
    "sleep": normalize_sleep,
    "hrv": normalize_hrv,
}


def renormalize(input_dir: Path, output_dir: Path, datasets: list[str], since_version: int | None = None) -> dict[str, int]:
    # Return counts so CLI users and tests can verify what was rebuilt.
    counts: dict[str, int] = {}
    for dataset in datasets:
        if dataset not in DATASET_NORMALIZERS:
            raise ValueError(f"Unsupported dataset for renormalize: {dataset}")
        counts[dataset] = renormalize_dataset(input_dir, output_dir, dataset, DATASET_NORMALIZERS[dataset], since_version=since_version)
    if since_version is not None and any(counts.values()):
        try:
            from .archive_maintenance import mark_rollups_stale

            mark_rollups_stale(output_dir)
        except Exception:
            pass
    return counts


def renormalize_dataset(input_dir: Path, output_dir: Path, dataset: str, normalizer: Normalizer, since_version: int | None = None) -> int:
    # Archive raw files are partitioned; latest raw files are top-level per dataset.
    partition_files = sorted((input_dir / dataset).glob(f"year=*/month=*/{dataset}.json"))
    if partition_files:
        total = 0
        for raw_file in partition_files:
            relative = raw_file.relative_to(input_dir)
            existing_path = output_dir / relative
            rows, changed = normalize_raw_file(raw_file, normalizer, existing_path=existing_path, since_version=since_version)
            write_json(output_dir / relative, rows)
            total += changed
        return total

    raw_file = input_dir / dataset / f"{dataset}.json"
    output_file = output_dir / f"{dataset}.json"
    rows, changed = normalize_raw_file(raw_file, normalizer, existing_path=output_file, since_version=since_version)
    write_json(output_dir / f"{dataset}.json", rows)
    return changed


def normalize_raw_file(raw_file: Path, normalizer: Normalizer, *, existing_path: Path | None = None, since_version: int | None = None) -> tuple[list[dict[str, Any]], int]:
    # Raw files may hold either a list of wrapped rows or a single raw payload.
    if not raw_file.exists():
        return [], 0
    existing = existing_by_date(existing_path) if existing_path and since_version is not None else {}
    raw_rows = json.loads(raw_file.read_text(encoding="utf-8"))
    if not isinstance(raw_rows, list):
        raw_rows = [raw_rows]
    normalized = []
    changed = 0
    for index, row in enumerate(raw_rows):
        date, payload = unwrap_raw_row(row, fallback_date=f"unknown-{index}")
        current = existing.get(date)
        if since_version is not None and current and int(current.get("schema_version", 0) or 0) >= since_version:
            normalized.append(current)
            continue
        normalized.append(normalizer(payload, date, raw_payload_path=str(raw_file)))
        changed += 1
    return sorted(normalized, key=lambda item: str(item.get("date", ""))), changed


def existing_by_date(path: Path | None) -> dict[str, dict[str, Any]]:
    if not path or not path.exists():
        return {}
    try:
        rows = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if not isinstance(rows, list):
        return {}
    return {str(row.get("date")): row for row in rows if isinstance(row, dict) and row.get("date")}


def unwrap_raw_row(row: Any, *, fallback_date: str) -> tuple[str, dict[str, Any]]:
    # Sync/backfill raw rows use {"date", "payload"} wrappers; direct payloads are also accepted.
    if isinstance(row, dict) and "payload" in row:
        payload = row.get("payload")
        date = str(row.get("date") or infer_date(payload) or fallback_date)
        return date, payload if isinstance(payload, dict) else {}
    if isinstance(row, dict):
        return str(infer_date(row) or fallback_date), row
    return fallback_date, {}


def infer_date(payload: Any) -> str | None:
    # Sleep payloads can infer dates from their local/GMT sleep timestamps.
    if not isinstance(payload, dict):
        return None
    daily_sleep = payload.get("dailySleepDTO") if isinstance(payload.get("dailySleepDTO"), dict) else {}
    for source in [payload, daily_sleep]:
        for key in ["calendarDate", "sleepStartTimestampLocal", "sleepStartTimestampGMT", "date"]:
            value = source.get(key)
            if isinstance(value, str) and len(value) >= 10:
                return value[:10]
    return None


def parse_datasets(value: str) -> list[str]:
    # Keep CLI parsing simple while allowing comma-separated dataset names.
    return [item.strip() for item in value.split(",") if item.strip()]


def main() -> None:
    parser = argparse.ArgumentParser(description="Rebuild normalized sleep/HRV JSON from preserved raw Garmin payloads.")
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--datasets", required=True, help="Comma-separated datasets, e.g. sleep,hrv")
    parser.add_argument("--since-version", type=int)
    args = parser.parse_args()
    counts = renormalize(args.input, args.output, parse_datasets(args.datasets), since_version=args.since_version)
    print(json.dumps(counts, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
