#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_URL="http://localhost:8000"
FRONTEND_URL="http://localhost:5173"

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

echo "==> Preparing backend (migrate + seed)..."
(
  cd "$ROOT/backend"
  uv run alembic upgrade head
  uv run python -m app.cli seed-demo
)

echo "==> Starting backend ($BACKEND_URL)..."
(
  cd "$ROOT/backend"
  uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
) &
BACKEND_PID=$!

echo "==> Waiting for backend..."
for _ in $(seq 1 60); do
  if curl -sf "$BACKEND_URL/health" >/dev/null 2>&1; then
  break
  fi
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "Backend exited before becoming healthy."
    exit 1
  fi
  sleep 1
done

if ! curl -sf "$BACKEND_URL/health" >/dev/null 2>&1; then
  echo "Backend did not become healthy within 60s."
  exit 1
fi

echo "==> Starting frontend ($FRONTEND_URL)..."
(
  cd "$ROOT/frontend"
  npm run dev
) &
FRONTEND_PID=$!

echo ""
echo "TMS dev stack is running:"
echo "  Dashboard: $FRONTEND_URL"
echo "  API docs:  $BACKEND_URL/docs"
echo "Press Ctrl+C to stop both services."
echo ""

wait -n "$BACKEND_PID" "$FRONTEND_PID"
exit $?
