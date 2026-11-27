# Backup and restore

A backup nobody has restored is a guess. This runbook records how the workspace database is
backed up, how a restore is proven, and what is still missing before a release can claim the
recovery targets in SSP-01 (RPO 24 hours, RTO 8 hours — planning targets, not provider guarantees).

## What is covered today

| Scope | Covered by | Status |
|---|---|---|
| Local development and staging database (`sheet_set_pro_api`) | `scripts/backup-db.sh` | CONFIRMED — a backup and a full restore drill pass |
| Restore correctness | `scripts/restore-drill.sh` | CONFIRMED — row-level comparison, invariants and API reads |
| Hosted Supabase project | Not yet created | REQUIRES USER ACTION |
| Point-in-time recovery (RPO 24 h) | Provider plan feature | REQUIRES USER ACTION — depends on the project plan |
| Off-site copy of backups | Not configured | REQUIRES USER ACTION |

The local database is disposable by design: it is rebuilt from `supabase/migrations` plus
demonstration data. Losing it costs time, not business records. Losing a hosted project would cost
real records, which is why provider-level backup and retention must be confirmed before the first
real job is entered.

## Backup

```bash
bash scripts/backup-db.sh                      # default database, default directory
SSP_API_DB=staging_db bash scripts/backup-db.sh
SSP_BACKUP_DIR=/mnt/backups bash scripts/backup-db.sh
```

- Writes a custom-format archive named `<database>-<UTC timestamp>.dump` to
  `~/.sheet-set-pro/backups` (outside the repository, mode 700, files 600).
- Writes a `.sha256` sidecar next to it.
- Reads the archive back with `pg_restore --list` before reporting success, so a truncated or
  unreadable dump fails immediately.
- Keeps table grants. Row level security depends on the `anon` and `authenticated` roles holding
  privileges on the tables, so the archive must carry the ACLs. A restore target must already have
  those roles; Supabase provides them.

## Restore drill

```bash
bash scripts/restore-drill.sh                  # newest archive
bash scripts/restore-drill.sh path/to.dump
KEEP=1 bash scripts/restore-drill.sh           # keep the scratch database for inspection
```

The drill restores into a scratch database (`ssp_restore_drill` by default) and refuses to report
success unless every step passes:

1. The archive checksum matches its sidecar.
2. `pg_restore` completes without errors.
3. Every table in `public` has the same row count and the same content fingerprint as the live
   database (`md5` of the ordered row text per table).
4. Commercial invariants hold in the restored copy: no invoice is allocated beyond its total, no
   payment is allocated beyond its amount, and every issued or accepted document carries a
   fingerprint.
5. The restored copy is served through PostgREST: the owner can read invoices and allocations, and
   an anonymous request is refused (401) rather than returning rows.

The scratch database is dropped afterwards unless `KEEP=1` is set.

### Last recorded result

27 November 2026, local development database, archive
`sheet_set_pro_api-20261127T092458Z.dump` (192 KB):

```
Rows: 16 tables identical, content checksums match.
Invariants: allocations bounded by payment and invoice, issued documents fingerprinted.
API: allocations readable by the owner — [{"amount_cents":344064}]
API: invoices readable by the owner — [{"number":"INV-0001","status":"issued","totals":{...}}]
API: anonymous read refused (401).
PASS
```

## Known limits

- A drill is a logical restore, not a point-in-time restore. It proves the archive is faithful; it
  does not prove the provider's recovery window.
- The drill reads the live database to build the comparison. On a disaster-recovery restore there
  is no live database to compare against, so the comparison step is skipped and only steps 1, 2, 4
  and 5 apply.
- Nothing schedules the backup. Until a scheduled job exists, running it is a manual step and the
  RPO target is not met.

## Before the first real job is entered

1. Create the hosted Supabase project and record its plan's backup retention and PITR window.
2. Run the drill against a copy of the hosted database, not only the local one.
3. Schedule `scripts/backup-db.sh` (or rely on provider backups) and store an off-site copy.
4. Record the restore time measured during a drill and compare it with the 8-hour RTO target.
