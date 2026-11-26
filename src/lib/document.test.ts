import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFRawStream } from 'pdf-lib';
import type { Company, Customer, Invoice, Job, Quote } from '@/data/types';
import { invoiceDocument, quoteDocument } from '@/lib/document';
import { renderPdf } from '@/lib/pdf';

const company: Company = {
  id: 'company-1',
  displayName: "Mitchell's Metal Roofing",
  legalName: null,
  abn: null,
  gstRegistered: null,
  gstRateBp: 1000,
  gstRateConfirmed: false,
  address: null,
  email: null,
  phone: null,
  labourRateCentsPerM2: 4500,
  defaultMarginBp: 2500,
};

const customer: Customer = {
  id: 'c1',
  name: 'Hargreaves Constructions',
  contactName: 'Dana Hargreaves',
  email: 'dana@example.invalid',
  phone: '0400 000 000',
  address: '12 Bright Street, Bendigo VIC 3550',
  notes: '',
  sourceType: 'SYNTHETIC',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

const job: Job = {
  id: 'j1',
  customerId: 'c1',
  jobNumber: 'J-0007',
  title: 'Bright Street re-roof',
  siteAddress: '12 Bright Street, Bendigo VIC 3550',
  status: 'quoted',
  notes: '',
  sourceType: 'SYNTHETIC',
  profileId: 'cat-syn-1',
  crsEpsg: 7855,
  operatorApproved: false,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

const lines = [
  {
    key: 'sheet-3700',
    description: 'Synthetic Corrugated 0.42 sheet — 3700 mm',
    qtyMicro: 16_000_000,
    unit: 'ea',
    unitPriceCents: 10_869,
    isPlaceholder: true,
  },
  {
    key: 'labour',
    description: 'Installation labour',
    qtyMicro: 43_200_000,
    unit: 'm²',
    unitPriceCents: 4_500,
    isPlaceholder: false,
  },
];

const totals = { subtotalCents: 368_304, gstCents: 0, totalCents: 368_304 };

const quote: Quote = {
  id: 'q1',
  jobId: 'j1',
  number: 'Q-0003',
  revision: 1,
  status: 'issued',
  lines,
  totals,
  gstApplied: false,
  gstRateBp: 1000,
  issuedAt: '2026-11-20T02:15:00.000Z',
  validUntil: '2026-12-20',
  fingerprint: '0f34ab679bc11490',
  createdAt: '2026-11-20T02:15:00.000Z',
};

const invoice: Invoice = {
  id: 'i1',
  jobId: 'j1',
  number: 'INV-0003',
  quoteId: 'q1',
  status: 'issued',
  lines,
  totals,
  gstRegisteredSnapshot: true,
  gstRateBp: 1000,
  issuedAt: '2026-11-25T02:15:00.000Z',
  dueDate: '2026-12-09T02:15:00.000Z',
  voidReason: null,
  fingerprint: '1e20af4bddf080a6',
  createdAt: '2026-11-25T02:15:00.000Z',
};

/** Decompresses every stream and returns the text operators, so assertions read real content. */
function pdfText(document: PDFDocument): string {
  const decoder = new TextDecoder('latin1');
  const parts: string[] = [];
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    if (object instanceof PDFRawStream) {
      try {
        parts.push(decoder.decode(inflateSync(object.contents)));
      } catch {
        // Fonts and images are not Flate-encoded text streams.
      }
    }
  }
  const raw = parts.join('\n');
  // pdf-lib writes text as hex strings: <512D30303033> Tj
  return raw.replace(/<([0-9A-Fa-f\s]+)>\s*Tj/g, (_match, hex: string) =>
    Buffer.from(hex.replace(/\s+/g, ''), 'hex').toString('latin1'),
  );
}

describe('commercial documents', () => {
  it('keeps quote totals, dates and parties exactly as stored', () => {
    const doc = quoteDocument({ quote, job, customer, company, catalogueVerified: false });
    expect(doc.heading).toBe('QUOTATION');
    expect(doc.number).toBe('Q-0003');
    expect(doc.validUntil).toBe('2026-12-20');
    expect(doc.dueDate).toBeNull();
    expect(doc.customer.name).toBe('Hargreaves Constructions');
    expect(doc.totals.totalCents).toBe(368_304);
    expect(doc.lines[0].amountCents).toBe(173_904);
    expect(doc.balanceCents).toBeNull();
  });

  it('says plainly that unverified specifications are not for manufacture', () => {
    const doc = quoteDocument({ quote, job, customer, company, catalogueVerified: false });
    expect(doc.notes.join(' ')).toContain('not for manufacture');
    expect(doc.lines[0].unverified).toBe(true);
    expect(doc.lines[1].unverified).toBe(false);
  });

  it('warns when GST registration is unconfirmed', () => {
    const doc = quoteDocument({ quote, job, customer, company, catalogueVerified: true });
    expect(doc.notes.join(' ')).toContain('not a tax invoice');
  });

  it('marks synthetic records as not real customer records', () => {
    const doc = quoteDocument({ quote, job, customer, company, catalogueVerified: true });
    expect(doc.notes.join(' ')).toContain('Record type: SYNTHETIC');
    const real = quoteDocument({ quote, job: { ...job, sourceType: 'REAL' }, customer, company, catalogueVerified: true });
    expect(real.notes.join(' ')).not.toContain('Record type');
  });

  it('issues a tax invoice only when GST applied, and records the balance', () => {
    const gstInvoice: Invoice = { ...invoice, totals: { subtotalCents: 368_304, gstCents: 36_830, totalCents: 405_134 } };
    const doc = invoiceDocument({
      invoice: gstInvoice,
      job,
      customer,
      company: { ...company, gstRegistered: true, gstRateConfirmed: true },
      catalogueVerified: false,
      balanceCents: 205_134,
    });
    expect(doc.heading).toBe('TAX INVOICE');
    expect(doc.totals.gstApplied).toBe(true);
    expect(doc.balanceCents).toBe(205_134);

    const withoutGst = invoiceDocument({
      invoice: { ...invoice, gstRegisteredSnapshot: false },
      job,
      customer,
      company,
      catalogueVerified: false,
      balanceCents: null,
    });
    expect(withoutGst.heading).toBe('INVOICE');
  });

  it('keeps a voided invoice traceable', () => {
    const doc = invoiceDocument({
      invoice: { ...invoice, status: 'voided', voidReason: 'Wrong site address' },
      job,
      customer,
      company,
      catalogueVerified: false,
      balanceCents: 0,
    });
    expect(doc.notes.join(' ')).toContain('voided: Wrong site address');
  });
});

describe('pdf rendering', () => {
  it('produces a readable PDF carrying the document content', async () => {
    const doc = quoteDocument({ quote, job, customer, company, catalogueVerified: false });
    const bytes = await renderPdf(doc);

    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(parsed.getTitle()).toBe('QUOTATION Q-0003');

    const content = pdfText(parsed);
    expect(content).toContain('Q-0003');
    expect(content).toContain('Hargreaves Constructions');
    expect(content).toContain('Total');
    expect(content).toContain('Document fingerprint');
  });

  it('paginates a long bill of materials instead of overflowing', async () => {
    const longQuote: Quote = {
      ...quote,
      lines: Array.from({ length: 90 }, (_, index) => ({
        key: `line-${index}`,
        description: `Cut sheet ${index + 1} — 3700 mm, corrugated, unverified specification`,
        qtyMicro: 1_000_000,
        unit: 'ea',
        unitPriceCents: 10_869,
        isPlaceholder: true,
      })),
    };
    const doc = quoteDocument({ quote: longQuote, job, customer, company, catalogueVerified: false });
    const bytes = await renderPdf(doc);
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBeGreaterThan(1);
  });
});
