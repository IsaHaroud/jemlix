#!/usr/bin/env bash
set -euo pipefail

app_dir="${JEMLA_APP_DIR:-/opt/jemla}"
backup_dir="${JEMLA_BACKUP_DIR:-/var/backups/jemla}"
database="${app_dir}/data/jemla.db"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
temporary="${backup_dir}/.jemla-${stamp}.db"
archive="${backup_dir}/jemla-${stamp}.db.gz"

umask 077
install -d -m 0700 "${backup_dir}"

if [[ ! -f "${database}" ]]; then
  echo "Jemlix database not found: ${database}" >&2
  exit 1
fi

cleanup() {
  rm -f "${temporary}"
}
trap cleanup EXIT

# SQLite's online backup command produces a consistent copy while Jemlix runs.
sqlite3 "${database}" ".timeout 5000" ".backup '${temporary}'"
gzip -c "${temporary}" > "${archive}"

# Keep two weeks locally. Hetzner Backups and an off-server media copy are still required.
find "${backup_dir}" -maxdepth 1 -type f -name 'jemla-*.db.gz' -mtime +14 -delete
echo "Created ${archive}"
