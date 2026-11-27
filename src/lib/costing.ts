import type { Company, Invoice, Allocation } from '@/data/types';
import type { BomLine } from '@/domain/types';
import { MM_PER_M } from '@/domain/units';

export type JobCosting = {
  /** Supplier cost of the bill of materials, at catalogue cost prices. */
  materialCostCents: number;
  /** Internal labour cost, or null when the business has not recorded a cost rate. */
  labourCostCents: number | null;
  /** Total cost, or null when a cost component is unknown. Never a zero stand-in. */
  totalCostCents: number | null;
  /** Issued invoices, excluding GST. A quote is not revenue until it is invoiced. */
  revenueCents: number;
  /** Issued invoices including GST. */
  invoicedCents: number;
  receivedCents: number;
  outstandingCents: number;
  /** Revenue less cost. Null when cost is unknown. */
  profitCents: number | null;
  /** Profit as a share of revenue, in basis points. Null when cost or revenue is unknown. */
  marginBp: number | null;
  /** True when the bill of materials was priced from synthetic or unverified data. */
  indicative: boolean;
  /** Reasons the figures cannot be treated as final. */
  caveats: string[];
};

const emptyCosting = (): JobCosting => ({
  materialCostCents: 0,
  labourCostCents: null,
  totalCostCents: null,
  revenueCents: 0,
  invoicedCents: 0,
  receivedCents: 0,
  outstandingCents: 0,
  profitCents: null,
  marginBp: null,
  indicative: false,
  caveats: [],
});

export function jobCosting(params: {
  areaMm2: number;
  bomLines: BomLine[];
  invoices: Invoice[];
  allocations: Allocation[];
  company: Company;
}): JobCosting {
  const { areaMm2, bomLines, invoices, allocations, company } = params;
  const result = emptyCosting();

  const issued = invoices.filter((invoice) => invoice.status === 'issued');
  const issuedIds = new Set(issued.map((invoice) => invoice.id));

  result.materialCostCents = bomLines.reduce(
    (sum, line) => sum + Math.round((line.quantityMicro * line.unitPriceCents) / 1_000_000),
    0,
  );
  result.indicative = bomLines.some((line) => line.isPlaceholder);

  const areaM2Micro = Math.round((areaMm2 / (MM_PER_M * MM_PER_M)) * 1_000_000);
  result.labourCostCents =
    company.labourCostCentsPerM2 === null ? null : Math.round((areaM2Micro * company.labourCostCentsPerM2) / 1_000_000);

  result.totalCostCents = result.labourCostCents === null ? null : result.materialCostCents + result.labourCostCents;

  result.revenueCents = issued.reduce((sum, invoice) => sum + invoice.totals.subtotalCents, 0);
  result.invoicedCents = issued.reduce((sum, invoice) => sum + invoice.totals.totalCents, 0);
  result.receivedCents = allocations
    .filter((allocation) => issuedIds.has(allocation.invoiceId))
    .reduce((sum, allocation) => sum + allocation.amountCents, 0);
  result.outstandingCents = result.invoicedCents - result.receivedCents;

  if (result.totalCostCents !== null) {
    result.profitCents = result.revenueCents - result.totalCostCents;
    result.marginBp =
      result.revenueCents === 0 ? null : Math.round((result.profitCents * 10_000) / result.revenueCents);
  }

  if (bomLines.length === 0) result.caveats.push('No bill of materials yet, so cost is not costed.');
  if (result.indicative) result.caveats.push('Priced from a synthetic or unverified specification. Treat the figures as indicative.');
  if (company.labourCostCentsPerM2 === null) {
    result.caveats.push('No labour cost rate is recorded, so profit cannot be stated. Set it in Settings.');
  }
  if (issued.length === 0) result.caveats.push('Nothing has been invoiced yet, so there is no revenue to measure against.');

  return result;
}
