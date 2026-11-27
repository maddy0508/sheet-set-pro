import type { CatalogueProfile } from '@/data/types';
import type { BomResult } from '@/domain/material';
import type { SupplierOrderInput } from './supplier';

/** One verified product, one BOM, one job: shared by the domain and PDF tests. */
export const VERIFIED_PROFILE: CatalogueProfile = {
  id: 'p1',
  manufacturer: 'Example Roofing',
  name: 'Corrugated 0.42',
  material: 'Colorbond steel',
  thicknessMm: 0.42,
  coating: 'Colorbond',
  effectiveCoverMm: 762,
  minPitchDeg: 5,
  maxLengthMm: 6000,
  lapLongitudinalMm: 150,
  lapTransverseMm: 75,
  sheetPriceCentsPerM: 1450,
  fixingPerSheet: 18,
  flashingGirthMm: 250,
  verificationState: 'VERIFIED',
  priceBasis: 'ENTERED',
  sourceNote: 'Supplier published data sheet, revision 4',
  revision: '4',
  effectiveFrom: '2026-09-01',
};

export const BOM: BomResult = {
  lines: [
    {
      key: 'sheet-3600',
      description: 'Corrugated 0.42 sheet — 3600 mm',
      category: 'sheet',
      lengthMm: 3600,
      quantityMicro: 16_000_000,
      unit: 'ea',
      unitPriceCents: 5220,
      isPlaceholder: false,
    },
    {
      key: 'flashing-ridge',
      description: 'Ridge flashing',
      category: 'flashing',
      quantityMicro: 12_000_000,
      unit: 'm',
      unitPriceCents: 2320,
      isPlaceholder: false,
    },
    {
      key: 'fasteners',
      description: 'Roofing fasteners',
      category: 'fastener',
      quantityMicro: 288_000_000,
      unit: 'ea',
      unitPriceCents: 0,
      isPlaceholder: true,
      note: 'Quantity derived from the fixing rule; unit price not yet configured.',
    },
  ],
  warnings: [],
  incomplete: false,
};

export const LAYOUT = { ok: true as const, planes: [], totalSheets: 16, totalSheetLengthMm: 57_600 };

export function orderInput(overrides: Partial<SupplierOrderInput> = {}): SupplierOrderInput {
  return {
    number: 'SO-0001',
    generatedAt: '2026-11-27T04:00:00.000Z',
    company: {
      id: 'b1',
      displayName: "Mitchell's Metal Roofing",
      legalName: null,
      abn: null,
      gstRegistered: null,
      gstRateBp: 1000,
      gstRateConfirmed: false,
      address: null,
      phone: null,
      email: null,
      supplierName: 'Example Roofing Supplies',
      supplierEmail: 'orders@example.com',
      supplierAccount: 'MMR-118',
      supplierNotes: 'Deliver to site, call ahead.',
      labourRateCentsPerM2: 4500,
      labourCostCentsPerM2: null,
      defaultMarginBp: 2500,
    },
    customer: {
      id: 'c1',
      name: 'Test Customer',
      contactName: 'Sam Test',
      email: 'sam@example.com',
      phone: '0400 000 000',
      address: '1 Test Street, Bendigo VIC 3550',
      notes: '',
      sourceType: 'TEST',
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    },
    job: {
      id: 'j1',
      customerId: 'c1',
      jobNumber: 'J-0001',
      title: 'Test gable roof',
      siteAddress: '1 Test Street, Bendigo VIC 3550',
      status: 'calculated',
      notes: '',
      sourceType: 'TEST',
      profileId: 'p1',
      crsEpsg: null,
      operatorApproved: true,
      colour: null,
      requiredBy: null,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    },
    profile: VERIFIED_PROFILE,
    bom: BOM,
    layout: LAYOUT,
    calculation: { inputFingerprint: 'in-abc', outputFingerprint: 'out-def', engineVersion: '1.0.0' },
    orderBlockers: [],
    colour: null,
    requiredBy: null,
    ...overrides,
  };
}

