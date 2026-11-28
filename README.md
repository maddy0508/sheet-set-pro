# Sheet Set Pro

Roofing measurement, sheet layout, material calculation and quoting for **Mitchell's Metal Roofing**
(Bendigo, Victoria).

This build is the application itself: customer and job management, roof capture, geometry checks,
deterministic sheet layout, bill of materials, estimates, quotes, invoices and payment records.

## Running it

```bash
npm install
npm run dev        # local development
npm run build      # production build
npm test           # engine test suite
npm run test:db    # schema, RLS and history rules against a local PostgreSQL
npm run test:api   # persistence layer against a local PostgREST + PostgreSQL stack
npm run typecheck
```

## What works today

| Area | State |
|---|---|
| Dashboard | Active jobs, quoted pipeline, unpaid invoices, attention list, activity |
| Customers | Create, edit, remove, search |
| Jobs | Create, filter, job workspace with eight working tabs |
| Roof capture | Drag to draw planes on a plan view, or enter dimensions; pitch per plane |
| Measurement | Evidence records, measurements, supersede-not-overwrite, grade gates |
| Validation | Blocking and warning checks incl. overlap, pitch range, minimum pitch |
| Sheet layout | Courses from effective cover width, splitting against maximum length |
| Materials | BOM grouped by cut length, flashing runs, fastener rule, CSV export when qualified |
| Commercial | Estimate revisions with margin, quote issue and preview, acceptance, PDF download |
| Documents | Quote and invoice PDFs with the business block, GST treatment, provenance notes and a content fingerprint |
| Billing | Invoice draft/issue/void, payments with idempotency, allocation, balances |
| Activity | Append-only event trail per job |

## Design decisions worth knowing

- **Deterministic arithmetic.** Dimensions are integer millimetres, money is integer cents.
  Rounding happens only at declared boundaries (`mulDivRound`, half away from zero). No
  trigonometry and no floating-point division on the manufacturing path.
- **No invented specifications.** The bundled product catalogue is explicitly synthetic. Order-grade
  output, supplier export and manufacturing release stay locked until the business enters and
  verifies real manufacturer data.
- **Nothing is overwritten.** Issued quotes and invoices are immutable; corrections create new
  revisions; superseded measurements are retained.
- **Provenance is mandatory.** A measurement without an evidence record cannot be order grade, and
  AI-assisted evidence can never be.
- **Failures are explicit.** Missing rules produce named codes and excluded lines, never zeros.

## Storage

Records live in **Supabase Postgres** when `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`
are present at build time. Without them the application falls back to a device-only workspace in
`localStorage`, which is useful for development and for offline demos but is not shared or backed up.

The shared workspace is single-business, not multi-tenant: every table carries the business id, and
row level security limits reads and writes to members of that business. Anonymous requests are
refused. See `supabase/README.md` for the schema, the migrations, first-run setup and the tests.

Writes go through the same typed actions as before. The store applies a change optimistically, then
persists the difference between the previous and the new state as **one transaction**: the whole
change set — business settings, upserts and deletes — travels in a single call to the
`save_workspace` database function, so a refusal anywhere leaves the database exactly as it was. A
rejected write restores the previous state and reports the failure, and the database is re-read so
the screen always matches what was actually stored.

### Working offline

The signed-in device keeps a copy of the workspace, so the application opens without a connection
and shows the records it last saw rather than an empty screen.

- A change made without a connection — or while the database cannot be reached — is applied on the
  device and queued. The header shows `Offline · N queued` and how many changes are waiting.
- Queued changes are replayed oldest first as soon as the connection returns, on the browser's
  `online` event, on a retry button, and on a 15-second timer while anything is waiting. Each queued
  entry is the same diff the online path sends, so order and content are unchanged.
- A **transport failure** (no connection, timeout, proxy outage) keeps the change and retries it. A
  **database refusal** (constraint, permission, immutability rule) drops that one change, reports it,
  and continues with the rest — retrying it unchanged could never succeed.
- Signing out deletes the device copy and any queued changes, after confirming if anything is
  unsent. Customer records are not left readable on a signed-out device.

This is offline operation on one device against the shared database; it is not multi-device
conflict resolution. Two devices changing the same record while both are offline resolve
last-write-wins when the second one replays.

### Installing it on a phone or tablet

The production build carries a web app manifest, icons and a service worker (`public/sw.js`), so a
browser offers to install Sheet Set Pro to the home screen and the installed app opens with no
network at all, not just with cached data.

- Navigation is **network first** — a new deployment replaces the cached `index.html` immediately,
  and a proxy error page is never treated as the application.
- Hashed bundles are **cache first**, because their names change with their content.
- Cross-origin requests (the database) are never cached; the queue decides what happens when they
  fail.
- The worker is registered in production builds only, so it cannot serve stale modules while
  editing.

## Storage (local mode)

Without Supabase configuration the build persists to the browser's local storage on the device. It
is a working development workspace: data is not shared between devices and is not backed up.

## Layout

```
src/domain/   pure TypeScript engines: numerics, geometry, validation, layout, material, pricing
src/data/     types, seed data, store, row mapping and Supabase repository
src/auth/     sign-in, workspace claim and session gate
src/lib/      job-level composition of the engines
src/ui/       design system primitives and icons
src/layout/   application shell
src/pages/    screens, including the job workspace and its tabs
src/styles/   design tokens and component styles
```

## Brand

The interface uses the supplied Sheet Set Pro identity: charcoal and steel body, slate blue panels,
cyan accent. No other palette is substituted.

## Not in scope

Payroll, rostering, crew management, customer portal, multi-tenant SaaS, general ledger, bank
reconciliation, BAS lodgement, structural engineering, and machine/manufacturing integration.
Aerial imagery, AI recognition, LiDAR and AR are deferred until licensing and hardware access exist.
