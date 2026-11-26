import type { AppState, CatalogueProfile } from './types';

const now = () => new Date().toISOString();

/**
 * Development catalogue. Every value here is SYNTHETIC and deliberately marked as such:
 * it exists so the application can be exercised, and it must never be mistaken for a
 * manufacturer specification.
 */
export const SYNTHETIC_PROFILES: CatalogueProfile[] = [
  {
    id: 'cat-syn-1',
    manufacturer: 'SYNTHETIC — example manufacturer',
    name: 'Synthetic Corrugated 0.42',
    material: 'Steel (synthetic example)',
    thicknessMm: 0.42,
    coating: 'Synthetic coating',
    effectiveCoverMm: 762,
    minPitchDeg: 5,
    maxLengthMm: 8200,
    lapLongitudinalMm: 0,
    lapTransverseMm: 150,
    sheetPriceCentsPerM: 2350,
    fixingPerSheet: 12,
    flashingGirthMm: 200,
    verificationState: 'PLACEHOLDER',
    priceBasis: 'SYNTHETIC',
    sourceNote: 'SYNTHETIC DEVELOPMENT DATA — not a manufacturer specification.',
    revision: 'dev-1',
    effectiveFrom: '2026-01-01',
  },
  {
    id: 'cat-syn-2',
    manufacturer: 'SYNTHETIC — example manufacturer',
    name: 'Synthetic Standing Seam 0.55',
    material: 'Steel (synthetic example)',
    thicknessMm: 0.55,
    coating: 'Synthetic coating',
    effectiveCoverMm: 470,
    minPitchDeg: 3,
    maxLengthMm: 12000,
    lapLongitudinalMm: 0,
    lapTransverseMm: 150,
    sheetPriceCentsPerM: 3950,
    fixingPerSheet: 8,
    flashingGirthMm: 250,
    verificationState: 'PLACEHOLDER',
    priceBasis: 'SYNTHETIC',
    sourceNote: 'SYNTHETIC DEVELOPMENT DATA — not a manufacturer specification.',
    revision: 'dev-1',
    effectiveFrom: '2026-01-01',
  },
];

export function createInitialState(): AppState {
  return {
    version: 1,
    company: {
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
    },
    customers: [],
    jobs: [],
    planes: [],
    flashings: [],
    evidence: [],
    measurements: [],
    catalogue: SYNTHETIC_PROFILES,
    estimates: [],
    quotes: [],
    invoices: [],
    payments: [],
    allocations: [],
    snapshots: [],
    activity: [
      {
        id: 'activity-1',
        at: now(),
        type: 'system.initialised',
        subjectType: 'company',
        subjectId: 'company-1',
        detail: 'Workspace created with synthetic development data.',
      },
    ],
  };
}
