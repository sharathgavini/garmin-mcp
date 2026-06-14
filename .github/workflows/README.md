# GitHub Workflows

This directory contains GitHub Actions workflow definitions.

## Notes

- Keep Garmin credentials and Google auth material in GitHub secrets.
- Do not print secrets in logs.
- Sync workflows should write normalized JSON, raw payloads where intended, manifests, and sync status.
- Deployment workflows should not run before local and GCS validation pass.
