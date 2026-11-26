import type {
  ActivityEvent,
  Allocation,
  AppState,
  CalcSnapshot,
  CatalogueProfile,
  Customer,
  DocLine,
  DocumentTotals,
  Estimate,
  Evidence,
  Invoice,
  Job,
  Measurement,
  Payment,
  Plane,
  Quote,
} from './types';

/**
 * Maps the application's in-memory state onto the Postgres schema and back.
 *
 * The application keeps strings, numbers and arrays in memory; the database keeps
 *, snake_case columns, integers, and jsonb. One table per collection, diffed by id:
 * the store hands us two states and we work out what actually changed.
 */

type Row = Record<string, unknown>;

export type CollectionKey = Exclude<keyof AppState, 'version' | 'company'>;

export type Entities = {
  customers: Customer;
  jobs: Job;
  planes: Plane;
  flashings: AppState['flashings'][number];
  evidence: Evidence;
  measurements: Measurement;
  catalogue: CatalogueProfile;
  estimates: Estimate;
  quotes: Quote;
  invoices: Invoice;
  payments: Payment;
  allocations: Allocation;
  snapshots: CalcSnapshot;
  activity: ActivityEvent;
};

export type TablePlan<K extends CollectionKey> = {
  table: string;
  toRow: (entity: Entities[K], businessId: string) => Row;
  fromRow: (row: Row) => Entities[K];
  orderBy: { column: string; ascending: boolean };
};

const text = (value: unknown): string => (typeof value === 'string' ? value : value == null ? '' : String(value));
const textOrNull = (value: unknown): string | null => (value == null ? null : String(value));
const intOrNull = (value: unknown): number | null => (value == null ? null : Number(value));
const num = (value: unknown): number => (value == null ? 0 : Number(value));
const bool = (value: unknown): boolean => value === true;
const boolOrNull = (value: unknown): boolean | null => (value == null ? null : value === true);
const lines = (value: unknown): DocLine[] => (Array.isArray(value) ? (value as DocLine[]) : []);
const totals = (value: unknown): DocumentTotals => {
  const record = (value ?? {}) as Partial<DocumentTotals>;
  return {
    subtotalCents: Number(record.subtotalCents ?? 0),
    gstCents: Number(record.gstCents ?? 0),
    totalCents: Number(record.totalCents ?? 0),
  };
};

const createdDesc = { column: 'created_at', ascending: false };
const ordinal = { column: 'ord', ascending: true };

