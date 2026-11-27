import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFRawStream } from 'pdf-lib';
import type { Company, Customer, Invoice, Job, Quote } from '@/data/types';
import {
  captureInvoiceSnapshot,
  captureQuoteSnapshot,
  documentFingerprint,
  invoiceDocument,
  quoteDocument,
  verifyDocument,
} from '@/lib/document';
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
  labourCostCentsPerM2: null,
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

const draftQuote: Quote = {
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
  fingerprint: '',
  snapshot: null,
  createdAt: '2026-11-20T02:15:00.000Z',
};

const draftInvoice: Invoice = {
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
  fingerprint: '',
  snapshot: null,
  createdAt: '2026-11-25T02:15:00.000Z',
};

const captureQuote = () => captureQuoteSnapshot({ quote: draftQuote, job, customer, company, catalogueVerified: false });
const captureInvoice = () =>
  captureInvoiceSnapshot({ invoice: draftInvoice, job, customer, company, catalogueVerified: false });

const quote: Quote = (() => {
  const snapshot = captureQuote();
  return { ...draftQuote, snapshot, fingerprint: snapshot.fingerprint };
})();

const invoice: Invoice = (() => {
  const snapshot = captureInvoice();
  return { ...draftInvoice, snapshot, fingerprint: snapshot.fingerprint };
})();

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
    expect(doc.snapshot).toBe('captured');
  });

  it('says plainly that unverified specifications are not for manufacture', () => {
    const doc = quoteDocument({ quote, job, customer, company, catalogueVerified: false });
    expect(doc.notes.join(' ')).toContain('not for manufacture');
    expect(doc.lines[0].unverified).toBe(true);
    expect(doc.lines[1].unverified).toBe(false);
    expect(doc.provenance).toEqual({ catalogueVerified: false, recordType: 'SYNTHETIC' });
  });

  it('warns when GST registration is unconfirmed', () => {
    const doc = quoteDocument({ quote, job, customer, company, catalogueVerified: true });
    expect(doc.notes.join(' ')).toContain('not a tax invoice');
  });

  it('marks synthetic records as not real customer records', () => {
    const doc = quoteDocument({ quote, job, customer, company, catalogueVerified: true });
    expect(doc.notes.join(' ')).toContain('Record type: SYNTHETIC');
    const real = quoteDocument({
      quote: { ...quote, snapshot: captureQuoteSnapshot({ quote: draftQuote, job: { ...job, sourceType: 'REAL' }, customer, company, catalogueVerified: true }) },
      job: { ...job, sourceType: 'REAL' },
      customer,
      company,
      catalogueVerified: true,
    });
    expect(real.notes.join(' ')).not.toContain('Record type');
  });

  it('issues a tax invoice only when GST applied, and records the balance', () => {
    const gstInvoice: Invoice = { ...invoice, totals: { subtotalCents: 368_304, gstCents: 36_830, totalCents: 405_134 } };
    const gstSnapshot = captureInvoiceSnapshot({
      invoice: gstInvoice,
      job,
      customer,
      company: { ...company, gstRegistered: true, gstRateConfirmed: true },
      catalogueVerified: false,
    });
    const doc = invoiceDocument({
      invoice: { ...gstInvoice, snapshot: gstSnapshot, fingerprint: gstSnapshot.fingerprint },
      job,
      customer,
      company: { ...company, gstRegistered: true, gstRateConfirmed: true },
      catalogueVerified: false,
      balanceCents: 205_134,
    });
    expect(doc.heading).toBe('TAX INVOICE');
    expect(doc.totals.gstApplied).toBe(true);
    expect(doc.balanceCents).toBe(205_134);

    const noGstInvoice: Invoice = { ...draftInvoice, gstRegisteredSnapshot: false };
    const noGstSnapshot = captureInvoiceSnapshot({ invoice: noGstInvoice, job, customer, company, catalogueVerified: false });
    const withoutGst = invoiceDocument({
      invoice: { ...noGstInvoice, snapshot: noGstSnapshot, fingerprint: noGstSnapshot.fingerprint },
      job,
      customer,
      company,
      catalogueVerified: false,
      balanceCents: null,
    });
    expect(withoutGst.heading).toBe('INVOICE');
  });

  it('keeps a voided invoice traceable without changing its issued content', () => {
    const doc = invoiceDocument({
      invoice: { ...invoice, status: 'voided', voidReason: 'Wrong site address' },
      job,
      customer,
      company,
      catalogueVerified: false,
      balanceCents: 0,
    });
    expect(doc.status).toEqual({ status: 'voided', voidReason: 'Wrong site address' });
    expect(doc.notes.join(' ')).not.toContain('voided');
    expect(documentFingerprint(doc)).toBe(invoice.snapshot?.fingerprint);
    expect(verifyDocument(doc)).toBe(true);
  });
});

