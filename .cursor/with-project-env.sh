#!/usr/bin/env bash
# Run a command with the repo .env database settings.
# Pydantic prefers process environment over .env. A non-Postgres DATABASE_URL
# would hide the project file, so drop those values before exec.
set -euo pipefail

case "${DATABASE_URL:-}" in
  postgres://* | postgresql://* | postgresql+* | postgres+*) ;;
  *) unset DATABASE_URL ;;
esac
case "${TEST_DATABASE_URL:-}" in
  postgres://* | postgresql://* | postgresql+* | postgres+*) ;;
  *) unset TEST_DATABASE_URL ;;
esac

exec "$@"