export const TABLE_PLANS: { [K in CollectionKey]: TablePlan<K> } = {
  customers: {
    table: 'customers',
    orderBy: createdDesc,
    toRow: (entity, businessId) => ({
      id: entity.id,
      business_id: businessId,
      name: entity.name,
      contact_name: entity.contactName,
      email: entity.email,
      phone: entity.phone,
      address: entity.address,
      notes: entity.notes,
      source_type: entity.sourceType,
      created_at: entity.createdAt,
      updated_at: entity.updatedAt,
    }),
    fromRow: (row) => ({
      id: text(row.id),
      name: text(row.name),
      contactName: text(row.contact_name),
      email: text(row.email),
      phone: text(row.phone),
      address: text(row.address),
      notes: text(row.notes),
      sourceType: text(row.source_type) as Customer['sourceType'],
      createdAt: text(row.created_at),
      updatedAt: text(row.updated_at),
    }),
  },

  jobs: {
    table: 'jobs',
    orderBy: createdDesc,
    toRow: (entity, businessId) => ({
      id: entity.id,
      business_id: businessId,
      customer_id: entity.customerId,
      job_number: entity.jobNumber,
      title: entity.title,
      site_address: entity.siteAddress,
      status: entity.status,
      notes: entity.notes,
      source_type: entity.sourceType,
      profile_id: entity.profileId,
      crs_epsg: entity.crsEpsg,
      operator_approved: entity.operatorApproved,
      created_at: entity.createdAt,
      updated_at: entity.updatedAt,
    }),
    fromRow: (row) => ({
      id: text(row.id),
      customerId: text(row.customer_id),
      jobNumber: text(row.job_number),
      title: text(row.title),
      siteAddress: text(row.site_address),
      status: text(row.status) as Job['status'],
      notes: text(row.notes),
      sourceType: text(row.source_type) as Job['sourceType'],
      profileId: textOrNull(row.profile_id),
      crsEpsg: intOrNull(row.crs_epsg),
      operatorApproved: bool(row.operator_approved),
      createdAt: text(row.created_at),
      updatedAt: text(row.updated_at),
    }),
  },

  planes: {
    table: 'roof_planes',
    orderBy: ordinal,
    toRow: (entity, businessId) => ({
      id: entity.id,
      business_id: businessId,
      job_id: entity.jobId,
      ref: entity.ref,
      x_mm: entity.xMm,
      y_mm: entity.yMm,
      width_mm: entity.widthMm,
      length_mm: entity.lengthMm,
      pitch_microdeg: entity.pitchMicrodeg,
    }),
    fromRow: (row) => ({
      id: text(row.id),
      jobId: text(row.job_id),
      ref: text(row.ref),
      xMm: num(row.x_mm),
      yMm: num(row.y_mm),
      widthMm: num(row.width_mm),
      lengthMm: num(row.length_mm),
      pitchMicrodeg: num(row.pitch_microdeg),
    }),
  },

  flashings: {
    table: 'flashings',
    orderBy: ordinal,
    toRow: (entity, businessId) => ({
      id: entity.id,
      business_id: businessId,
      job_id: entity.jobId,
      kind: entity.kind,
      length_mm: entity.lengthMm,
      source: entity.source,
    }),
    fromRow: (row) => ({
      id: text(row.id),
      jobId: text(row.job_id),
      kind: text(row.kind) as AppState['flashings'][number]['kind'],
      lengthMm: num(row.length_mm),
      source: text(row.source) === 'DERIVED' ? 'DERIVED' : 'ENTERED',
    }),
  },

  evidence: {
    table: 'measurement_evidence',
    orderBy: ordinal,
    toRow: (entity, businessId) => ({
      id: entity.id,
      business_id: businessId,
      job_id: entity.jobId,
      source_kind: entity.sourceKind,
      note: entity.note,
      accuracy_claim_mm: entity.accuracyClaimMm,
      accuracy_basis: entity.accuracyBasis,
      is_verified: entity.isVerified,
      created_at: entity.createdAt,
    }),
    fromRow: (row) => ({
      id: text(row.id),
      jobId: text(row.job_id),
      sourceKind: text(row.source_kind) as Evidence['sourceKind'],
      note: text(row.note),
      accuracyClaimMm: intOrNull(row.accuracy_claim_mm),
      accuracyBasis: text(row.accuracy_basis) as Evidence['accuracyBasis'],
      isVerified: bool(row.is_verified),
      createdAt: text(row.created_at),
    }),
  },

  measurements: {
    table: 'measurements',
    orderBy: ordinal,
    toRow: (entity, businessId) => ({
      id: entity.id,
      business_id: businessId,
      job_id: entity.jobId,
      evidence_id: entity.evidenceId,
      kind: entity.kind,
      label: entity.label,
      value_mm: entity.valueMm,
      tolerance_mm: entity.toleranceMm,
      grade: entity.grade,
      is_active: entity.isActive,
      created_at: entity.createdAt,
    }),
    fromRow: (row) => ({
      id: text(row.id),
      jobId: text(row.job_id),
      evidenceId: text(row.evidence_id),
      kind: text(row.kind) as Measurement['kind'],
      label: text(row.label),
      valueMm: num(row.value_mm),
      toleranceMm: intOrNull(row.tolerance_mm),
      grade: text(row.grade) as Measurement['grade'],
      isActive: bool(row.is_active),
      createdAt: text(row.created_at),
    }),
  },

  catalogue: {
    table: 'catalogue_profiles',
    orderBy: { column: 'created_at', ascending: true },
    toRow: (entity, businessId) => ({
      id: entity.id,
      business_id: businessId,
      manufacturer: entity.manufacturer,
      name: entity.name,
      material: entity.material,
      thickness_mm: entity.thicknessMm,
      coating: entity.coating,
      effective_cover_mm: entity.effectiveCoverMm,
      min_pitch_deg: entity.minPitchDeg,
      max_length_mm: entity.maxLengthMm,
      lap_longitudinal_mm: entity.lapLongitudinalMm,
      lap_transverse_mm: entity.lapTransverseMm,
      sheet_price_cents_per_m: entity.sheetPriceCentsPerM,
      fixing_per_sheet: entity.fixingPerSheet,
      flashing_girth_mm: entity.flashingGirthMm,
      verification_state: entity.verificationState,
      price_basis: entity.priceBasis,
      source_note: entity.sourceNote,
      revision: entity.revision,
      effective_from: entity.effectiveFrom,
    }),
    fromRow: (row) => ({
      id: text(row.id),
      manufacturer: text(row.manufacturer),
      name: text(row.name),
      material: text(row.material),
      thicknessMm: row.thickness_mm == null ? null : Number(row.thickness_mm),
      coating: text(row.coating),
      effectiveCoverMm: intOrNull(row.effective_cover_mm),
      minPitchDeg: row.min_pitch_deg == null ? null : Number(row.min_pitch_deg),
      maxLengthMm: intOrNull(row.max_length_mm),
      lapLongitudinalMm: intOrNull(row.lap_longitudinal_mm),
      lapTransverseMm: intOrNull(row.lap_transverse_mm),
      sheetPriceCentsPerM: intOrNull(row.sheet_price_cents_per_m),
      fixingPerSheet: intOrNull(row.fixing_per_sheet),
      flashingGirthMm: intOrNull(row.flashing_girth_mm),
      verificationState: text(row.verification_state) as CatalogueProfile['verificationState'],
      priceBasis: text(row.price_basis) as CatalogueProfile['priceBasis'],
      sourceNote: text(row.source_note),
      revision: text(row.revision),
      effectiveFrom: text(row.effective_from),
    }),
  },

  estimates: {
    table: 'estimates',
    orderBy: createdDesc,
    toRow: (entity, businessId) => ({
      id: entity.id,
      business_id: businessId,
      job_id: entity.jobId,
      revision: entity.revision,
      lines: entity.lines,
      margin_bp: entity.marginBp,
      labour_cents: entity.labourCents,
      totals: entity.totals,
      fingerprint: entity.fingerprint,
      created_at: entity.createdAt,
      updated_at: entity.updatedAt,
    }),
    fromRow: (row) => ({
      id: text(row.id),
      jobId: text(row.job_id),
      revision: num(row.revision),
      lines: lines(row.lines),
      marginBp: num(row.margin_bp),
      labourCents: num(row.labour_cents),
      totals: totals(row.totals),
      fingerprint: text(row.fingerprint),
      createdAt: text(row.created_at),
      updatedAt: text(row.updated_at),
    }),
  },

  quotes: {
    table: 'quotes',
    orderBy: createdDesc,
    toRow: (entity, businessId) => ({
      id: entity.id,
      business_id: businessId,
      job_id: entity.jobId,
      number: entity.number,
      revision: entity.revision,
      status: entity.status,
      lines: entity.lines,
      totals: entity.totals,
      gst_applied: entity.gstApplied,
      gst_rate_bp: entity.gstRateBp,
      issued_at: entity.issuedAt,
      valid_until: entity.validUntil,
      fingerprint: entity.fingerprint,
      created_at: entity.createdAt,
    }),
    fromRow: (row) => ({
      id: text(row.id),
      jobId: text(row.job_id),
      number: text(row.number),
      revision: num(row.revision),
      status: text(row.status) as Quote['status'],
      lines: lines(row.lines),
      totals: totals(row.totals),
      gstApplied: bool(row.gst_applied),
      gstRateBp: num(row.gst_rate_bp),
      issuedAt: textOrNull(row.issued_at),
      validUntil: textOrNull(row.valid_until),
      fingerprint: text(row.fingerprint),
      createdAt: text(row.created_at),
    }),
  },

  invoices: {
    table: 'invoices',
    orderBy: createdDesc,
    toRow: (entity, businessId) => ({
      id: entity.id,
      business_id: businessId,
      job_id: entity.jobId,
      number: entity.number,
      quote_id: entity.quoteId,
      status: entity.status,
      lines: entity.lines,
      totals: entity.totals,
      gst_registered_snapshot: entity.gstRegisteredSnapshot,
      gst_rate_bp: entity.gstRateBp,
      issued_at: entity.issuedAt,
      due_date: entity.dueDate,
      void_reason: entity.voidReason,
      fingerprint: entity.fingerprint,
      created_at: entity.createdAt,
    }),
    fromRow: (row) => ({
      id: text(row.id),
      jobId: text(row.job_id),
      number: text(row.number),
      quoteId: textOrNull(row.quote_id),
      status: text(row.status) as Invoice['status'],
      lines: lines(row.lines),
      totals: totals(row.totals),
      gstRegisteredSnapshot: boolOrNull(row.gst_registered_snapshot),
      gstRateBp: num(row.gst_rate_bp),
      issuedAt: textOrNull(row.issued_at),
      dueDate: textOrNull(row.due_date),
      voidReason: textOrNull(row.void_reason),
      fingerprint: text(row.fingerprint),
      createdAt: text(row.created_at),
    }),
  },

  payments: {
    table: 'payments',
    orderBy: ordinal,
    toRow: (entity, businessId) => ({
      id: entity.id,
      business_id: businessId,
      job_id: entity.jobId,
      amount_cents: entity.amountCents,
      received_at: entity.receivedAt,
      method: entity.method,
      reference: entity.reference,
      idempotency_key: entity.idempotencyKey,
      created_at: entity.createdAt,
    }),
    fromRow: (row) => ({
      id: text(row.id),
      jobId: text(row.job_id),
      amountCents: num(row.amount_cents),
      receivedAt: text(row.received_at),
      method: text(row.method) as Payment['method'],
      reference: text(row.reference),
      idempotencyKey: text(row.idempotency_key),
      createdAt: text(row.created_at),
    }),
  },

  allocations: {
    table: 'payment_allocations',
    orderBy: ordinal,
    toRow: (entity, businessId) => ({
      id: entity.id,
      business_id: businessId,
      payment_id: entity.paymentId,
      invoice_id: entity.invoiceId,
      amount_cents: entity.amountCents,
      created_at: entity.createdAt,
    }),
    fromRow: (row) => ({
      id: text(row.id),
      paymentId: text(row.payment_id),
      invoiceId: text(row.invoice_id),
      amountCents: num(row.amount_cents),
      createdAt: text(row.created_at),
    }),
  },

  snapshots: {
    table: 'calc_snapshots',
    orderBy: ordinal,
    toRow: (entity, businessId) => ({
      id: entity.id,
      business_id: businessId,
      job_id: entity.jobId,
      input_fingerprint: entity.inputFingerprint,
      output_fingerprint: entity.outputFingerprint,
      engine_version: entity.engineVersion,
      total_sheets: entity.totalSheets,
      total_sheet_length_mm: entity.totalSheetLengthMm,
      area_mm2: entity.areaMm2,
      blocking_issues: entity.blockingIssues,
      executed_in: entity.executedIn,
      is_authoritative: entity.isAuthoritative,
      created_at: entity.createdAt,
    }),
    fromRow: (row) => ({
      id: text(row.id),
      jobId: text(row.job_id),
      createdAt: text(row.created_at),
      inputFingerprint: text(row.input_fingerprint),
      outputFingerprint: text(row.output_fingerprint),
      engineVersion: text(row.engine_version),
      totalSheets: num(row.total_sheets),
      totalSheetLengthMm: num(row.total_sheet_length_mm),
      areaMm2: num(row.area_mm2),
      blockingIssues: num(row.blocking_issues),
      executedIn: text(row.executed_in) === 'server' ? 'server' : 'client',
      isAuthoritative: bool(row.is_authoritative),
    }),
  },

  activity: {
    table: 'activity_events',
    orderBy: { column: 'at', ascending: false },
    toRow: (entity, businessId) => ({
      id: entity.id,
      business_id: businessId,
      at: entity.at,
      type: entity.type,
      subject_type: entity.subjectType,
      subject_id: entity.subjectId,
      detail: entity.detail,
    }),
    fromRow: (row) => ({
      id: text(row.id),
      at: text(row.at),
      type: text(row.type),
      subjectType: text(row.subject_type) as ActivityEvent['subjectType'],
      subjectId: text(row.subject_id),
      detail: text(row.detail),
    }),
  },
};

