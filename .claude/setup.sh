#!/usr/bin/env bash
# Setup script for the Claude cloud environment (x-locale).
# Paste into the environment's "Setup script" field as:
#   bash /home/user/x-locale/.claude/setup.sh
# or run it by hand. Idempotent. Reuses the Cursor scripts so there is one
# source of truth for installs and Postgres.
#
#   .claude/setup.sh            install deps + Postgres, migrate, seed, then
#                               start backend (:8000) and frontend (:5173)
#   .claude/setup.sh --no-start install only (skip services)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Installs uv, root .env (AUTH_DEV_BYPASS=true), native Postgres 16 (libc C),
# backend + CLI Python deps, and frontend deps (npm ci).
bash .cursor/install.sh

if [[ "${1:-}" == "--no-start" ]]; then
  echo "Skipping service start (--no-start)."
  exit 0
fi

# Start Postgres, run migrations, seed the Demo App, launch backend + frontend.
# A service failure should not fail the whole environment setup.
bash .cursor/start.sh || echo "WARNING: .cursor/start.sh failed; run it manually to retry." >&2
