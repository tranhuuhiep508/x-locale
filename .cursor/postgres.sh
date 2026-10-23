# Shared PostgreSQL 16 helpers for the Cloud Agent install and start scripts.
# Source this file; do not execute it.

wait_for_postgres() {
  local attempt
  for attempt in $(seq 1 30); do
    if pg_isready -h 127.0.0.1 -p 5432 -q; then
      return 0
    fi
    sleep 1
  done
  echo "Postgres did not become ready on 127.0.0.1:5432" >&2
  return 1
}

start_postgres_cluster() {
  if pg_isready -h 127.0.0.1 -p 5432 -q; then
    return 0
  fi

  local pidfile="/var/lib/postgresql/16/main/postmaster.pid"
  if sudo test -f "$pidfile"; then
    local pid
    pid="$(sudo head -n 1 "$pidfile" || true)"
    if [[ -n "${pid}" ]] && ! sudo kill -0 "$pid" 2>/dev/null; then
      echo "Removing stale Postgres pid file"
      sudo rm -f "$pidfile"
    fi
  fi

  sudo pg_ctlcluster 16 main start
  wait_for_postgres
}

install_postgres_packages() {
  if dpkg -s postgresql-16 >/dev/null 2>&1 && command -v pg_isready >/dev/null 2>&1; then
    return 0
  fi
  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql-16 postgresql-client-16
}

# Recreate the default cluster when apt initialized it with a non-C locale.
# The app and pytest both require libc collation C.
ensure_c_locale_cluster() {
  start_postgres_cluster
  local collation
  collation="$(sudo -u postgres psql -d template1 -Atqc "SELECT datcollate || '|' || datlocprovider::text FROM pg_database WHERE datname = 'template1'")"
  echo "template1 collation=${collation}"
  if [[ "$collation" == "C|c" ]]; then
    return 0
  fi

  echo "Recreating the Postgres 16 main cluster with locale C"
  sudo pg_dropcluster --stop 16 main
  sudo pg_createcluster 16 main --locale=C --encoding=UTF8
  start_postgres_cluster
  collation="$(sudo -u postgres psql -d template1 -Atqc "SELECT datcollate || '|' || datlocprovider::text FROM pg_database WHERE datname = 'template1'")"
  if [[ "$collation" != "C|c" ]]; then
    echo "template1 collation is ${collation}, expected C|c" >&2
    return 1
  fi
}

ensure_xlocale_role_and_databases() {
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'xlocale') THEN
    CREATE ROLE xlocale LOGIN PASSWORD 'xlocale' CREATEDB;
  ELSE
    ALTER ROLE xlocale WITH LOGIN PASSWORD 'xlocale' CREATEDB;
  END IF;
END
$$;
SQL

  local db
  for db in xlocale xlocale_test; do
    if [[ "$(sudo -u postgres psql -d postgres -Atqc "SELECT 1 FROM pg_database WHERE datname = '${db}'")" != "1" ]]; then
      sudo -u postgres createdb -O xlocale -T template0 --locale-provider=libc --lc-collate=C --lc-ctype=C "$db"
    fi
    local collation
    collation="$(sudo -u postgres psql -d "$db" -Atqc "SELECT datcollate || '|' || datlocprovider::text FROM pg_database WHERE datname = current_database()")"
    if [[ "$collation" != "C|c" ]]; then
      echo "${db} collation is ${collation}, expected C|c" >&2
      return 1
    fi
  done

  PGPASSWORD=xlocale psql -h 127.0.0.1 -U xlocale -d xlocale -Atqc "SELECT 1" >/dev/null
}
