import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { Allocation, AppState, Customer, Evidence, Invoice, Job, Measurement, Payment, Plane, Quote } from './types';
import { captureInvoiceSnapshot } from '@/lib/document';
import { claimWorkspace, fetchWorkspaceStatus, loadWorkspace, persistStateChange } from './remote';

/**
 * End-to-end persistence check over a real PostgREST + PostgreSQL stack, using the same
 * module the browser uses. `bash scripts/test-api.sh` provisions the stack and runs it.
 *
 * Skipped during a normal `npm test`, where no API is configured.
 */
const apiUrl = process.env.SSP_API_URL;
const jwtSecret = process.env.SSP_API_JWT_SECRET;

const run = apiUrl ? describe : describe.skip;

const stamp = '2026-11-26T05:00:00.000Z';

const customer: Customer = {
  id: 'aaaaaaaa-1111-4111-8111-000000000001',
  name: 'Integration Customer',
  contactName: 'Sam Example',
  email: 'sam@example.invalid',
  phone: '0400 000 001',
  address: '2 Test Street, Bendigo VIC 3550',
  notes: 'Created by the API integration suite.',
  sourceType: 'TEST',
  createdAt: stamp,
  updatedAt: stamp,
};

const job: Job = {
  id: 'bbbbbbbb-1111-4111-8111-000000000001',
  customerId: customer.id,
  jobNumber: 'J-0001',
  title: 'Integration roof',
  siteAddress: '2 Test Street, Bendigo VIC 3550',
  status: 'measured',
  notes: 'TEST record.',
  sourceType: 'TEST',
  profileId: 'cat-syn-1',
  crsEpsg: 7855,
  operatorApproved: false,
  createdAt: stamp,
  updatedAt: stamp,
};

const quote: Quote = {
  id: 'eeeeeeee-1111-4111-8111-000000000001',
  jobId: job.id,
  number: 'Q-0001',
  revision: 1,
  status: 'issued',
  lines: [
    { key: 'sheet', description: 'Sheet', qtyMicro: 16_000_000, unit: 'ea', unitPriceCents: 10_869, isPlaceholder: false },
    { key: 'labour', description: 'Installation labour', qtyMicro: 43_200_000, unit: 'm²', unitPriceCents: 4_500, isPlaceholder: false },
  ],
  totals: { subtotalCents: 458_544, gstCents: 0, totalCents: 458_544 },
  gstApplied: false,
  gstRateBp: 1000,
  issuedAt: stamp,
  validUntil: '2026-12-26',
  fingerprint: 'fp-quote-1',
  snapshot: null,
  createdAt: stamp,
};

const invoice: Invoice = {
  id: 'ffffffff-1111-4111-8111-000000000001',
  jobId: job.id,
  number: 'INV-0001',
  quoteId: quote.id,
  status: 'issued',
  lines: quote.lines,
  totals: quote.totals,
  gstRegisteredSnapshot: null,
  gstRateBp: 1000,
  issuedAt: stamp,
  dueDate: '2026-12-10T00:00:00.000Z',
  voidReason: null,
  fingerprint: 'fp-invoice-1',
  snapshot: null,
  createdAt: stamp,
};

function withRecords(state: AppState): AppState {
  return { ...state, customers: [customer], jobs: [job] };
}

/** Everything the operator would see, as one string, for before/after comparison. */
const stateFingerprint = (state: AppState): string => JSON.stringify(state);

const atomicCustomer = (id: string, name: string): Customer => ({
  id,
  name,
  contactName: '',
  email: '',
  phone: '',
  address: '',
  notes: 'Atomic save fixture.',
  sourceType: 'TEST',
  createdAt: stamp,
  updatedAt: stamp,
});

const atomicJob = (id: string, customerId: string, jobNumber: string): Job => ({
  id,
  customerId,
  jobNumber,
  title: 'Atomic save job',
  siteAddress: '',
  status: 'draft',
  notes: '',
  sourceType: 'TEST',
  profileId: null,
  crsEpsg: null,
  operatorApproved: false,
  createdAt: stamp,
  updatedAt: stamp,
});