/** Parents before children: a job needs its customer, an allocation needs its payment. */
export const COLLECTION_ORDER: CollectionKey[] = [
  'customers',
  'catalogue',
  'jobs',
  'planes',
  'flashings',
  'evidence',
  'measurements',
  'estimates',
  'quotes',
  'invoices',
  'payments',
  'allocations',
  'snapshots',
  'activity',
];

export type CollectionChange = {
  collection: CollectionKey;
  table: string;
  upserts: Row[];
  deletes: string[];
};

const idOf = (entity: { id: string }): string => entity.id;

export function diffState(previous: AppState, next: AppState, businessId: string): CollectionChange[] {
  const changes: CollectionChange[] = [];

  for (const collection of COLLECTION_ORDER) {
    const plan = TABLE_PLANS[collection];
    const toRow = plan.toRow as (entity: { id: string }, businessId: string) => Row;

    const before = new Map<string, unknown>();
    for (const entity of previous[collection] as { id: string }[]) before.set(idOf(entity), entity);

    const upserts: Row[] = [];
    const seen = new Set<string>();

    for (const entity of next[collection] as { id: string }[]) {
      const id = idOf(entity);
      seen.add(id);
      const row = toRow(entity, businessId);
      const previousEntity = before.get(id);
      if (!previousEntity || JSON.stringify(previousEntity) !== JSON.stringify(entity)) {
        upserts.push(row);
      }
    }

    const deletes = [...before.keys()].filter((id) => !seen.has(id));

    if (upserts.length > 0 || deletes.length > 0) {
      changes.push({ collection, table: plan.table, upserts, deletes });
    }
  }

  return changes;
}

