import { fingerprint } from '@/domain/units';
import type { Company, Customer, DocLine, DocumentSnapshot, Invoice, Job, Quote } from '@/data/types';

/**
 * A commercial document reduced to what a customer sees. Numbers stay as integers
 * (cents, micro-quantities) so the renderer formats them and the tests can assert them.
 *
 * Fields are either frozen at issue (everything the customer reads) or current state
 * (payment status, outstanding balance, legacy warnings). Only the frozen fields are
 * fingerprinted, so a payment landing tomorrow does not invalidate a document issued today.
 */
export type CommercialDocument = {
  kind: 'QUOTE' | 'INVOICE';
  heading: string;
  number: string;
  issuedAt: string | null;
  validUntil: string | null;
  dueDate: string | null;
  business: { name: string; detail: string[] };
  customer: { name: string; detail: string[] };
  job: { title: string; site: string; number: string };
  lines: DocumentSnapshot['lines'];
  totals: DocumentSnapshot['totals'];
  notes: string[];
  provenance: DocumentSnapshot['provenance'];
  /** Current state, never part of the fingerprint. */
  status: { status: string; voidReason: string | null };
  balanceCents: number | null;
  /** Where the frozen content came from. `legacy` means the document predates snapshots. */
  snapshot: 'captured' | 'legacy' | 'draft';
  fingerprint: string;
};

type FrozenContent = Omit<DocumentSnapshot, 'version' | 'capturedAt' | 'fingerprint'>;

function businessBlock(company: Company): CommercialDocument['business'] {
  return {
    name: company.displayName,
    detail: [
      company.legalName && company.legalName !== company.displayName ? company.legalName : '',
      company.address ?? 'Business address not confirmed',
      company.abn ? `ABN ${company.abn}` : 'ABN not confirmed',
      [company.phone, company.email].filter(Boolean).join(' · ') || 'Contact details not confirmed',
    ].filter(Boolean),
  };
}

function customerBlock(customer: Customer | undefined, job: Job): CommercialDocument['customer'] {
  return {
    name: customer?.name ?? 'Customer not recorded',
    detail: [
      customer?.contactName ?? '',
      customer?.address || job.siteAddress || 'Site address not recorded',
      [customer?.phone, customer?.email].filter(Boolean).join(' · '),
    ].filter(Boolean),
  };
}

function jobBlock(job: Job): CommercialDocument['job'] {
  return { title: job.title, site: job.siteAddress || 'Site address not recorded', number: job.jobNumber };
}

function pricedLines(lines: DocLine[]): CommercialDocument['lines'] {
  return lines.map((line) => ({
    description: line.description,
    qtyMicro: line.qtyMicro,
    unit: line.unit,
    unitPriceCents: line.unitPriceCents,
    amountCents: Math.round((line.qtyMicro * line.unitPriceCents) / 1_000_000),
    unverified: line.isPlaceholder,
  }));
}

function provenanceNotes(options: {
  gstRegistered: boolean | null;
  gstApplied: boolean;
  catalogueVerified: boolean;
  sourceType: Job['sourceType'];
  kind: 'QUOTE' | 'INVOICE';
}): string[] {
  const notes: string[] = [];
  notes.push(
    options.catalogueVerified
      ? 'Quantities are calculated from a verified product specification.'
      : 'Quantities are calculated from an unverified product specification. They are not for manufacture.',
  );
  if (options.gstRegistered === null) {
    notes.push('GST registration is not confirmed. This document is not a tax invoice.');
  } else if (!options.gstApplied) {
    notes.push('GST has not been applied. The business is recorded as not registered for GST.');
  }
  if (options.kind === 'QUOTE') {
    notes.push('This quote is an offer. Prices are held until the valid-until date.');
  }
  if (options.sourceType !== 'REAL') {
    notes.push(`Record type: ${options.sourceType}. This document was produced from test data and is not a real customer record.`);
  }
  return notes;
}

function quoteContent(options: {
  quote: Quote;
  job: Job;
  customer: Customer | undefined;
  company: Company;
  catalogueVerified: boolean;
}): FrozenContent {
  const { quote, job, customer, company, catalogueVerified } = options;
  return {
    kind: 'QUOTE',
    heading: 'QUOTATION',
    number: quote.number,
    issuedAt: quote.issuedAt,
    validUntil: quote.validUntil,
    dueDate: null,
    business: businessBlock(company),
    customer: customerBlock(customer, job),
    job: jobBlock(job),
    lines: pricedLines(quote.lines),
    totals: { ...quote.totals, gstApplied: quote.gstApplied, gstRateBp: quote.gstRateBp },
    notes: provenanceNotes({
      gstRegistered: company.gstRegistered,
      gstApplied: quote.gstApplied,
      catalogueVerified,
      sourceType: job.sourceType,
      kind: 'QUOTE',
    }),
    provenance: { catalogueVerified, recordType: job.sourceType },
  };
}