run('persistence over the real API', () => {
  it('claims the workspace, writes, reloads and protects history', async () => {
    const status = await fetchWorkspaceStatus();
    expect(status).not.toBeNull();
    expect(status?.claimed).toBe(false);
    expect(status?.isMember).toBe(false);

    const claimed = await claimWorkspace(status!.businessId);
    expect(claimed).toBe(true);

    const empty = await loadWorkspace();
    expect(empty.company.displayName).toBe("Mitchell's Metal Roofing");
    expect(empty.customers).toHaveLength(0);
    expect(empty.catalogue).toHaveLength(2);
    expect(empty.catalogue.every((profile) => profile.priceBasis === 'SYNTHETIC')).toBe(true);
    expect(empty.catalogue.every((profile) => profile.verificationState === 'PLACEHOLDER')).toBe(true);

    // Customer and job, exactly as the store's diff would send them.
    const firstWrite = withRecords(empty);
    await persistStateChange(empty, firstWrite);

    const afterFirst = await loadWorkspace();
    expect(afterFirst.customers).toHaveLength(1);
    expect(afterFirst.jobs).toHaveLength(1);
    expect(afterFirst.jobs[0].jobNumber).toBe('J-0001');

    // Roof geometry, evidence, measurement, quote and invoice in one further change.
    const full: AppState = {
      ...afterFirst,
      planes: [
        {
          id: 'cccccccc-1111-4111-8111-000000000001',
          jobId: job.id,
          ref: 'P1',
          xMm: 0,
          yMm: 0,
          widthMm: 6000,
          lengthMm: 3600,
          pitchMicrodeg: 22_500_000,
        },
      ],
      flashings: [{ id: 'dddddddd-1111-4111-8111-000000000001', jobId: job.id, kind: 'ridge', lengthMm: 12_000, source: 'ENTERED' }],
      evidence: [
        {
          id: 'abababab-1111-4111-8111-000000000001',
          jobId: job.id,
          sourceKind: 'manual',
          note: 'Tape measure, two passes',
          accuracyClaimMm: 5,
          accuracyBasis: 'verified_by_test',
          isVerified: true,
          createdAt: stamp,
        },
      ],
      measurements: [
        {
          id: 'bcbcbcbc-1111-4111-8111-000000000001',
          jobId: job.id,
          evidenceId: 'abababab-1111-4111-8111-000000000001',
          kind: 'control_dimension',
          label: 'Eave to ridge',
          valueMm: 3600,
          toleranceMm: 5,
          grade: 'ORDER_GRADE',
          isActive: true,
          createdAt: stamp,
        },
      ],
      quotes: [quote],
      invoices: [invoice],
    };
    await persistStateChange(afterFirst, full);

    const reloaded = await loadWorkspace();
    expect(reloaded.planes).toHaveLength(1);
    expect(reloaded.flashings).toHaveLength(1);
    expect(reloaded.evidence).toHaveLength(1);
    expect(reloaded.measurements).toHaveLength(1);
    expect(reloaded.quotes).toHaveLength(1);
    expect(reloaded.invoices).toHaveLength(1);
    expect(reloaded.quotes[0].totals).toEqual(quote.totals);
    expect(reloaded.quotes[0].lines).toEqual(quote.lines);
    expect(reloaded.invoices[0].totals).toEqual(invoice.totals);
    expect(reloaded.measurements[0].valueMm).toBe(3600);
    expect(reloaded.measurements[0].grade).toBe('ORDER_GRADE');

    // A second load is a refresh: the same records must come back, unchanged.
    const refreshed = await loadWorkspace();
    expect(refreshed.quotes.map((doc) => doc.fingerprint)).toEqual(reloaded.quotes.map((doc) => doc.fingerprint));
    expect(refreshed.customers[0].id).toBe(customer.id);

    // Superseding a measurement is allowed; rewriting it is not.
    const superseded: AppState = {
      ...refreshed,
      measurements: refreshed.measurements.map((measurement) => ({ ...measurement, isActive: false })),
    };
    await persistStateChange(refreshed, superseded);
    const afterSupersede = await loadWorkspace();
    expect(afterSupersede.measurements[0].isActive).toBe(false);

    const rewritten: AppState = {
      ...afterSupersede,
      measurements: afterSupersede.measurements.map((measurement) => ({ ...measurement, valueMm: 9999 })),
    };
    await expect(persistStateChange(afterSupersede, rewritten)).rejects.toThrow(/supersede it/i);

    // An issued quote cannot have its lines rewritten.
    const tampered: AppState = {
      ...afterSupersede,
      quotes: afterSupersede.quotes.map((document) => ({ ...document, lines: [] })),
    };
    await expect(persistStateChange(afterSupersede, tampered)).rejects.toThrow(/acceptance status/i);

    // Accepting a quote is still permitted.
    const accepted: AppState = {
      ...afterSupersede,
      quotes: afterSupersede.quotes.map((document) => ({ ...document, status: 'accepted' as const })),
    };
    await persistStateChange(afterSupersede, accepted);
    const afterAccept = await loadWorkspace();
    expect(afterAccept.quotes[0].status).toBe('accepted');
  });

  it('enforces allocation limits and freezes issued documents in the database', async () => {
    const state = await loadWorkspace();
    const issuedInvoice = state.invoices.find((candidate) => candidate.id === invoice.id);
    expect(issuedInvoice).toBeDefined();

    const payment: Payment = {
      id: '99999999-1111-4111-8111-000000000001',
      jobId: job.id,
      amountCents: 1000,
      receivedAt: stamp,
      method: 'bank_transfer',
      reference: 'INTEG-1',
      idempotencyKey: 'integ-1',
      createdAt: stamp,
    };
    const withPayment: AppState = { ...state, payments: [payment] };
    await persistStateChange(state, withPayment);

    const allocation: Allocation = {
      id: '88888888-1111-4111-8111-000000000001',
      paymentId: payment.id,
      invoiceId: invoice.id,
      amountCents: 600,
      createdAt: stamp,
    };
    const allocated: AppState = { ...withPayment, allocations: [allocation] };
    await persistStateChange(withPayment, allocated);

    const reloaded = await loadWorkspace();
    expect(reloaded.allocations.map((row) => row.amountCents)).toEqual([600]);

    // The browser would refuse this too; here the database has to.
    const overAllocated: AppState = {
      ...allocated,
      allocations: [...allocated.allocations, { ...allocation, id: '88888888-1111-4111-8111-000000000002', amountCents: 600 }],
    };
    await expect(persistStateChange(allocated, overAllocated)).rejects.toThrow(/unallocated on payment/i);

    // A draft invoice is not a payment target.
    const draftInvoice: Invoice = {
      ...invoice,
      id: 'ffffffff-1111-4111-8111-000000000002',
      number: 'INV-0002',
      status: 'draft',
      issuedAt: null,
      dueDate: null,
      snapshot: null,
      fingerprint: '',
    };
    const withDraft: AppState = { ...allocated, invoices: [...allocated.invoices, draftInvoice] };
    await persistStateChange(allocated, withDraft);

    const toDraft: AppState = {
      ...withDraft,
      allocations: [...withDraft.allocations, { ...allocation, id: '88888888-1111-4111-8111-000000000003', invoiceId: draftInvoice.id }],
    };
    await expect(persistStateChange(withDraft, toDraft)).rejects.toThrow(/only an issued invoice/i);

    // An issued document's snapshot is written once and then frozen.
    const snapshotted: Invoice = {
      ...draftInvoice,
      id: 'ffffffff-1111-4111-8111-000000000003',
      number: 'INV-0003',
      status: 'issued',
      issuedAt: stamp,
      dueDate: '2026-12-10T00:00:00.000Z',
    };
    const snapshot = captureInvoiceSnapshot({
      invoice: snapshotted,
      job,
      customer,
      company: state.company,
      catalogueVerified: false,
    });
    const issuedWithSnapshot: Invoice = { ...snapshotted, snapshot, fingerprint: snapshot.fingerprint };
    const withIssued: AppState = { ...withDraft, invoices: [...withDraft.invoices, issuedWithSnapshot] };
    await persistStateChange(withDraft, withIssued);

    const stored = (await loadWorkspace()).invoices.find((candidate) => candidate.id === issuedWithSnapshot.id);
    expect(stored?.snapshot?.fingerprint).toBe(snapshot.fingerprint);
    expect(stored?.snapshot?.business).toEqual(snapshot.business);
    expect(stored?.snapshot?.customer).toEqual(snapshot.customer);

    const rewritten: AppState = {
      ...withIssued,
      invoices: withIssued.invoices.map((candidate) =>
        candidate.id === issuedWithSnapshot.id
          ? { ...candidate, snapshot: { ...snapshot, customer: { ...snapshot.customer, name: 'Rewritten Customer' } } }
          : candidate,
      ),
    };
    await expect(persistStateChange(withIssued, rewritten)).rejects.toThrow(/cannot change/i);
  });

  it('applies a whole save, inserts and deletes included', async () => {
    const before = await loadWorkspace();

    const newCustomer = atomicCustomer('a0a0a0a0-2222-4222-8222-000000000001', 'Atomic Customer');
    const newJob = atomicJob('b0b0b0b0-2222-4222-8222-000000000001', newCustomer.id, 'J-9001');
    const newPlane: Plane = {
      id: 'c0c0c0c0-2222-4222-8222-000000000001',
      jobId: newJob.id,
      ref: 'P1',
      xMm: 0,
      yMm: 0,
      widthMm: 6000,
      lengthMm: 3600,
      pitchMicrodeg: 22_500_000,
    };

    const saved: AppState = {
      ...before,
      customers: [...before.customers, newCustomer],
      jobs: [...before.jobs, newJob],
      planes: [...before.planes, newPlane],
    };
    await persistStateChange(before, saved);

    const afterSave = await loadWorkspace();
    expect(afterSave.customers.some((row) => row.id === newCustomer.id)).toBe(true);
    expect(afterSave.jobs.some((row) => row.id === newJob.id)).toBe(true);
    expect(afterSave.planes.some((row) => row.id === newPlane.id)).toBe(true);

    // The same path removes a record, so deletes are exercised too.
    const removed: AppState = { ...afterSave, planes: afterSave.planes.filter((row) => row.id !== newPlane.id) };
    await persistStateChange(afterSave, removed);
    expect((await loadWorkspace()).planes.some((row) => row.id === newPlane.id)).toBe(false);
  });

  it('rolls back the earlier tables when a later record in the same save is refused', async () => {
    const before = await loadWorkspace();
    const beforeFingerprint = stateFingerprint(before);

    const newCustomer = atomicCustomer('a0a0a0a0-2222-4222-8222-000000000002', 'Atomic Rollback Customer');
    const newJob = atomicJob('b0b0b0b0-2222-4222-8222-000000000002', newCustomer.id, 'J-9002');
    const newEvidence: Evidence = {
      id: 'd0d0d0d0-2222-4222-8222-000000000002',
      jobId: newJob.id,
      sourceKind: 'manual',
      note: 'Written before the refusal.',
      accuracyClaimMm: 5,
      accuracyBasis: 'operator_estimate',
      isVerified: false,
      createdAt: stamp,
    };
    const refused: Measurement = {
      id: 'e0e0e0e0-2222-4222-8222-000000000002',
      jobId: newJob.id,
      evidenceId: newEvidence.id,
      kind: 'control_dimension',
      label: 'Impossible dimension',
      valueMm: 0,
      toleranceMm: 5,
      grade: 'ESTIMATE_GRADE',
      isActive: true,
      createdAt: stamp,
    };

    const broken: AppState = {
      ...before,
      customers: [...before.customers, newCustomer],
      jobs: [...before.jobs, newJob],
      evidence: [...before.evidence, newEvidence],
      measurements: [...before.measurements, refused],
    };

    const error = await persistStateChange(before, broken).catch((reason: unknown) => reason as Error);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/Saving the workspace/);
    expect(error.message).toMatch(/measurements/);
    expect(error.message).toMatch(/value_mm/i);

    const after = await loadWorkspace();
    expect(after.customers.some((row) => row.id === newCustomer.id)).toBe(false);
    expect(after.jobs.some((row) => row.id === newJob.id)).toBe(false);
    expect(after.evidence.some((row) => row.id === newEvidence.id)).toBe(false);
    expect(stateFingerprint(after)).toBe(beforeFingerprint);
  });

  it('leaves the business record untouched when the save that changed it is refused', async () => {
    const before = await loadWorkspace();
    const beforeFingerprint = stateFingerprint(before);

    const broken: AppState = {
      ...before,
      company: { ...before.company, displayName: 'Should Not Persist', abn: '99999999999' },
      measurements: [
        ...before.measurements,
        {
          ...before.measurements[0],
          id: 'e0e0e0e0-2222-4222-8222-000000000003',
          valueMm: -5,
        },
      ],
    };

    await expect(persistStateChange(before, broken)).rejects.toThrow(/value_mm|check constraint/i);

    const after = await loadWorkspace();
    expect(after.company.displayName).toBe(before.company.displayName);
    expect(after.company.abn).toBe(before.company.abn);
    expect(stateFingerprint(after)).toBe(beforeFingerprint);
  });

  it('rolls back inserts, updates and deletes together when the save is refused', async () => {
    const before = await loadWorkspace();
    const beforeFingerprint = stateFingerprint(before);

    const updatedJob = before.jobs[0];
    const customerWithJobs = before.customers.find((row) => before.jobs.some((entry) => entry.customerId === row.id));
    expect(customerWithJobs).toBeDefined();

    const extraCustomer = atomicCustomer('a0a0a0a0-2222-4222-8222-000000000004', 'Inserted Before The Refusal');
    const broken: AppState = {
      ...before,
      customers: [...before.customers.filter((row) => row.id !== customerWithJobs!.id), extraCustomer],
      jobs: before.jobs.map((row) => (row.id === updatedJob.id ? { ...row, notes: 'Should not persist' } : row)),
    };

    await expect(persistStateChange(before, broken)).rejects.toThrow(/foreign key/i);

    const after = await loadWorkspace();
    expect(after.customers.some((row) => row.id === extraCustomer.id)).toBe(false);
    expect(after.customers.some((row) => row.id === customerWithJobs!.id)).toBe(true);
    expect(after.jobs.find((row) => row.id === updatedJob.id)?.notes).toBe(updatedJob.notes);
    expect(stateFingerprint(after)).toBe(beforeFingerprint);
  });

  it('refuses anonymous access to the same tables', async () => {
    if (!jwtSecret) {
      // The stack always provides it; guard so the suite is explicit rather than silent.
      expect(jwtSecret).toBeTruthy();
      return;
    }

    const crypto = await import('node:crypto');
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const header = encode({ alg: 'HS256', typ: 'JWT' });
    const payload = encode({ role: 'anon', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 600 });
    const signature = crypto.createHmac('sha256', jwtSecret).update(`${header}.${payload}`).digest('base64url');

    const anonymous = createClient(apiUrl as string, `${header}.${payload}.${signature}`, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const customers = await anonymous.from('customers').select('*');
    expect(customers.error ?? null).not.toBeNull();

    const jobs = await anonymous.from('jobs').select('*');
    expect(jobs.error ?? null).not.toBeNull();

    const invoices = await anonymous.from('invoices').select('*');
    expect(invoices.error ?? null).not.toBeNull();

    const write = await anonymous.from('customers').insert({ business_id: '00000000-0000-4000-8000-000000000001', name: 'Anon' });
    expect(write.error ?? null).not.toBeNull();
  });
});