export function companyToRow(company: AppState['company']): Row {
  return {
    id: company.id,
    display_name: company.displayName,
    legal_name: company.legalName,
    abn: company.abn,
    gst_registered: company.gstRegistered,
    gst_rate_bp: company.gstRateBp,
    gst_rate_confirmed: company.gstRateConfirmed,
    address: company.address,
    email: company.email,
    phone: company.phone,
    labour_rate_cents_per_m2: company.labourRateCentsPerM2,
    labour_cost_cents_per_m2: company.labourCostCentsPerM2,
    default_margin_bp: company.defaultMarginBp,
  };
}

export function companyFromRow(row: Row): AppState['company'] {
  return {
    id: text(row.id),
    displayName: text(row.display_name),
    legalName: textOrNull(row.legal_name),
    abn: textOrNull(row.abn),
    gstRegistered: boolOrNull(row.gst_registered),
    gstRateBp: num(row.gst_rate_bp),
    gstRateConfirmed: bool(row.gst_rate_confirmed),
    address: textOrNull(row.address),
    email: textOrNull(row.email),
    phone: textOrNull(row.phone),
    labourRateCentsPerM2: num(row.labour_rate_cents_per_m2),
    labourCostCentsPerM2: intOrNull(row.labour_cost_cents_per_m2),
    defaultMarginBp: num(row.default_margin_bp),
  };
}
