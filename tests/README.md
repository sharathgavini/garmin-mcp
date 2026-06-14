# Python Tests

This directory contains Python tests for sync and normalization code.

## Coverage

- Garmin session encryption and restore helpers.
- Latest sync output writing.
- Historical backfill chunking, checkpoints, raw output, and stream output.
- GCS upload path mapping and error behavior.
- Activity stream normalization.
- Normalizers and coach context generation.

## Run

```bash
.venv/bin/python -m pytest tests
```
