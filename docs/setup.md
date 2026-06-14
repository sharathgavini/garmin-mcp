# Local Setup

## Server

```bash
cd server
npm install
npm test
GARMIN_DATA_MODE=local GARMIN_DATA_DIR=../sample-data MCP_BEARER_TOKEN=dev-token npm run dev
```

Call `GET http://localhost:3000/healthz` for a simple readiness check.

MCP requests go to `POST http://localhost:3000/mcp` and must include:

```text
Authorization: Bearer dev-token
```

## Sync

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r sync/requirements.txt
pytest
export GARMIN_EMAIL=...
export GARMIN_PASSWORD=...
export GARMIN_SESSION_KEY="$(python - <<'PY'
import base64, os
print(base64.b64encode(os.urandom(32)).decode())
PY
)"
python -m sync.main --days 30 --output sync-output
```

The sync code writes compact JSON files matching `sample-data/`.
It stores Garmin session tokens only in encrypted form at `.garmin-session.enc`.
Use `--force-login` if Garmin rejects a restored session and you want to bypass the cache.
