#!/usr/bin/env bash
# Idempotent repository bootstrap for x-locale (Cloud Agent environment).
# Installs uv (which provisions the pinned Python), backend + CLI deps, and
# frontend deps. Safe to run repeatedly; it converges without rewriting lockfiles.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# uv installs to ~/.local/bin; make it available in this shell and future ones.
export PATH="$HOME/.local/bin:$PATH"
if ! command -v uv >/dev/null 2>&1; then
  echo "Installing uv..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi
if ! grep -q '.local/bin' "$HOME/.bashrc" 2>/dev/null; then
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
fi
uv --version

# Root .env is shared by backend and Vite (envDir = repo root).
# Enable AUTH_DEV_BYPASS so agents get a Dev User without configuring OIDC.
if [ ! -f .env ]; then
  echo "Creating .env from .env.example (AUTH_DEV_BYPASS=true)..."
  cp .env.example .env
  sed -i 's/^AUTH_DEV_BYPASS=false/AUTH_DEV_BYPASS=true/' .env
fi

echo "Installing backend + CLI Python dependencies..."
uv sync --all-extras --project backend
uv sync --project cli

echo "Installing frontend dependencies..."
cd "$REPO_ROOT/frontend"
npm install

echo "install.sh complete."