function invoiceContent(options: {
  invoice: Invoice;
  job: Job;
  customer: Customer | undefined;
  company: Company;
  catalogueVerified: boolean;
}): FrozenContent {
  const { invoice, job, customer, company, catalogueVerified } = options;
  const gstApplied = invoice.gstRegisteredSnapshot === true;
  return {
    kind: 'INVOICE',
    heading: gstApplied ? 'TAX INVOICE' : 'INVOICE',
    number: invoice.number,
    issuedAt: invoice.issuedAt,
    validUntil: null,
    dueDate: invoice.dueDate,
    business: businessBlock(company),
    customer: customerBlock(customer, job),
    job: jobBlock(job),
    lines: pricedLines(invoice.lines),
    totals: { ...invoice.totals, gstApplied, gstRateBp: invoice.gstRateBp },
    notes: provenanceNotes({
      gstRegistered: invoice.gstRegisteredSnapshot,
      gstApplied,
      catalogueVerified,
      sourceType: job.sourceType,
      kind: 'INVOICE',
    }),
    provenance: { catalogueVerified, recordType: job.sourceType },
  };
}

function contentFingerprint(content: FrozenContent): string {
  return fingerprint(content);
}

/**
 * Captures what the customer will see, at the moment the document is issued. The store
 * calls this before the document is written, so the stored snapshot and the stored
 * fingerprint describe the same content by construction.
 */
export function captureQuoteSnapshot(options: {
  quote: Quote;
  job: Job;
  customer: Customer | undefined;
  company: Company;
  catalogueVerified: boolean;
}): DocumentSnapshot {
  const content = quoteContent(options);
  return { version: 1, capturedAt: new Date().toISOString(), ...content, fingerprint: contentFingerprint(content) };
}

export function captureInvoiceSnapshot(options: {
  invoice: Invoice;
  job: Job;
  customer: Customer | undefined;
  company: Company;
  catalogueVerified: boolean;
}): DocumentSnapshot {
  const content = invoiceContent(options);
  return { version: 1, capturedAt: new Date().toISOString(), ...content, fingerprint: contentFingerprint(content) };
}

function fromSnapshot(
  snapshot: DocumentSnapshot,
  current: Pick<CommercialDocument, 'status' | 'balanceCents'>,
  state: CommercialDocument['snapshot'],
): CommercialDocument {
  return {
    kind: snapshot.kind,
    heading: snapshot.heading,
    number: snapshot.number,
    issuedAt: snapshot.issuedAt,
    validUntil: snapshot.validUntil,
    dueDate: snapshot.dueDate,
    business: snapshot.business,
    customer: snapshot.customer,
    job: snapshot.job,
    lines: snapshot.lines,
    totals: snapshot.totals,
    notes: snapshot.notes,
    provenance: snapshot.provenance,
    status: current.status,
    balanceCents: current.balanceCents,
    snapshot: state,
    fingerprint: snapshot.fingerprint,
  };
}

/**
 * A quote as the customer sees it. An issued quote renders from its snapshot; a draft, or
 * a document issued before snapshots existed, renders from the records that are live now
 * and says which of those it is.
 */
export function quoteDocument(options: {
  quote: Quote;
  job: Job;
  customer: Customer | undefined;
  company: Company;
  catalogueVerified: boolean;
}): CommercialDocument {
  const { quote } = options;
  const status = { status: quote.status, voidReason: null };
  if (quote.snapshot) return fromSnapshot(quote.snapshot, { status, balanceCents: null }, 'captured');

  const content = quoteContent(options);
  return {
    ...content,
    status,
    balanceCents: null,
    snapshot: quote.issuedAt ? 'legacy' : 'draft',
    fingerprint: quote.fingerprint,
  };
}

export function invoiceDocument(options: {
  invoice: Invoice;
  job: Job;
  customer: Customer | undefined;
  company: Company;
  catalogueVerified: boolean;
  balanceCents: number | null;
}): CommercialDocument {
  const { invoice, balanceCents } = options;
  const status = { status: invoice.status, voidReason: invoice.voidReason };
  if (invoice.snapshot) return fromSnapshot(invoice.snapshot, { status, balanceCents }, 'captured');

  const content = invoiceContent(options);
  return {
    ...content,
    status,
    balanceCents,
    snapshot: invoice.issuedAt ? 'legacy' : 'draft',
    fingerprint: invoice.fingerprint,
  };
}

/**
 * The fingerprint of the frozen content: everything the customer reads, and nothing that
 * moves afterwards. It covers the business, customer and job blocks, every line, the
 * totals, the GST treatment and the provenance notes, so a reprint can be checked against
 * the document that was issued.
 */
export function documentFingerprint(doc: CommercialDocument): string {
  const content: FrozenContent = {
    kind: doc.kind,
    heading: doc.heading,
    number: doc.number,
    issuedAt: doc.issuedAt,
    validUntil: doc.validUntil,
    dueDate: doc.dueDate,
    business: doc.business,
    customer: doc.customer,
    job: doc.job,
    lines: doc.lines,
    totals: doc.totals,
    notes: doc.notes,
    provenance: doc.provenance,
  };
  return contentFingerprint(content);
}

/** True when the rendered content still matches the fingerprint stored at issue. */
export function verifyDocument(doc: CommercialDocument): boolean {
  return doc.fingerprint !== '' && documentFingerprint(doc) === doc.fingerprint;
}
