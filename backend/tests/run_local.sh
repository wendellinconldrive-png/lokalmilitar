#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
MONGO_URL="${TEST_MONGO_URL:-mongodb://127.0.0.1:27017}"
MONGO_HOST="$(python -c 'from urllib.parse import urlparse; import sys; print(urlparse(sys.argv[1]).hostname or "")' "$MONGO_URL")"

case "$MONGO_HOST" in
  localhost|127.0.0.1|::1) ;;
  *)
    printf 'Refusing non-local MongoDB host for integration tests: %s\n' "$MONGO_HOST" >&2
    exit 1
    ;;
esac

PORT="${TEST_API_PORT:-$(python -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')}"
case "$PORT" in
  ''|*[!0-9]*)
    printf 'TEST_API_PORT must be a numeric local port.\n' >&2
    exit 1
    ;;
esac

export MONGO_URL
export DB_NAME="lokalmilitar_test"
export JWT_SECRET="$(python -c 'import secrets; print(secrets.token_urlsafe(48))')"
export PUBLIC_ACCESS_MODE="true"
export REACT_APP_BACKEND_URL="http://127.0.0.1:${PORT}"

python -c 'from pymongo import MongoClient; import os; MongoClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=5000).admin.command("ping")' || {
  printf 'MongoDB local is unavailable at %s. Start a local MongoDB test service and retry.\n' "$MONGO_URL" >&2
  exit 1
}

cd "$BACKEND_DIR"
python -m uvicorn server:app --host 127.0.0.1 --port "$PORT" &
API_PID=$!
cleanup() {
  kill "$API_PID" 2>/dev/null || true
  wait "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

python - "$REACT_APP_BACKEND_URL" "$API_PID" <<'PY'
import sys
import time
import requests

base_url, api_pid = sys.argv[1], int(sys.argv[2])
for _ in range(60):
    try:
        response = requests.get(f"{base_url}/api/auth/me", timeout=1)
        if response.ok and response.json().get("id") == "public-access":
            break
    except requests.RequestException:
        pass
    try:
        import os
        os.kill(api_pid, 0)
    except OSError as error:
        raise SystemExit("Local test API stopped before becoming ready") from error
    time.sleep(0.5)
else:
    raise SystemExit("Timed out waiting for local test API")
PY

python -m pytest -n 0 tests/test_google_calendar.py tests/test_lokal_api.py tests/test_lokal_edge.py
