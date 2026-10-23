#!/usr/bin/env bash
# Idempotent repository bootstrap for x-locale (Cloud Agent environment).
# Installs uv (Python 3.14), backend + CLI deps, frontend deps, and native
# PostgreSQL 16. Safe to run repeatedly; it does not rewrite lockfiles.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Login shells skip ~/.bashrc when non-interactive, so put uv on the default PATH.
export PATH="/usr/local/bin:${HOME}/.local/bin:${PATH}"
if ! command -v uv >/dev/null 2>&1; then
  echo "Installing uv..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi
if [[ -x "${HOME}/.local/bin/uv" ]]; then
  sudo ln -sfn "${HOME}/.local/bin/uv" /usr/local/bin/uv
fi
if [[ -x "${HOME}/.local/bin/uvx" ]]; then
  sudo ln -sfn "${HOME}/.local/bin/uvx" /usr/local/bin/uvx
fi
hash -r
uv --version

# Root .env is shared by the backend and Vite (envDir = repo root).
# Dev bypass mints a Dev User only when OIDC client credentials are unset.
if [[ ! -f .env ]]; then
  echo "Creating .env from .env.example (AUTH_DEV_BYPASS=true)..."
  cp .env.example .env
  sed -i 's/^AUTH_DEV_BYPASS=false/AUTH_DEV_BYPASS=true/' .env
fi

# The default Cloud Agent image has no Docker. Native Postgres matches the
# README's local cluster (libc collation C) and avoids nested containers.
echo "Installing PostgreSQL 16..."
# shellcheck source=postgres.sh
source "${REPO_ROOT}/.cursor/postgres.sh"
install_postgres_packages
ensure_c_locale_cluster
ensure_xlocale_role_and_databases

echo "Installing backend + CLI Python dependencies..."
uv sync --all-extras --project backend
uv sync --extra dev --project cli

echo "Installing frontend dependencies..."
npm ci --prefix frontend

echo "install.sh complete."
