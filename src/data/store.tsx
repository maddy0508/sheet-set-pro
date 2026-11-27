import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  ActivityEvent,
  Allocation,
  AppState,
  CalcSnapshot,
  CatalogueProfile,
  Company,
  Customer,
  DocLine,
  Estimate,
  Evidence,
  Invoice,
  Job,
  Measurement,
  Payment,
  Plane,
  Quote,
} from './types';
import { createInitialState } from './seed';
import { isSupabaseConfigured } from '@/lib/supabase';
import { loadWorkspace, persistStateChange } from './remote';
import { computeTotals } from '@/domain/pricing';
import { checkAllocation, checkInvoiceVoid, checkPaymentAmount, decideGst } from '@/domain/commercial';
import { fingerprint } from '@/domain/units';
import { captureInvoiceSnapshot, captureQuoteSnapshot } from '@/lib/document';
import type { EvidenceKind, FlashingKind, MeasurementGrade, SourceType } from '@/domain/types';
import { normaliseTimestamp } from '@/lib/time';

const STORAGE_KEY = 'sheet-set-pro.state.v1';

const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const nowIso = () => new Date().toISOString();

function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialState();
    const parsed = JSON.parse(raw) as AppState;
    if (!parsed || parsed.version !== 1) return createInitialState();
    return parsed;
  } catch {
    return createInitialState();
  }
}

function withActivity(
  state: AppState,
  type: string,
  subjectType: ActivityEvent['subjectType'],
  subjectId: string,
  detail: string,
): ActivityEvent[] {
  return [{ id: uid(), at: nowIso(), type, subjectType, subjectId, detail }, ...state.activity].slice(0, 500);
}

export type Actions = {
  updateCompany: (patch: Partial<Company>) => void;
  saveCustomer: (input: Partial<Customer> & { name: string }) => Customer;
  deleteCustomer: (id: string) => void;
  saveJob: (input: Partial<Job> & { customerId: string; title: string }) => Job;
  updateJob: (id: string, patch: Partial<Job>) => void;
  addPlane: (jobId: string, plane: Omit<Plane, 'id' | 'jobId'>) => void;
  updatePlane: (id: string, patch: Partial<Plane>) => void;
  deletePlane: (id: string) => void;
  upsertFlashing: (jobId: string, kind: FlashingKind, lengthMm: number) => void;
  deleteFlashing: (id: string) => void;
  addEvidence: (
    jobId: string,
    input: {
      sourceKind: EvidenceKind;
      note: string;
      accuracyClaimMm: number | null;
      accuracyBasis: Evidence['accuracyBasis'];
      isVerified: boolean;
    },
  ) => Evidence;
  addMeasurement: (
    jobId: string,
    input: {
      evidenceId: string;
      kind: Measurement['kind'];
      label: string;
      valueMm: number;
      toleranceMm: number | null;
      grade: MeasurementGrade;
    },
  ) => void;
  deactivateMeasurement: (id: string) => void;
  saveProfile: (profile: CatalogueProfile) => void;
  saveEstimate: (jobId: string, lines: DocLine[], marginBp: number, labourCents: number) => Estimate;
  issueQuote: (jobId: string, estimateId: string, validUntil: string | null) => { ok: boolean; message?: string };
  setQuoteStatus: (quoteId: string, status: Quote['status']) => void;
  createInvoice: (jobId: string, quoteId: string | null) => void;
  issueInvoice: (invoiceId: string) => { ok: boolean; message?: string };
  voidInvoice: (invoiceId: string, reason: string) => { ok: boolean; message?: string };
  addPayment: (
    jobId: string,
    input: { amountCents: number; method: Payment['method']; reference: string; receivedAt: string },
    idempotencyKey: string,
  ) => { ok: boolean; message?: string };
  allocatePayment: (paymentId: string, invoiceId: string, amountCents: number) => { ok: boolean; message?: string };
  recordSnapshot: (snapshot: Omit<CalcSnapshot, 'id' | 'createdAt'>) => void;
  resetWorkspace: () => void;
  loadSampleJob: () => void;
};

/** Provenance is captured with the document, so it must reflect the job's own profile. */
function isCatalogueVerified(state: AppState, job: Job): boolean {
  const profile = state.catalogue.find((candidate) => candidate.id === job.profileId);
  return profile?.verificationState === 'VERIFIED';
}

