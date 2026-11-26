import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { AppState, Customer, Invoice, Job, Quote } from './types';
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
  createdAt: stamp,
};

function withRecords(state: AppState): AppState {
  return { ...state, customers: [customer], jobs: [job] };
}

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