describe('issued documents are frozen at issue', () => {
  it('renders an issued quote from its snapshot, not from the live records', () => {
    const doc = quoteDocument({ quote, job, customer, company, catalogueVerified: false });
    expect(doc.snapshot).toBe('captured');
    expect(doc.business).toEqual(quote.snapshot?.business);
    expect(doc.customer).toEqual(quote.snapshot?.customer);
    expect(doc.job).toEqual(quote.snapshot?.job);
    expect(verifyDocument(doc)).toBe(true);
  });

  it('does not change when the business, customer and job records are edited afterwards', async () => {
    const before = await renderPdf(quoteDocument({ quote, job, customer, company, catalogueVerified: false }));

    const editedCompany: Company = {
      ...company,
      displayName: 'Mitchell Metal Roofing Pty Ltd',
      legalName: 'Mitchell Metal Roofing Pty Ltd',
      abn: '11 222 333 444',
      address: '99 Changed Road, Bendigo VIC 3550',
      email: 'accounts@example.invalid',
      phone: '03 5000 0000',
      gstRegistered: true,
      gstRateConfirmed: true,
    };
    const editedCustomer: Customer = {
      ...customer,
      name: 'A Different Customer',
      contactName: 'Someone Else',
      address: '1 Somewhere Else, Bendigo VIC 3550',
      phone: '0400 999 999',
    };
    const editedJob: Job = { ...job, title: 'Renamed job', siteAddress: '1 Somewhere Else', jobNumber: 'J-9999' };

    const after = await renderPdf(
      quoteDocument({ quote, job: editedJob, customer: editedCustomer, company: editedCompany, catalogueVerified: true }),
    );

    expect(pdfText(await PDFDocument.load(after))).toBe(pdfText(await PDFDocument.load(before)));

    const reprinted = quoteDocument({
      quote,
      job: editedJob,
      customer: editedCustomer,
      company: editedCompany,
      catalogueVerified: true,
    });
    expect(documentFingerprint(reprinted)).toBe(quote.snapshot?.fingerprint);
    expect(verifyDocument(reprinted)).toBe(true);
  });

  it('does not rewrite historical provenance when the catalogue is verified later', () => {
    const reprinted = quoteDocument({ quote, job, customer, company, catalogueVerified: true });
    expect(reprinted.notes.join(' ')).toContain('unverified product specification');
    expect(reprinted.provenance.catalogueVerified).toBe(false);
    expect(verifyDocument(reprinted)).toBe(true);
  });

  it('shows a current outstanding balance separately from the issued amount', () => {
    const doc = invoiceDocument({ invoice, job, customer, company, catalogueVerified: false, balanceCents: 100_000 });
    expect(doc.totals.totalCents).toBe(368_304);
    expect(doc.balanceCents).toBe(100_000);
    expect(documentFingerprint(doc)).toBe(invoice.snapshot?.fingerprint);
  });

  it('detects tampering with the stored snapshot', () => {
    const tampered: Invoice = {
      ...invoice,
      snapshot: { ...invoice.snapshot!, customer: { ...invoice.snapshot!.customer, name: 'Forged Customer' } },
    };
    const doc = invoiceDocument({ invoice: tampered, job, customer, company, catalogueVerified: false, balanceCents: null });
    expect(doc.customer.name).toBe('Forged Customer');
    expect(verifyDocument(doc)).toBe(false);
  });

  it('labels a document issued before snapshots existed as legacy and says so in the PDF', async () => {
    const legacy: Quote = { ...draftQuote, fingerprint: 'legacy-narrow-fingerprint', snapshot: null };
    const doc = quoteDocument({ quote: legacy, job, customer, company, catalogueVerified: false });
    expect(doc.snapshot).toBe('legacy');
    expect(verifyDocument(doc)).toBe(false);

    const text = pdfText(await PDFDocument.load(await renderPdf(doc)));
    expect(text).toContain('issued before snapshots were captured');
    expect(text).toContain('not captured at issue');
  });

  it('leaves a draft unfrozen so it can still follow the live records', () => {
    const draft: Quote = { ...draftQuote, status: 'draft', issuedAt: null, snapshot: null };
    const doc = quoteDocument({ quote: draft, job, customer, company, catalogueVerified: false });
    expect(doc.snapshot).toBe('draft');
    expect(doc.customer.name).toBe(customer.name);
  });

  it('covers the whole customer-visible document in the fingerprint', () => {
    const base = captureQuoteSnapshot({ quote: draftQuote, job, customer, company, catalogueVerified: false });
    const otherCustomer = captureQuoteSnapshot({
      quote: draftQuote,
      job,
      customer: { ...customer, address: '3 Other Street' },
      company,
      catalogueVerified: false,
    });
    const otherBusiness = captureQuoteSnapshot({
      quote: draftQuote,
      job,
      customer,
      company: { ...company, abn: '11 222 333 444' },
      catalogueVerified: false,
    });
    const otherProvenance = captureQuoteSnapshot({ quote: draftQuote, job, customer, company, catalogueVerified: true });

    expect(base.fingerprint).not.toBe(otherCustomer.fingerprint);
    expect(base.fingerprint).not.toBe(otherBusiness.fingerprint);
    expect(base.fingerprint).not.toBe(otherProvenance.fingerprint);
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
    expect(content).toContain(`Stored fingerprint ${quote.snapshot?.fingerprint}`);
  });

  it('paginates a long bill of materials instead of overflowing', async () => {
    const longLines = Array.from({ length: 90 }, (_, index) => ({
      key: `line-${index}`,
      description: `Cut sheet ${index + 1} — 3700 mm, corrugated, unverified specification`,
      qtyMicro: 1_000_000,
      unit: 'ea',
      unitPriceCents: 10_869,
      isPlaceholder: true,
    }));
    const longQuote: Quote = { ...draftQuote, lines: longLines };
    const snapshot = captureQuoteSnapshot({ quote: longQuote, job, customer, company, catalogueVerified: false });
    const doc = quoteDocument({
      quote: { ...longQuote, snapshot, fingerprint: snapshot.fingerprint },
      job,
      customer,
      company,
      catalogueVerified: false,
    });
    const bytes = await renderPdf(doc);
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBeGreaterThan(1);
  });
});
