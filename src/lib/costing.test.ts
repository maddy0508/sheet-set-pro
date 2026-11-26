import { describe, expect, it } from 'vitest';
import type { Allocation, Company, Invoice } from '@/data/types';
import type { BomLine } from '@/domain/types';
import { jobCosting } from '@/lib/costing';

const company: Company = {
  id: 'c',
  displayName: "Mitchell's Metal Roofing",
  legalName: null,
  abn: null,
  gstRegistered: true,
  gstRateBp: 1000,
  gstRateConfirmed: true,
  address: null,
  email: null,
  phone: null,
  labourRateCentsPerM2: 4500,
  labourCostCentsPerM2: 1800,
  defaultMarginBp: 2500,
};

const bom: BomLine[] = [
  { key: 'sheet', description: 'Sheet 3700', category: 'sheet', quantityMicro: 16_000_000, unit: 'ea', unitPriceCents: 10_869, isPlaceholder: true },
  { key: 'ridge', description: 'Ridge flashing', category: 'flashing', quantityMicro: 12_000_000, unit: 'm', unitPriceCents: 4_700, isPlaceholder: true },
];

const invoice = (overrides: Partial<Invoice> = {}): Invoice => ({
  id: 'i1',
  jobId: 'j1',
  number: 'INV-0001',
  quoteId: null,
  status: 'issued',
  lines: [],
  totals: { subtotalCents: 560_144, gstCents: 56_014, totalCents: 616_158 },
  gstRegisteredSnapshot: true,
  gstRateBp: 1000,
  issuedAt: '2026-11-20T00:00:00.000Z',
  dueDate: null,
  voidReason: null,
  fingerprint: 'abc',
  createdAt: '2026-11-20T00:00:00.000Z',
  ...overrides,
});

const allocation: Allocation = {
  id: 'a1',
  paymentId: 'p1',
  invoiceId: 'i1',
  amountCents: 300_000,
  createdAt: '2026-11-21T00:00:00.000Z',
};

describe('job costing', () => {
  it('costs materials from catalogue cost prices and labour from the cost rate', () => {
    const result = jobCosting({ areaMm2: 43_200_000, bomLines: bom, invoices: [invoice()], allocations: [allocation], company });
    expect(result.materialCostCents).toBe(173_904 + 56_400);
    expect(result.labourCostCents).toBe(77_760);
    expect(result.totalCostCents).toBe(308_064);
    expect(result.revenueCents).toBe(560_144);
    expect(result.profitCents).toBe(252_080);
    expect(result.marginBp).toBe(4_500);
  });

  it('reports profit as unknown, not zero, when no labour cost is recorded', () => {
    const result = jobCosting({
      areaMm2: 43_200_000,
      bomLines: bom,
      invoices: [invoice()],
      allocations: [],
      company: { ...company, labourCostCentsPerM2: null },
    });
    expect(result.labourCostCents).toBeNull();
    expect(result.totalCostCents).toBeNull();
    expect(result.profitCents).toBeNull();
    expect(result.marginBp).toBeNull();
    expect(result.caveats.join(' ')).toContain('No labour cost rate');
  });

  it('counts revenue from issued invoices only, and outstanding from allocations', () => {
    const result = jobCosting({
      areaMm2: 43_200_000,
      bomLines: bom,
      invoices: [
        invoice(),
        invoice({ id: 'i2', status: 'draft', totals: { subtotalCents: 100_000, gstCents: 10_000, totalCents: 110_000 } }),
        invoice({ id: 'i3', status: 'voided', totals: { subtotalCents: 999_999, gstCents: 0, totalCents: 999_999 } }),
      ],
      allocations: [allocation, { ...allocation, id: 'a2', invoiceId: 'i3', amountCents: 50_000 }],
      company,
    });
    expect(result.revenueCents).toBe(560_144);
    expect(result.invoicedCents).toBe(616_158);
    expect(result.receivedCents).toBe(300_000);
    expect(result.outstandingCents).toBe(316_158);
  });

  it('flags synthetic pricing and missing invoicing rather than hiding them', () => {
    const result = jobCosting({ areaMm2: 43_200_000, bomLines: bom, invoices: [], allocations: [], company });
    expect(result.indicative).toBe(true);
    expect(result.caveats.join(' ')).toContain('synthetic or unverified');
    expect(result.caveats.join(' ')).toContain('Nothing has been invoiced');
  });
});
