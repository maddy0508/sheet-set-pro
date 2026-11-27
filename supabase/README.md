# Database: schema, access control and migrations

The application stores its records in Supabase Postgres. This directory holds the migrations, the
test suite, and the notes needed to stand a workspace up.

## What the database guarantees

The rules that the interface already follows are enforced here as well, so a bug in the client, a
stale tab or a hand-written request cannot break them.

| Rule | How it is enforced |
|---|---|
| Only members of the business can read or write its records | Row level security on every table, through `is_member(business_id)` |
| Anonymous users see nothing | `anon` has no privileges on any table or function |
| A signed-in stranger sees nothing | No membership row, so every policy denies |
| Issued quotes are frozen | Trigger permits only the acceptance status to change |
| Issued invoices are frozen | Trigger permits only voiding, with a reason |
| Invoices are never deleted | Trigger rejects every delete |
| Measurements are superseded, not rewritten | Trigger freezes the value, evidence and grade; `is_active` may go true → false |
| Evidence is permanent | Trigger rejects edits to the source and deletes |
| Payments, allocations, estimates, snapshots and activity are append-only | Triggers reject update and delete |
| A payment cannot be recorded twice | Unique `(business_id, idempotency_key)` |
| A synthetic catalogue entry cannot claim verification | Check constraint `catalogue_unverified_source` |
| Money is integer cents, dimensions integer millimetres | Column types, no floating point on the path |
| Every child row belongs to the same business as its job | Composite foreign keys `(job_id, business_id)` |
| A save lands completely or not at all | `save_workspace(...)` applies business settings, upserts and deletes in one transaction, as the caller |

## How a save is written

A save is one operator action, so it is one database transaction. The client works out what
changed (see `src/data/persistence.ts`) and hands the whole change set to `save_workspace`, which
applies it in this order inside a single transaction:

1. Business settings, only the columns an operator can edit.
2. Upserts, parents before children (`customers` → `catalogue_profiles` → `jobs` → … →
   `activity_events`), so every foreign key is satisfied when it is checked.
3. Deletes, children before parents.

The function is `security invoker`: the caller's own role runs every statement, so row level
security, the history triggers, the allocation guard and every constraint apply exactly as they do
to a direct write. There is no service-role key, no `security definer`, and nothing is retried
silently. A refusal anywhere — a frozen issued document, an over-allocation, a broken foreign key,
a check constraint — aborts the transaction, and the earlier tables are left untouched.

Two further guards live in the function itself: a record whose `business_id` does not match the
save is refused, and a column the target table does not have is refused rather than dropped. A
delete that matches no rows is reported instead of ignored, because it means the screen is out of
date.

## Applying the migrations

Migrations are plain SQL, ordered by filename, and safe to run once each.

**Supabase SQL editor** (no CLI needed): run the files in order, top to bottom.

```
supabase/migrations/20261126090000_schema.sql
supabase/migrations/20261126091000_protection.sql
supabase/migrations/20261126092000_rls.sql
supabase/migrations/20261126093000_seed_workspace.sql
supabase/migrations/20261126100000_labour_cost.sql
supabase/migrations/20261127120000_allocation_integrity.sql
supabase/migrations/20261127121000_document_snapshots.sql
supabase/migrations/20261127130000_atomic_save.sql
```

**Supabase CLI**, if it is available:

```bash
supabase link --project-ref <project-ref>
supabase db push
```

`supabase/tests/local_bootstrap.sql` is a local stand-in for the `auth` schema and the `anon` /
`authenticated` roles. It must never be applied to a real project.

The seed migration inserts the single workspace row (`Mitchell's Metal Roofing`, business identity
left blank for the operator to confirm) and two catalogue profiles that are explicitly `SYNTHETIC`
and `PLACEHOLDER`.

## First run

1. Apply the migrations.
2. Create the operator's account in Supabase **Authentication → Users** (email and password).
3. Open the application, sign in, and choose **Claim workspace**. The first signed-in user becomes
   the owner; after that the workspace can only be joined by adding a membership row.
4. Complete the business identity and GST settings in **Settings**. Until GST status is confirmed,
   tax treatment stays disabled.

## Environment

The build reads two values at compile time (see `.env.example`):

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-or-anon-key>
```

Only the publishable/anon key belongs in a browser. Row level security is what protects the data; a
service-role key bypasses it and must never be shipped to a client, committed, or pasted into a
report.

## Tests

Both suites run against real PostgreSQL, not mocks.

```bash
npm run test:db    # policies, isolation, immutability, constraints, commercial integrity, atomic saves
npm run test:api   # the browser's own repository module against PostgREST: claim, write, reload, reject
```

`test:db` needs a local PostgreSQL and `sudo` to create a throwaway database. `test:api` also needs
`curl`, and downloads the pinned PostgREST 12.2.3 binary to `/tmp` if it is missing. Both scripts
recreate their database from scratch on every run, so they are safe to repeat.

What the API suite proves, in order:

1. An unclaimed workspace reports itself as unclaimed.
2. The first signed-in user can claim it.
3. A customer, job, plane, flashing, evidence record, measurement, quote and invoice are written
   through `src/data/remote.ts`.
4. A fresh load returns exactly what was written — this is the browser-refresh path.
5. A measurement can be superseded but not rewritten; an issued quote cannot be altered but can be
   accepted.
6. A save that is refused halfway leaves every table exactly as it was: an invalid measurement
   rolls back the customer, job and evidence written before it; a business settings change in the
   same save is undone too; and a delete that fails (a customer who still has jobs) undoes the
   inserts and updates that preceded it. Reloading returns the pre-save state byte for byte.
7. An anonymous key can read and write nothing.

## Layout

```
migrations/   schema, history protection, row level security, seed
tests/        local auth shim, assertion harness, access-control suite
```

## Known limits

- No storage buckets yet: photographs and plans are recorded as evidence metadata, not files.
- No backup automation. `scripts/backup-db.sh` takes a verified logical backup on demand and
  `scripts/restore-drill.sh` proves it restores; see `docs/operations/backup-and-restore.md`.
  Nothing schedules either yet, and a hosted project does not exist, so the RPO/RTO targets are
  not met.
- `claim_workspace` is the only way to add the first member. Later members are added directly in the
  database (a member-management screen is not in R1 scope).
