#!/usr/bin/env bash
# Install TMS CLI so `tms` is on PATH (macOS / Linux).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI_DIR="$ROOT/cli"

if ! command -v python3 &>/dev/null; then
  echo "Python 3 not found. Install Python 3.10+ first." >&2
  exit 1
fi

if command -v pipx &>/dev/null; then
  echo "Installing tms-cli with pipx..."
  pipx install -e "$CLI_DIR" --force
else
  echo "Installing tms-cli with pip (consider: brew install pipx)..."
  python3 -m pip install -e "$CLI_DIR"
fi

echo "CLI ready. Try: tms --help"
