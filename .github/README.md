# GitHub Automation

This directory contains GitHub-specific automation.

## Workflows

Workflow files live in `.github/workflows/`.

They are used for sync paths such as:

- scheduled Garmin sync
- GCS upload

Prefer Workload Identity Federation for Google Cloud authentication when hardening beyond the v1 setup.

Server deployment is currently manual to TrueNAS, not GitHub Actions.
