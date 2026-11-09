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

# Older cloud images ran pg_createcluster --locale=C. README, Compose, and CI
# create the app databases with no LC_COLLATE / LC_CTYPE, so they inherit the
# cluster. Replace a leftover C/POSIX cluster once. initdb then uses this
# process's locale, the same as a fresh Debian/Ubuntu cluster.
replace_legacy_c_cluster() {
  start_postgres_cluster
  local collate ctype collation
  collation="$(sudo -u postgres psql -d template1 -Atqc "SELECT datcollate || '|' || datctype FROM pg_database WHERE datname = 'template1'")"
  IFS='|' read -r collate ctype <<<"$collation"
  if [[ "$collate" != "C" && "$collate" != "POSIX" && "$ctype" != "C" && "$ctype" != "POSIX" ]]; then
    return 0
  fi

  local system_locale="${LC_ALL:-${LANG:-}}"
  if [[ -z "$system_locale" || "$system_locale" == "C" || "$system_locale" == "POSIX" ]]; then
    echo "Postgres collation is ${collate}/${ctype}; system locale is ${system_locale:-unset}, so the cluster is left as-is" >&2
    return 0
  fi

  echo "Replacing Postgres 16 main (collation ${collate}/${ctype}) with system locale ${system_locale}"
  sudo pg_dropcluster --stop 16 main
  sudo LC_ALL="$system_locale" LANG="$system_locale" pg_createcluster 16 main
  start_postgres_cluster

  collation="$(sudo -u postgres psql -d template1 -Atqc "SELECT datcollate || '|' || datctype FROM pg_database WHERE datname = 'template1'")"
  IFS='|' read -r collate ctype <<<"$collation"
  if [[ "$collate" == "C" || "$collate" == "POSIX" || "$ctype" == "C" || "$ctype" == "POSIX" ]]; then
    echo "Postgres collation is still ${collate}/${ctype} after recreating the cluster" >&2
    return 1
  fi
  echo "Postgres template1 collation is now ${collate}/${ctype}"
}

install_postgres_packages() {
  if dpkg -s postgresql-16 >/dev/null 2>&1 && command -v pg_isready >/dev/null 2>&1; then
    return 0
  fi
  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql-16 postgresql-client-16
}

ensure_xlocale_role_and_databases() {
  replace_legacy_c_cluster

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
      sudo -u postgres createdb -O xlocale -T template0 "$db"
    fi
  done

  PGPASSWORD=xlocale psql -h 127.0.0.1 -U xlocale -d xlocale -Atqc "SELECT 1" >/dev/null
}
