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
| Commercial | Estimate revisions with margin, quote issue and preview, acceptance |
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

This build persists to the browser's local storage on the device. It is a working development
workspace: data is not shared between devices and is not backed up. The data layer is isolated in
`src/data` behind typed actions so it can be replaced with Supabase/Postgres (with RLS) without
touching the domain or UI layers.

## Layout

```
src/domain/   pure TypeScript engines: numerics, geometry, validation, layout, material, pricing
src/data/     types, seed data, persistence store and actions
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
