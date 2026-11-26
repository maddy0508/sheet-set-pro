import { fingerprint } from '@/domain/units';
import type { Company, Customer, DocLine, Invoice, Job, Quote } from '@/data/types';

/**
 * A commercial document reduced to what a customer sees. Numbers stay as integers
 * (cents, micro-quantities) so the renderer formats them and the tests can assert them.
 */
export type CommercialDocument = {
  kind: 'QUOTE' | 'INVOICE';
  heading: string;
  number: string;
  status: string;
  issuedAt: string | null;
  validUntil: string | null;
  dueDate: string | null;
  business: { name: string; detail: string[] };
  customer: { name: string; detail: string[] };
  job: { title: string; site: string; number: string };
  lines: {
    description: string;
    qtyMicro: number;
    unit: string;
    unitPriceCents: number;
    amountCents: number;
    unverified: boolean;
  }[];
  totals: { subtotalCents: number; gstCents: number; totalCents: number; gstApplied: boolean; gstRateBp: number };
  balanceCents: number | null;
  notes: string[];
  fingerprint: string;
};

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

export function quoteDocument(options: {
  quote: Quote;
  job: Job;
  customer: Customer | undefined;
  company: Company;
  catalogueVerified: boolean;
}): CommercialDocument {
  const { quote, job, customer, company } = options;
  const lines = pricedLines(quote.lines);
  return {
    kind: 'QUOTE',
    heading: 'QUOTATION',
    number: quote.number,
    status: quote.status,
    issuedAt: quote.issuedAt,
    validUntil: quote.validUntil,
    dueDate: null,
    business: businessBlock(company),
    customer: customerBlock(customer, job),
    job: { title: job.title, site: job.siteAddress || 'Site address not recorded', number: job.jobNumber },
    lines,
    totals: { ...quote.totals, gstApplied: quote.gstApplied, gstRateBp: quote.gstRateBp },
    balanceCents: null,
    notes: provenanceNotes({
      gstRegistered: company.gstRegistered,
      gstApplied: quote.gstApplied,
      catalogueVerified: options.catalogueVerified,
      sourceType: job.sourceType,
      kind: 'QUOTE',
    }),
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
  const { invoice, job, customer, company } = options;
  const gstApplied = invoice.gstRegisteredSnapshot === true;
  return {
    kind: 'INVOICE',
    heading: gstApplied ? 'TAX INVOICE' : 'INVOICE',
    number: invoice.number,
    status: invoice.status,
    issuedAt: invoice.issuedAt,
    validUntil: null,
    dueDate: invoice.dueDate,
    business: businessBlock(company),
    customer: customerBlock(customer, job),
    job: { title: job.title, site: job.siteAddress || 'Site address not recorded', number: job.jobNumber },
    lines: pricedLines(invoice.lines),
    totals: { ...invoice.totals, gstApplied, gstRateBp: invoice.gstRateBp },
    balanceCents: options.balanceCents,
    notes: [
      ...provenanceNotes({
        gstRegistered: invoice.gstRegisteredSnapshot,
        gstApplied,
        catalogueVerified: options.catalogueVerified,
        sourceType: job.sourceType,
        kind: 'INVOICE',
      }),
      ...(invoice.status === 'voided'
        ? [`This invoice was voided${invoice.voidReason ? `: ${invoice.voidReason}` : ''}. It is retained for the record and is not payable.`]
        : []),
    ],
    fingerprint: invoice.fingerprint,
  };
}

/**
 * The fingerprint stamped on the PDF. It covers the document's own content, so a
 * reprinted document can be checked against the stored one.
 */
export function documentFingerprint(doc: CommercialDocument): string {
  return fingerprint({
    kind: doc.kind,
    number: doc.number,
    issuedAt: doc.issuedAt,
    lines: doc.lines.map((line) => [line.description, line.qtyMicro, line.unitPriceCents]),
    totals: [doc.totals.subtotalCents, doc.totals.gstCents, doc.totals.totalCents],
    stored: doc.fingerprint,
  });
}
