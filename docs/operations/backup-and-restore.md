# Backup and restore

A backup nobody has restored is a guess. This runbook records how the workspace database is
backed up, how a restore is proven, and what is still missing before a release can claim the
recovery targets in SSP-01 (RPO 24 hours, RTO 8 hours — planning targets, not provider guarantees).

## What is covered today

| Scope | Covered by | Status |
|---|---|---|
| Local development and staging database (`sheet_set_pro_api`) | `scripts/backup-db.sh` | CONFIRMED — a backup and a full restore drill pass |
| Restore correctness | `scripts/restore-drill.sh` | CONFIRMED — row-level comparison, invariants and API reads |
| Hosted Supabase project | Nothing in this repository | NOT CONFIGURED — the project exists, the application is not connected to it, and no hosted backup has been taken or restored |
| Hosted backup retention and point-in-time recovery | Provider plan feature | UNABLE TO VERIFY — the plan's retention and PITR window have not been read from the project |
| Off-site copy of backups | Not configured | REQUIRES USER ACTION |
| Scheduled backup and scheduled recovery test | Not configured | REQUIRES USER ACTION |

The scripts here operate on a PostgreSQL instance you point them at. They have never been run
against the hosted Supabase project, and a local archive is not a hosted backup: it does not cover
the project's storage buckets, its auth records, its extensions or its provider-side recovery
window. Nothing in this repository protects the hosted project today.

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
  `.backups/` in the repository root (git-ignored, mode 700, files 600).
- The default is inside the workspace on purpose: the development container is recycled
  mid-session, which wipes `$HOME` and `/tmp` along with the PostgreSQL cluster. A backup kept in
  either place disappears with the thing it was meant to protect. The workspace survives, so the
  archive does. Neither location is retention: point `SSP_BACKUP_DIR` at storage outside the
  container before this protects anything real.
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
- The local backup scripts do not constitute hosted Supabase backups. Supabase storage, auth and
  the provider's own retention are outside their scope, and no archive from this repository has
  been taken from or restored into the hosted project.
- The RPO of 24 hours and RTO of 8 hours are planning targets from SSP-01. Nothing here meets
  them: no schedule runs, no hosted backup exists, and no timed recovery has been measured.
- The drill reads the live database to build the comparison. On a disaster-recovery restore there
  is no live database to compare against, so the comparison step is skipped and only steps 1, 2, 4
  and 5 apply.
- Nothing schedules the backup. Until a scheduled job exists, running it is a manual step and the
  RPO target is not met.

## Before the first real job is entered

1. Connect the application to the existing hosted Supabase project, and record from that project
   its plan, region, backup retention and PITR window. None of these is known from the repository.
2. Take a backup of the hosted database and run the drill against it — not only against the local
   database.
3. Decide who owns backup, then schedule it: either the provider's own backups with a documented
   retention, or `scripts/backup-db.sh` on a schedule, with an off-site copy that lives somewhere
   other than the machine holding the database.
4. Record the restore time measured during a drill and compare it with the 8-hour RTO target.
5. Until 1–4 are done, treat the hosted project as unbacked-up and do not enter a real job.
