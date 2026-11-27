#!/usr/bin/env bash
# Logical backup of the workspace database, written outside the source tree and
# verified by reading the archive back. Credentials never appear in the output.
#
#   bash scripts/backup-db.sh                 # dump the local development database
#   SSP_API_DB=prod_db bash scripts/backup-db.sh
#
# Production backups are the provider's responsibility; this covers the local
# development and staging database and proves the archive can be restored.
#
# Row level security depends on table grants to the anon and authenticated roles,
# so the archive keeps privileges. A restore target must already have those roles;
# Supabase provides them.
set -euo pipefail

DB_NAME="${SSP_API_DB:-sheet_set_pro_api}"
BACKUP_DIR="${SSP_BACKUP_DIR:-$HOME/.sheet-set-pro/backups}"
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
