# GitHub Workflows

This directory contains GitHub Actions workflow definitions.

## Notes

- Keep Garmin credentials and Google auth material in GitHub secrets.
- Do not print secrets in logs.
- Sync workflows should write normalized JSON, raw payloads where intended, manifests, and sync status.
- Server deployment is manual to TrueNAS, so there is no GitHub Actions deployment workflow.
