import type { CatalogueProfile, Company, Customer, Job } from '@/data/types';
import type { BomResult } from '@/domain/material';
import type { LayoutResult } from '@/domain/layout';
import type { BomCategory, SourceType } from '@/domain/types';
import { fingerprint } from '@/domain/units';

/**
 * The material order a supplier receives.
 *
 * It is built from the bill of materials, never from the screens: the lines, the product
 * specification and the calculation revision are copied across, so what the supplier is
 * asked to cut is exactly what was calculated. A specification that is not verified, a BOM
 * with a hole in it, or an outstanding order-grade condition marks the order NOT FOR
 * MANUFACTURE — it is still issued (a roofer needs to ask questions) but it cannot be
 * mistaken for a confirmed order.
 */

export type SupplierLineKind = BomCategory;

export type SupplierOrderLine = {
  key: string;
  kind: SupplierLineKind;
  item: string;
  detail: string[];
  /** Cut length for a sheet; null for anything measured in lineal metres or counted. */
  lengthMm: number | null;
  quantity: number;
  unit: 'ea' | 'm';
  verified: boolean;
  note: string | null;
};

export type SupplierOrder = {
  version: 1;
  heading: string;
  number: string;
  generatedAt: string;
  status: 'READY' | 'BLOCKED';
  supplier: { name: string | null; email: string | null; account: string | null; notes: string | null };
  deliverTo: {
    name: string;
    address: string | null;
    contact: string | null;
    phone: string | null;
    requiredBy: string | null;
  };
  job: { title: string; number: string; site: string };
  product: {
    manufacturer: string;
    profile: string;
    material: string;
    thickness: string | null;
    coating: string;
    colour: string | null;
    coverMm: number | null;
    maxLengthMm: number | null;
    catalogueRevision: string;
    verification: CatalogueProfile['verificationState'];
    sourceNote: string;
  };
  lines: SupplierOrderLine[];
  blockers: string[];
  /** Business facts nobody has supplied yet. Listed, never guessed. */
  placeholders: string[];
  provenance: {
    bomFingerprint: string;
    calcInputFingerprint: string | null;
    calcOutputFingerprint: string | null;
    engineVersion: string | null;
    totalSheets: number;
    totalSheetLengthMm: number;
    recordType: SourceType;
  };
  fingerprint: string;
};

export type SupplierOrderInput = {
  number: string;
  generatedAt: string;
  company: Company;
  customer: Customer | undefined;
  job: Job;
  profile: CatalogueProfile | null;
  bom: BomResult;
  layout: LayoutResult;
  calculation: { inputFingerprint: string; outputFingerprint: string; engineVersion: string } | null;
  orderBlockers: string[];
  colour: string | null;
  requiredBy: string | null;
};

function quantityOf(quantityMicro: number): number {
  return Math.round(quantityMicro / 1_000_000);
}

function lineFromBom(line: BomResult['lines'][number]): SupplierOrderLine {
  const detail: string[] = [];
  if (line.category === 'sheet' && line.lengthMm) detail.push(`Cut to ${line.lengthMm} mm`);
  if (line.category === 'flashing') detail.push('Lineal metres of finished run');

  return {
    key: line.key,
    kind: line.category,
    item: line.description,
    detail,
    lengthMm: line.category === 'sheet' ? (line.lengthMm ?? null) : null,
    quantity: quantityOf(line.quantityMicro),
    unit: line.unit === 'm' ? 'm' : 'ea',
    verified: !line.isPlaceholder,
    note: line.note ?? null,
  };
}

