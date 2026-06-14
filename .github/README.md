# GitHub Automation

This directory contains GitHub-specific automation.

## Workflows

Workflow files live in `.github/workflows/`.

They are used for sync and deployment paths such as:

- scheduled Garmin sync
- GCS upload
- Cloud Run deployment

Prefer Workload Identity Federation for Google Cloud authentication when hardening beyond the v1 setup.
