#!/usr/bin/env bash
# Per-boot services for the Cloud Agent environment. Idempotent: skips Postgres
# and tmux sessions that are already healthy. Does not install packages.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
export PATH="/usr/local/bin:${HOME}/.local/bin:${PATH}"

if [[ ! -f .env ]]; then
  cp .env.example .env
  sed -i 's/^AUTH_DEV_BYPASS=false/AUTH_DEV_BYPASS=true/' .env
fi

# shellcheck source=postgres.sh
source "${REPO_ROOT}/.cursor/postgres.sh"
start_postgres_cluster
ensure_xlocale_role_and_databases

echo "Applying migrations and seeding the Demo App..."
"${REPO_ROOT}/.cursor/with-project-env.sh" bash -c "cd '${REPO_ROOT}/backend' && uv run alembic upgrade head && uv run python -m app.cli seed-demo"

port_listening() {
  # iproute2 (ss) is not in the default image. Bash /dev/tcp needs no extra packages.
  (echo >/dev/tcp/127.0.0.1/"$1") >/dev/null 2>&1
}

ensure_tmux() {
  local name=$1
  local dir=$2
  local port=$3
  local cmd=$4
  if tmux has-session -t "$name" 2>/dev/null; then
    if port_listening "$port"; then
      echo "${name} already listening on ${port}"
      return 0
    fi
    echo "Restarting ${name}; session exists but port ${port} is closed"
    tmux kill-session -t "$name" || true
  fi
  tmux new-session -d -s "$name" -c "$dir" "$cmd"
}

wait_http() {
  local url=$1
  local logfile=$2
  local attempt
  for attempt in $(seq 1 60); do
    if curl -sf --connect-timeout 1 --max-time 2 "$url" >/dev/null; then
      echo "Ready: ${url}"
      return 0
    fi
    sleep 1
  done
  echo "Timed out waiting for ${url}" >&2
  if [[ -f "$logfile" ]]; then
    tail -n 80 "$logfile" >&2 || true
  fi
  return 1
}

ensure_tmux backend "${REPO_ROOT}/backend" 8000 \
  "bash -lc '${REPO_ROOT}/.cursor/with-project-env.sh uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload > /tmp/xlocale-backend.log 2>&1'"
wait_http "http://127.0.0.1:8000/healthcheck/readiness" /tmp/xlocale-backend.log

ensure_tmux frontend "${REPO_ROOT}/frontend" 5173 \
  "bash -lc 'npm run dev -- --host 0.0.0.0 --port 5173 > /tmp/xlocale-frontend.log 2>&1'"
wait_http "http://127.0.0.1:5173/" /tmp/xlocale-frontend.log

echo "x-locale is up (backend :8000, frontend :5173)."
