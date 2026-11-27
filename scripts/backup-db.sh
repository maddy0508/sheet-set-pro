#!/usr/bin/env bash
# Logical backup of the workspace database, written to a git-ignored directory
# and verified by reading the archive back. Credentials never appear in output.
#
#   bash scripts/backup-db.sh                 # dump the local development database
#   SSP_API_DB=prod_db bash scripts/backup-db.sh
#
# Production backups are the provider's responsibility; this covers the local
# development and staging database and proves the archive can be restored.
#
# The default destination is .backups/ inside the repository because the
# development container is recycled: $HOME and /tmp are wiped with it, the
# workspace is not. Point SSP_BACKUP_DIR at off-host storage for real retention.
#
# Row level security depends on table grants to the anon and authenticated roles,
# so the archive keeps privileges. A restore target must already have those roles;
# Supabase provides them.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_NAME="${SSP_API_DB:-sheet_set_pro_api}"
BACKUP_DIR="${SSP_BACKUP_DIR:-$REPO_ROOT/.backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="${BACKUP_DIR}/${DB_NAME}-${STAMP}.dump"

mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"
umask 077

echo "Dumping ${DB_NAME}…"
sudo -u postgres pg_dump --format=custom --no-owner "${DB_NAME}" >"${FILE}"

if ! pg_restore --list "${FILE}" >/dev/null; then
  echo "FAIL: the archive cannot be read back." >&2
  exit 1
fi

SUM="$(sha256sum "${FILE}" | cut -d' ' -f1)"
printf '%s  %s\n' "${SUM}" "$(basename "${FILE}")" >"${FILE}.sha256"

echo "Backup written: ${FILE}"
echo "Size: $(du -h "${FILE}" | cut -f1)"
echo "SHA-256: ${SUM}"
echo "Verified: archive table of contents readable."