export function buildSupplierOrder(input: SupplierOrderInput): SupplierOrder {
  const { company, customer, job, profile, bom, layout, calculation } = input;

  const blockers: string[] = [];
  if (!layout.ok) blockers.push(layout.reason);
  if (bom.incomplete) blockers.push(...bom.warnings);
  const verification = profile?.verificationState ?? 'PLACEHOLDER';
  // Same wording as the order-grade condition, so an unverified specification is listed
  // once on the order however many checks noticed it.
  if (verification !== 'VERIFIED') blockers.push('Product specification is not verified.');
  blockers.push(...input.orderBlockers);
  const uniqueBlockers = [...new Set(blockers.filter(Boolean))];

  const placeholders: string[] = [];
  if (!company.supplierName) placeholders.push('Supplier is not configured in settings.');
  if (!company.supplierEmail) placeholders.push('Supplier email is not configured.');
  if (!company.supplierAccount) placeholders.push('Supplier account reference is not configured.');
  if (!company.address) placeholders.push('Business address is not confirmed.');
  if (!input.colour) placeholders.push('Colour is not recorded on this job.');
  if (!input.requiredBy) placeholders.push('Required-by date is not recorded on this job.');

  const status: SupplierOrder['status'] = uniqueBlockers.length === 0 ? 'READY' : 'BLOCKED';

  const content = {
    version: 1 as const,
    status,
    supplier: {
      name: company.supplierName,
      email: company.supplierEmail,
      account: company.supplierAccount,
      notes: company.supplierNotes,
    },
    deliverTo: {
      name: customer?.name ?? 'Customer not recorded',
      address: job.siteAddress || customer?.address || null,
      contact: customer?.contactName ?? null,
      phone: customer?.phone ?? null,
      requiredBy: input.requiredBy,
    },
    job: { title: job.title, number: job.jobNumber, site: job.siteAddress },
    product: {
      manufacturer: profile?.manufacturer ?? 'Product not selected',
      profile: profile?.name ?? 'Product not selected',
      material: profile?.material ?? 'Not specified',
      thickness: profile?.thicknessMm == null ? null : `${profile.thicknessMm} mm`,
      coating: profile?.coating ?? 'Not specified',
      colour: input.colour,
      coverMm: profile?.effectiveCoverMm ?? null,
      maxLengthMm: profile?.maxLengthMm ?? null,
      catalogueRevision: profile?.revision ?? '—',
      verification,
      sourceNote: profile?.sourceNote ?? 'No catalogue source recorded.',
    },
    // A failed layout means nothing was calculated, so there is nothing to order.
    lines: layout.ok ? bom.lines.map(lineFromBom) : [],
    blockers: uniqueBlockers,
    placeholders,
    provenance: {
      bomFingerprint: fingerprint(bom.lines),
      calcInputFingerprint: calculation?.inputFingerprint ?? null,
      calcOutputFingerprint: calculation?.outputFingerprint ?? null,
      engineVersion: calculation?.engineVersion ?? null,
      totalSheets: layout.ok ? layout.totalSheets : 0,
      totalSheetLengthMm: layout.ok ? layout.totalSheetLengthMm : 0,
      recordType: job.sourceType,
    },
  };

  return {
    ...content,
    heading: status === 'READY' ? 'MATERIAL ORDER' : 'MATERIAL ORDER — NOT FOR MANUFACTURE',
    number: input.number,
    generatedAt: input.generatedAt,
    fingerprint: fingerprint(content),
  };
}

/**
 * Supplier-specific output.
 *
 * A supplier's ordering desk wants a fixed set of columns, and every one is different. The
 * adapter is the seam: the order is built once, and each adapter only decides how it is
 * written out. Adding a supplier is a new adapter, never a change to the domain.
 */
export type SupplierAdapter = {
  id: string;
  label: string;
  description: string;
  csv(order: SupplierOrder): string;
};

function cell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function csvRows(rows: (string | number | null)[][]): string {
  return rows.map((row) => row.map(cell).join(',')).join('\n');
}

function statusLine(order: SupplierOrder): string[] {
  return order.status === 'READY' ? [] : [`${order.heading} — specification not verified`];
}

const genericAdapter: SupplierAdapter = {
  id: 'generic',
  label: 'Generic supplier order',
  description: 'One row per item, with the specification, cut length, quantity and verification state.',
  csv: (order) =>
    csvRows([
      ...statusLine(order).map((line) => [line]),
      ['Item', 'Description', 'Material', 'Thickness', 'Colour', 'Length (mm)', 'Quantity', 'Unit', 'Verified', 'Note'],
      ...order.lines.map((line) => [
        line.item,
        line.detail.join(' · ') || line.item,
        order.product.material,
        order.product.thickness,
        order.product.colour,
        line.lengthMm,
        line.quantity,
        line.unit,
        line.verified ? 'Yes' : 'No',
        line.note,
      ]),
    ]),
};

const cutListAdapter: SupplierAdapter = {
  id: 'cut-list',
  label: 'Cut list',
  description: 'Sheet lengths and quantities only, for a supplier who takes a cutting schedule.',
  csv: (order) =>
    csvRows([
      ...statusLine(order).map((line) => [line]),
      ['Length (mm)', 'Quantity'],
      ...order.lines.map((line) => [line.lengthMm, line.quantity]),
    ]),
};

export const SUPPLIER_ADAPTERS: SupplierAdapter[] = [genericAdapter, cutListAdapter];

/** Order numbers are allocated at export, so the record and the document agree. */
export function nextSupplierOrderNumber(existing: { number: string }[]): string {
  const numbers = existing.map((entry) => Number(entry.number.replace(/\D/g, ''))).filter((n) => Number.isFinite(n));
  const max = numbers.length > 0 ? Math.max(...numbers) : 0;
  return `SO-${String(max + 1).padStart(4, '0')}`;
}

export function adapterById(id: string): SupplierAdapter {
  return SUPPLIER_ADAPTERS.find((adapter) => adapter.id === id) ?? genericAdapter;
}
