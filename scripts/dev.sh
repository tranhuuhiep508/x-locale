#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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
  if curl -sf --connect-timeout 1 --max-time 2 "$BACKEND_URL/healthcheck/readliness" >/dev/null 2>&1; then
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
echo "  Readiness: $BACKEND_URL/healthcheck/readliness"
echo "Press Ctrl+C to stop both services."
echo ""

wait -n "$BACKEND_PID" "$FRONTEND_PID"
exit $?
