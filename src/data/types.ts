import type { EvidenceKind, FlashingKind, MeasurementGrade, PlaneGeometry, SourceType } from '@/domain/types';

export type Id = string;

export type Company = {
  id: Id;
  displayName: string;
  legalName: string | null;
  abn: string | null;
  gstRegistered: boolean | null;
  gstRateBp: number;
  gstRateConfirmed: boolean;
  address: string | null;
  email: string | null;
  phone: string | null;
  labourRateCentsPerM2: number;
  /** What an installed square metre costs the business. Null until the operator records it. */
  labourCostCentsPerM2: number | null;
  defaultMarginBp: number;
};

export type Customer = {
  id: Id;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
  sourceType: SourceType;
  createdAt: string;
  updatedAt: string;
};

export type JobStatus =
  | 'draft'
  | 'measured'
  | 'geometry_validated'
  | 'calculated'
  | 'quoted'
  | 'won'
  | 'invoiced'
  | 'paid'
  | 'lost';

export type Job = {
  id: Id;
  customerId: Id;
  jobNumber: string;
  title: string;
  siteAddress: string;
  status: JobStatus;
  notes: string;
  sourceType: SourceType;
  profileId: Id | null;
  crsEpsg: number | null;
  operatorApproved: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Plane = PlaneGeometry & { id: Id; jobId: Id };

export type Flashing = {
  id: Id;
  jobId: Id;
  kind: FlashingKind;
  lengthMm: number;
  source: 'DERIVED' | 'ENTERED';
};

export type Evidence = {
  id: Id;
  jobId: Id;
  sourceKind: EvidenceKind;
  note: string;
  accuracyClaimMm: number | null;
  accuracyBasis: 'unknown' | 'operator_estimate' | 'manufacturer_spec' | 'verified_by_test';
  isVerified: boolean;
  createdAt: string;
};

export type Measurement = {
  id: Id;
  jobId: Id;
  evidenceId: Id;
  kind: 'control_dimension' | 'plane_width' | 'plane_length' | 'ridge' | 'valley' | 'other';
  label: string;
  valueMm: number;
  toleranceMm: number | null;
  grade: MeasurementGrade;
  isActive: boolean;
  createdAt: string;
};

export type CatalogueProfile = {
  id: Id;
  manufacturer: string;
  name: string;
  material: string;
  thicknessMm: number | null;
  coating: string;
  effectiveCoverMm: number | null;
  minPitchDeg: number | null;
  maxLengthMm: number | null;
  lapLongitudinalMm: number | null;
  lapTransverseMm: number | null;
  sheetPriceCentsPerM: number | null;
  fixingPerSheet: number | null;
  flashingGirthMm: number | null;
  verificationState: 'PLACEHOLDER' | 'PARTIAL' | 'VERIFIED';
  priceBasis: 'SYNTHETIC' | 'ENTERED';
  sourceNote: string;
  revision: string;
  effectiveFrom: string;
};

export type DocLine = {
  key: string;
  description: string;
  qtyMicro: number;
  unit: string;
  unitPriceCents: number;
  isPlaceholder: boolean;
};

export type DocumentTotals = {
  subtotalCents: number;
  gstCents: number;
  totalCents: number;
};

export type Estimate = {
  id: Id;
  jobId: Id;
  revision: number;
  lines: DocLine[];
  marginBp: number;
  labourCents: number;
  totals: DocumentTotals;
  fingerprint: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Everything a customer sees on an issued document, captured at the moment of issue so a
 * reprint does not follow later edits to the business, customer, job or catalogue.
 * `fingerprint` covers this content and nothing that changes afterwards.
 */
export type DocumentSnapshot = {
  version: 1;
  capturedAt: string;
  kind: 'QUOTE' | 'INVOICE';
  heading: string;
  number: string;
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
  notes: string[];
  provenance: { catalogueVerified: boolean; recordType: SourceType };
  fingerprint: string;
};

export type QuoteStatus = 'draft' | 'issued' | 'accepted' | 'declined';

export type Quote = {
  id: Id;
  jobId: Id;
  number: string;
  revision: number;
  status: QuoteStatus;
  lines: DocLine[];
  totals: DocumentTotals;
  gstApplied: boolean;
  gstRateBp: number;
  issuedAt: string | null;
  validUntil: string | null;
  fingerprint: string;
  /** Captured at issue; null on a draft or on a document issued before snapshots existed. */
  snapshot: DocumentSnapshot | null;
  createdAt: string;
};

export type InvoiceStatus = 'draft' | 'issued' | 'voided';

export type Invoice = {
  id: Id;
  jobId: Id;
  number: string;
  quoteId: Id | null;
  status: InvoiceStatus;
  lines: DocLine[];
  totals: DocumentTotals;
  gstRegisteredSnapshot: boolean | null;
  gstRateBp: number;
  issuedAt: string | null;
  dueDate: string | null;
  voidReason: string | null;
  fingerprint: string;
  /** Captured at issue; null on a draft or on a document issued before snapshots existed. */
  snapshot: DocumentSnapshot | null;
  createdAt: string;
};

export type Payment = {
  id: Id;
  jobId: Id;
  amountCents: number;
  receivedAt: string;
  method: 'bank_transfer' | 'cash' | 'card' | 'cheque' | 'other';
  reference: string;
  idempotencyKey: string;
  createdAt: string;
};

export type Allocation = {
  id: Id;
  paymentId: Id;
  invoiceId: Id;
  amountCents: number;
  createdAt: string;
};

export type CalcSnapshot = {
  id: Id;
  jobId: Id;
  createdAt: string;
  inputFingerprint: string;
  outputFingerprint: string;
  engineVersion: string;
  totalSheets: number;
  totalSheetLengthMm: number;
  areaMm2: number;
  blockingIssues: number;
  executedIn: 'client' | 'server';
  isAuthoritative: boolean;
};

export type ActivityEvent = {
  id: Id;
  at: string;
  type: string;
  subjectType: 'customer' | 'job' | 'estimate' | 'quote' | 'invoice' | 'payment' | 'catalogue' | 'company';
  subjectId: Id;
  detail: string;
};

export type AppState = {
  version: number;
  company: Company;
  customers: Customer[];
  jobs: Job[];
  planes: Plane[];
  flashings: Flashing[];
  evidence: Evidence[];
  measurements: Measurement[];
  catalogue: CatalogueProfile[];
  estimates: Estimate[];
  quotes: Quote[];
  invoices: Invoice[];
  payments: Payment[];
  allocations: Allocation[];
  snapshots: CalcSnapshot[];
  activity: ActivityEvent[];
};