export type SyncState = {
  mode: 'local' | 'remote';
  status: 'loading' | 'ready' | 'saving' | 'error';
  error: string | null;
  lastSavedAt: string | null;
};

type StoreValue = {
  state: AppState;
  actions: Actions;
  sync: SyncState & { retry: () => void; dismissError: () => void };
};

const StoreContext = createContext<StoreValue | null>(null);

/**
 * A remote workspace starts empty: showing example data before the database has
 * answered would be indistinguishable from real records.
 */
function emptyState(): AppState {
  const base = createInitialState();
  return {
    ...base,
    company: { ...base.company, id: '' },
    catalogue: [],
    activity: [],
  };
}

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [state, applyState] = useState<AppState>(() => (isSupabaseConfigured ? emptyState() : load()));
  const stateRef = useRef(state);
  stateRef.current = state;

  const [sync, setSync] = useState<SyncState>(() => ({
    mode: isSupabaseConfigured ? 'remote' : 'local',
    status: isSupabaseConfigured ? 'loading' : 'ready',
    error: null,
    lastSavedAt: null,
  }));

  const [reloadToken, setReloadToken] = useState(0);
  const writeSequence = useRef(0);
  const writeQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (isSupabaseConfigured) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage unavailable or full: the session still works, it is simply not persisted.
    }
  }, [state]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    setSync((current) => ({ ...current, status: 'loading', error: null }));

    loadWorkspace()
      .then((loaded) => {
        if (cancelled) return;
        stateRef.current = loaded;
        applyState(loaded);
        setSync((current) => ({ ...current, status: 'ready', error: null }));
        // A browser that previously ran in local mode still holds a device-only copy.
        // Once the shared workspace has answered, that copy is stale and unmanaged.
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          // Storage may be unavailable; nothing depends on this cleanup.
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setSync((current) => ({
          ...current,
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  /**
   * Applies a change immediately, then writes it. A rejected write restores the
   * previous state and says so: the operator never sees a save that did not happen.
   */
  const commit = useCallback((updater: (previous: AppState) => AppState) => {
    const before = stateRef.current;
    const after = updater(before);
    if (after === before) return;

    stateRef.current = after;
    applyState(after);

    if (!isSupabaseConfigured) return;

    const ticket = ++writeSequence.current;
    setSync((current) => ({ ...current, status: 'saving', error: null }));

    writeQueue.current = writeQueue.current
      .then(() => persistStateChange(before, after))
      .then(() => {
        if (ticket !== writeSequence.current) return;
        setSync((current) => ({ ...current, status: 'ready', lastSavedAt: new Date().toISOString() }));
      })
      .catch((error: unknown) => {
        if (ticket === writeSequence.current) {
          stateRef.current = before;
          applyState(before);
        }
        const message = error instanceof Error ? error.message : String(error);
        setSync((current) => ({ ...current, status: 'error', error: message }));
        // A write can fail after some tables were written; the database is the authority.
        loadWorkspace()
          .then((loaded) => {
            stateRef.current = loaded;
            applyState(loaded);
          })
          .catch(() => undefined);
      });
  }, []);

  const retry = useCallback(() => setReloadToken((token) => token + 1), []);
  const dismissError = useCallback(() => setSync((current) => ({ ...current, status: 'ready', error: null })), []);

  const actions = useMemo<Actions>(() => {
    const nextDocNumber = (prefix: string, existing: { number: string }[]) => {
      const numbers = existing.map((doc) => Number(doc.number.replace(/\D/g, ''))).filter((n) => Number.isFinite(n));
      const max = numbers.length > 0 ? Math.max(...numbers) : 0;
      return `${prefix}-${String(max + 1).padStart(4, '0')}`;
    };

    return {
      updateCompany: (patch) =>
        commit((prev) => ({
          ...prev,
          company: { ...prev.company, ...patch },
          activity: withActivity(prev, 'company.updated', 'company', prev.company.id, 'Company settings updated.'),
        })),

      saveCustomer: (input) => {
        const existing = input.id ? stateRef.current.customers.find((c) => c.id === input.id) : undefined;
        const customer: Customer = {
          id: existing?.id ?? uid(),
          name: input.name,
          contactName: input.contactName ?? existing?.contactName ?? '',
          email: input.email ?? existing?.email ?? '',
          phone: input.phone ?? existing?.phone ?? '',
          address: input.address ?? existing?.address ?? '',
          notes: input.notes ?? existing?.notes ?? '',
          sourceType: (input.sourceType ?? existing?.sourceType ?? 'REAL') as SourceType,
          createdAt: existing?.createdAt ?? nowIso(),
          updatedAt: nowIso(),
        };
        commit((prev) => ({
          ...prev,
          customers: existing ? prev.customers.map((c) => (c.id === customer.id ? customer : c)) : [customer, ...prev.customers],
          activity: withActivity(prev, existing ? 'customer.updated' : 'customer.created', 'customer', customer.id, customer.name),
        }));
        return customer;
      },

      deleteCustomer: (id) => {
        const linkedJobs = stateRef.current.jobs.filter((job) => job.customerId === id);
        if (linkedJobs.length > 0) {
          setSync((current) => ({
            ...current,
            status: 'error',
            error: `This customer has ${linkedJobs.length} job${linkedJobs.length === 1 ? '' : 's'} on record. Jobs keep their customer, so remove or reassign those jobs first.`,
          }));
          return;
        }
        commit((prev) => ({
          ...prev,
          customers: prev.customers.filter((c) => c.id !== id),
          activity: withActivity(prev, 'customer.deleted', 'customer', id, 'Customer removed.'),
        }));
      },

      saveJob: (input) => {
        const existing = input.id ? stateRef.current.jobs.find((j) => j.id === input.id) : undefined;
        const job: Job = {
          id: existing?.id ?? uid(),
          customerId: input.customerId,
          jobNumber:
            input.jobNumber?.trim() || existing?.jobNumber || `J-${String(stateRef.current.jobs.length + 1).padStart(4, '0')}`,
          title: input.title,
          siteAddress: input.siteAddress ?? existing?.siteAddress ?? '',
          status: (input.status ?? existing?.status ?? 'draft') as Job['status'],
          notes: input.notes ?? existing?.notes ?? '',
          sourceType: (input.sourceType ?? existing?.sourceType ?? 'REAL') as SourceType,
          profileId: input.profileId ?? existing?.profileId ?? stateRef.current.catalogue[0]?.id ?? null,
          crsEpsg: input.crsEpsg ?? existing?.crsEpsg ?? null,
          operatorApproved: input.operatorApproved ?? existing?.operatorApproved ?? false,
          createdAt: existing?.createdAt ?? nowIso(),
          updatedAt: nowIso(),
        };
        commit((prev) => ({
          ...prev,
          jobs: existing ? prev.jobs.map((j) => (j.id === job.id ? job : j)) : [job, ...prev.jobs],
          activity: withActivity(prev, existing ? 'job.updated' : 'job.created', 'job', job.id, `${job.jobNumber} · ${job.title}`),
        }));
        return job;
      },

      updateJob: (id, patch) =>
        commit((prev) => ({
          ...prev,
          jobs: prev.jobs.map((j) => (j.id === id ? { ...j, ...patch, updatedAt: nowIso() } : j)),
        })),

      addPlane: (jobId, plane) =>
        commit((prev) => ({
          ...prev,
          planes: [...prev.planes, { ...plane, id: uid(), jobId }],
          activity: withActivity(prev, 'roof.plane.added', 'job', jobId, `Plane ${plane.ref} captured.`),
        })),

      updatePlane: (id, patch) =>
        commit((prev) => ({ ...prev, planes: prev.planes.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),

      deletePlane: (id) =>
        commit((prev) => ({
          ...prev,
          planes: prev.planes.filter((p) => p.id !== id),
          activity: withActivity(
            prev,
            'roof.plane.removed',
            'job',
            String(prev.planes.find((p) => p.id === id)?.jobId ?? ''),
            'Plane removed.',
          ),
        })),

      upsertFlashing: (jobId, kind, lengthMm) =>
        commit((prev) => {
          const existing = prev.flashings.find((f) => f.jobId === jobId && f.kind === kind);
          if (existing) {
            return {
              ...prev,
              flashings: prev.flashings.map((f) => (f.id === existing.id ? { ...f, lengthMm, source: 'ENTERED' } : f)),
            };
          }
          return { ...prev, flashings: [...prev.flashings, { id: uid(), jobId, kind, lengthMm, source: 'ENTERED' }] };
        }),

      deleteFlashing: (id) => commit((prev) => ({ ...prev, flashings: prev.flashings.filter((f) => f.id !== id) })),

      addEvidence: (jobId, input) => {
        const evidence: Evidence = {
          id: uid(),
          jobId,
          sourceKind: input.sourceKind,
          note: input.note,
          accuracyClaimMm: input.accuracyClaimMm,
          accuracyBasis: input.accuracyBasis,
          isVerified: input.isVerified,
          createdAt: nowIso(),
        };
        commit((prev) => ({
          ...prev,
          evidence: [evidence, ...prev.evidence],
          activity: withActivity(prev, 'measurement.evidence.added', 'job', jobId, `${input.sourceKind} evidence recorded.`),
        }));
        return evidence;
      },

      addMeasurement: (jobId, input) =>
        commit((prev) => ({
          ...prev,
          measurements: [
            {
              id: uid(),
              jobId,
              evidenceId: input.evidenceId,
              kind: input.kind,
              label: input.label,
              valueMm: input.valueMm,
              toleranceMm: input.toleranceMm,
              grade: input.grade,
              isActive: true,
              createdAt: nowIso(),
            },
            ...prev.measurements,
          ],
          activity: withActivity(prev, 'measurement.recorded', 'job', jobId, `${input.label} · ${input.valueMm} mm · ${input.grade}`),
        })),

      deactivateMeasurement: (id) =>
        commit((prev) => ({
          ...prev,
          measurements: prev.measurements.map((m) => (m.id === id ? { ...m, isActive: false } : m)),
          activity: withActivity(
            prev,
            'measurement.superseded',
            'job',
            String(prev.measurements.find((m) => m.id === id)?.jobId ?? ''),
            'Measurement superseded; the original remains on record.',
          ),
        })),

      saveProfile: (profile) =>
        commit((prev) => ({
          ...prev,
          catalogue: prev.catalogue.some((p) => p.id === profile.id)
            ? prev.catalogue.map((p) => (p.id === profile.id ? profile : p))
            : [...prev.catalogue, profile],
          activity: withActivity(prev, 'catalogue.updated', 'catalogue', profile.id, profile.name),
        })),

      saveEstimate: (jobId, lines, marginBp, labourCents) => {
        const company = stateRef.current.company;
        const totals = computeTotals(
          lines.map((line) => ({ qtyMicro: line.qtyMicro, unitPriceCents: line.unitPriceCents })),
          { gstRateBp: company.gstRateBp, gstApplied: company.gstRegistered === true },
        );
        const estimate: Estimate = {
          id: uid(),
          jobId,
          revision: stateRef.current.estimates.filter((e) => e.jobId === jobId).length + 1,
          lines,
          marginBp,
          labourCents,
          totals: {
            subtotalCents: totals.subtotalCents + labourCents,
            gstCents: totals.gstCents,
            totalCents: totals.totalCents + labourCents,
          },
          fingerprint: fingerprint({ lines, marginBp, labourCents }),
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        commit((prev) => ({
          ...prev,
          estimates: [estimate, ...prev.estimates],
          activity: withActivity(prev, 'estimate.saved', 'estimate', estimate.id, `Estimate revision ${estimate.revision}.`),
        }));
        return estimate;
      },

      issueQuote: (jobId, estimateId, validUntil) => {
        const current = stateRef.current;
        if (!current.estimates.some((e) => e.id === estimateId)) return { ok: false, message: 'Estimate not found.' };
        const gst = decideGst(current.company);
        if (!gst.ok) return { ok: false, message: gst.message };
        const gstApplied = gst.applied;
        commit((prev) => {
          const estimate = prev.estimates.find((e) => e.id === estimateId);
          if (!estimate) return prev;
          const totals = computeTotals(
            estimate.lines.map((line) => ({ qtyMicro: line.qtyMicro, unitPriceCents: line.unitPriceCents })),
            { gstRateBp: prev.company.gstRateBp, gstApplied },
          );
          const job = prev.jobs.find((j) => j.id === jobId);
          if (!job) return prev;
          const draft: Quote = {
            id: uid(),
            jobId,
            number: nextDocNumber('Q', prev.quotes),
            revision: prev.quotes.filter((q) => q.jobId === jobId).length + 1,
            status: 'issued',
            lines: estimate.lines,
            totals: {
              subtotalCents: totals.subtotalCents + estimate.labourCents,
              gstCents: totals.gstCents,
              totalCents: totals.totalCents + estimate.labourCents,
            },
            gstApplied,
            gstRateBp: prev.company.gstRateBp,
            issuedAt: nowIso(),
            validUntil,
            fingerprint: '',
            snapshot: null,
            createdAt: nowIso(),
          };
          const snapshot = captureQuoteSnapshot({
            quote: draft,
            job,
            customer: prev.customers.find((c) => c.id === job.customerId),
            company: prev.company,
            catalogueVerified: isCatalogueVerified(prev, job),
          });
          const quote: Quote = { ...draft, snapshot, fingerprint: snapshot.fingerprint };
          return {
            ...prev,
            quotes: [quote, ...prev.quotes],
            jobs: prev.jobs.map((j) => (j.id === jobId ? { ...j, status: 'quoted', updatedAt: nowIso() } : j)),
            activity: withActivity(prev, 'quote.issued', 'quote', quote.id, `${quote.number} issued.`),
          };
        });
        return { ok: true };
      },

      setQuoteStatus: (quoteId, status) =>
        commit((prev) => {
          const quote = prev.quotes.find((q) => q.id === quoteId);
          if (!quote || quote.status === 'draft') return prev;
          return {
            ...prev,
            quotes: prev.quotes.map((q) => (q.id === quoteId ? { ...q, status } : q)),
            jobs: prev.jobs.map((j) =>
              j.id === quote.jobId ? { ...j, status: status === 'accepted' ? 'won' : 'lost', updatedAt: nowIso() } : j,
            ),
            activity: withActivity(prev, `quote.${status}`, 'quote', quoteId, `Quote ${quote.number} ${status}.`),
          };
        }),

      createInvoice: (jobId, quoteId) =>
        commit((prev) => {
          const quote = prev.quotes.find((q) => q.id === quoteId);
          const invoice: Invoice = {
            id: uid(),
            jobId,
            number: nextDocNumber('INV', prev.invoices),
            quoteId,
            status: 'draft',
            lines: quote?.lines ?? [],
            totals: quote?.totals ?? { subtotalCents: 0, gstCents: 0, totalCents: 0 },
            gstRegisteredSnapshot: prev.company.gstRegistered,
            gstRateBp: prev.company.gstRateBp,
            issuedAt: null,
            dueDate: null,
            voidReason: null,
            fingerprint: '',
            snapshot: null,
            createdAt: nowIso(),
          };
          return {
            ...prev,
            invoices: [invoice, ...prev.invoices],
            activity: withActivity(prev, 'invoice.drafted', 'invoice', invoice.id, `${invoice.number} drafted.`),
          };
        }),

      issueInvoice: (invoiceId) => {
        const current = stateRef.current;
        const candidate = current.invoices.find((i) => i.id === invoiceId);
        if (!candidate) return { ok: false, message: 'Invoice not found.' };
        if (candidate.status !== 'draft') return { ok: false, message: `${candidate.number} has already been ${candidate.status}.` };
        const gst = decideGst(current.company);
        if (!gst.ok) return { ok: false, message: gst.message };
        const gstApplied = gst.applied;
        commit((prev) => {
          const invoice = prev.invoices.find((i) => i.id === invoiceId);
          if (!invoice || invoice.status !== 'draft') return prev;
          const totals = computeTotals(
            invoice.lines.map((line) => ({ qtyMicro: line.qtyMicro, unitPriceCents: line.unitPriceCents })),
            { gstRateBp: prev.company.gstRateBp, gstApplied },
          );
          const job = prev.jobs.find((j) => j.id === invoice.jobId);
          if (!job) return prev;
          const drafted: Invoice = {
            ...invoice,
            status: 'issued',
            totals: { subtotalCents: totals.subtotalCents, gstCents: totals.gstCents, totalCents: totals.totalCents },
            gstRegisteredSnapshot: prev.company.gstRegistered,
            gstRateBp: prev.company.gstRateBp,
            issuedAt: nowIso(),
            dueDate: new Date(Date.now() + 14 * 86400000).toISOString(),
            fingerprint: '',
            snapshot: null,
          };
          const snapshot = captureInvoiceSnapshot({
            invoice: drafted,
            job,
            customer: prev.customers.find((c) => c.id === job.customerId),
            company: prev.company,
            catalogueVerified: isCatalogueVerified(prev, job),
          });
          const issued: Invoice = { ...drafted, snapshot, fingerprint: snapshot.fingerprint };
          return {
            ...prev,
            invoices: prev.invoices.map((i) => (i.id === invoiceId ? issued : i)),
            jobs: prev.jobs.map((j) => (j.id === invoice.jobId ? { ...j, status: 'invoiced', updatedAt: nowIso() } : j)),
            activity: withActivity(prev, 'invoice.issued', 'invoice', invoiceId, `${invoice.number} issued and locked.`),
          };
        });
        return { ok: true };
      },

      voidInvoice: (invoiceId, reason) => {
        const current = stateRef.current;
        const invoice = current.invoices.find((i) => i.id === invoiceId);
        if (!invoice) return { ok: false, message: 'Invoice not found.' };
        if (reason.trim() === '') return { ok: false, message: 'A reason is required to void an invoice.' };
        const check = checkInvoiceVoid(invoice, current.allocations);
        if (!check.ok) return check;
        commit((prev) => ({
          ...prev,
          invoices: prev.invoices.map((i) =>
            i.id === invoiceId && i.status === 'issued' ? { ...i, status: 'voided', voidReason: reason } : i,
          ),
          activity: withActivity(prev, 'invoice.voided', 'invoice', invoiceId, reason),
        }));
        return { ok: true };
      },

      addPayment: (jobId, input, idempotencyKey) => {
        const existing = stateRef.current.payments.find((p) => p.idempotencyKey === idempotencyKey);
        if (existing) return { ok: false, message: 'This payment was already recorded.' };
        const amountCheck = checkPaymentAmount(input.amountCents);
        if (!amountCheck.ok) return amountCheck;
        const payment: Payment = {
          id: uid(),
          jobId,
          amountCents: input.amountCents,
          receivedAt: normaliseTimestamp(input.receivedAt, nowIso()),
          method: input.method,
          reference: input.reference,
          idempotencyKey,
          createdAt: nowIso(),
        };
        commit((prev) => ({
          ...prev,
          payments: [payment, ...prev.payments],
          activity: withActivity(prev, 'payment.recorded', 'payment', payment.id, 'Payment recorded.'),
        }));
        return { ok: true };
      },

      allocatePayment: (paymentId, invoiceId, amountCents) => {
        const current = stateRef.current;
        const payment = current.payments.find((p) => p.id === paymentId);
        const invoice = current.invoices.find((i) => i.id === invoiceId);
        if (!payment || !invoice) return { ok: false, message: 'Payment or invoice not found.' };
        const check = checkAllocation({ payment, invoice, allocations: current.allocations, amountCents });
        if (!check.ok) return check;
        const allocation: Allocation = { id: uid(), paymentId, invoiceId, amountCents, createdAt: nowIso() };
        commit((prev) => {
          const fullyPaid =
            prev.allocations.filter((a) => a.invoiceId === invoiceId).reduce((s, a) => s + a.amountCents, 0) + amountCents >=
            invoice.totals.totalCents;
          return {
            ...prev,
            allocations: [allocation, ...prev.allocations],
            jobs: prev.jobs.map((j) => (j.id === invoice.jobId && fullyPaid ? { ...j, status: 'paid', updatedAt: nowIso() } : j)),
            activity: withActivity(prev, 'payment.allocated', 'payment', paymentId, `Allocated to ${invoice.number}.`),
          };
        });
        return { ok: true };
      },

      recordSnapshot: (snapshot) =>
        commit((prev) => ({
          ...prev,
          snapshots: [{ ...snapshot, id: uid(), createdAt: nowIso() }, ...prev.snapshots].slice(0, 200),
        })),

      resetWorkspace: () => {
        if (isSupabaseConfigured) {
          setSync((current) => ({
            ...current,
            status: 'error',
            error:
              'Resetting is disabled for a shared workspace: issued documents, measurement evidence and payment history are kept permanently. Remove individual records instead.',
          }));
          return;
        }
        commit(() => createInitialState());
      },

      loadSampleJob: () =>
        commit((prev) => {
          const customerId = uid();
          const jobId = uid();
          const evidenceId = uid();
          const stamp = nowIso();
          const planeOne = { id: uid(), jobId, ref: 'P1', xMm: 0, yMm: 0, widthMm: 6000, lengthMm: 3600, pitchMicrodeg: 22_500_000 };
          const planeTwo = { id: uid(), jobId, ref: 'P2', xMm: 6000, yMm: 0, widthMm: 6000, lengthMm: 3600, pitchMicrodeg: 22_500_000 };
          const measurements = [
            { plane: planeOne, kind: 'plane_width' as const, label: 'P1 eave width', valueMm: 6000 },
            { plane: planeOne, kind: 'plane_length' as const, label: 'P1 rafter length', valueMm: 3600 },
            { plane: planeTwo, kind: 'plane_width' as const, label: 'P2 eave width', valueMm: 6000 },
            { plane: planeTwo, kind: 'plane_length' as const, label: 'P2 rafter length', valueMm: 3600 },
          ].map(({ kind, label, valueMm }) => ({
            id: uid(),
            jobId,
            evidenceId,
            kind,
            label,
            valueMm,
            toleranceMm: 20,
            grade: 'ESTIMATE_GRADE' as const,
            isActive: true,
            createdAt: stamp,
          }));
          return {
            ...prev,
            customers: [
              {
                id: customerId,
                name: 'Sample Customer (SYNTHETIC)',
                contactName: 'Sample Contact',
                email: 'sample@example.invalid',
                phone: '0400 000 000',
                address: '1 Example Street, Bendigo VIC 3550',
                notes: 'SYNTHETIC demonstration record.',
                sourceType: 'SYNTHETIC',
                createdAt: stamp,
                updatedAt: stamp,
              },
              ...prev.customers,
            ],
            jobs: [
              {
                id: jobId,
                customerId,
                jobNumber: `J-${String(prev.jobs.length + 1).padStart(4, '0')}`,
                title: 'Sample gable roof (SYNTHETIC)',
                siteAddress: '1 Example Street, Bendigo VIC 3550',
                status: 'measured',
                notes: 'SYNTHETIC demonstration job. Not a real customer or roof.',
                sourceType: 'SYNTHETIC',
                profileId: prev.catalogue[0]?.id ?? null,
                crsEpsg: 7855,
                operatorApproved: false,
                createdAt: stamp,
                updatedAt: stamp,
              },
              ...prev.jobs,
            ],
            planes: [...prev.planes, planeOne, planeTwo],
            evidence: [
              {
                id: evidenceId,
                jobId,
                sourceKind: 'manual',
                note: 'SYNTHETIC tape measurement entered for the demonstration job.',
                accuracyClaimMm: 50,
                accuracyBasis: 'operator_estimate',
                isVerified: false,
                createdAt: stamp,
              },
              ...prev.evidence,
            ],
            measurements: [
              ...measurements,
              ...prev.measurements,
            ],
            flashings: [
              ...prev.flashings,
              { id: uid(), jobId, kind: 'ridge', lengthMm: 12_000, source: 'ENTERED' },
              { id: uid(), jobId, kind: 'barge', lengthMm: 7_200, source: 'ENTERED' },
            ],
            activity: withActivity(prev, 'demo.loaded', 'job', jobId, 'Synthetic demonstration job created.'),
          };
        }),
    };
  }, [commit]);

  const value = useMemo(
    () => ({ state, actions, sync: { ...sync, retry, dismissError } }),
    [state, actions, sync, retry, dismissError],
  );
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const context = useContext(StoreContext);
  if (!context) throw new Error('useStore must be used inside AppStoreProvider');
  return context;
}
