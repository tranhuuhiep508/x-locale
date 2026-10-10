#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Read DATABASE_URL and TEST_DATABASE_URL from the repo .env. .env.example keeps
# AUTH_DEV_BYPASS=false so a copied file is not a bypass. This script turns the
# bypass on only for the processes it starts, after the file is read.
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi
export AUTH_DEV_BYPASS=true

BACKEND_PORT=8000
FRONTEND_PORT=5173
BACKEND_URL="http://localhost:${BACKEND_PORT}"
FRONTEND_URL="http://localhost:${FRONTEND_PORT}"

kill_port() {
  local port=$1
  local pids=""

  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -ti:"$port" 2>/dev/null || true)"
  elif command -v fuser >/dev/null 2>&1; then
    pids="$(fuser "${port}/tcp" 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+$' || true)"
  else
    echo "Cannot free port $port: install lsof or fuser."
    return 1
  fi

  if [[ -z "$pids" ]]; then
    return 0
  fi

  echo "==> Killing process(es) on port $port: $pids"
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  sleep 1

  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -ti:"$port" 2>/dev/null || true)"
  else
    pids="$(fuser "${port}/tcp" 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+$' || true)"
  fi

  if [[ -n "$pids" ]]; then
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
  fi
}

cleanup() {
  trap - INT TERM
  if [[ -n "${BACKEND_PID:-}" ]]; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
  if [[ -n "${FRONTEND_PID:-}" ]]; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
}

trap cleanup INT TERM EXIT

echo "==> Freeing dev ports..."
kill_port "$BACKEND_PORT"
kill_port "$FRONTEND_PORT"

echo "==> Ensuring Postgres is up..."
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  docker compose -f "$ROOT/docker-compose.yml" up -d postgres
  ready=false
  for _ in $(seq 1 30); do
    if docker compose -f "$ROOT/docker-compose.yml" exec -T postgres pg_isready -U xlocale -d xlocale >/dev/null 2>&1; then
      ready=true
      break
    fi
    sleep 1
  done
  if [[ "$ready" != true ]]; then
    echo "Postgres did not become ready. See README for a native Postgres setup."
    exit 1
  fi
else
  echo "Docker Compose is not available. Expecting a native Postgres server (see README)."
fi

echo "==> Creating the test database if it is missing (template0, libc collation C)..."
(
  cd "$ROOT/backend"
  uv run python -m app.postgres_admin create \
    "${TEST_DATABASE_URL:-postgresql+psycopg://xlocale:xlocale@localhost:5432/xlocale_test}"
)

echo "==> Preparing backend (migrate + seed)..."
(
  cd "$ROOT/backend"
  uv run alembic upgrade head
  uv run python -m app.cli seed-demo
)

echo "==> Starting backend ($BACKEND_URL)..."
(
  cd "$ROOT/backend"
  uv run uvicorn app.main:app --host 0.0.0.0 --port "$BACKEND_PORT" --reload
) &
BACKEND_PID=$!

echo "==> Waiting for backend readiness..."
BACKEND_READY=false
STARTUP_DEADLINE=$((SECONDS + 60))
while (( SECONDS < STARTUP_DEADLINE )); do
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "Backend exited before becoming ready."
    exit 1
  fi
  if curl -sf --connect-timeout 1 --max-time 2 "$BACKEND_URL/healthcheck/readiness" >/dev/null 2>&1; then
    BACKEND_READY=true
    break
  fi
  sleep 1
done

if [[ "$BACKEND_READY" != true ]]; then
  echo "Backend did not become ready within 60s."
  exit 1
fi

echo "==> Starting frontend ($FRONTEND_URL)..."
(
  cd "$ROOT/frontend"
  npm run dev
) &
FRONTEND_PID=$!

echo ""
echo "x-locale dev stack is running:"
echo "  Dashboard: $FRONTEND_URL"
echo "  API docs:  $BACKEND_URL/docs"
echo "  Liveness: $BACKEND_URL/healthcheck/liveness"
echo "  Readiness: $BACKEND_URL/healthcheck/readiness"
echo "Press Ctrl+C to stop both services."
echo ""

wait -n "$BACKEND_PID" "$FRONTEND_PID"
exit $?
