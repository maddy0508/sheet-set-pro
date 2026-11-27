import type { AppState } from '@/data/types';
import { COLLECTION_ORDER } from '@/data/persistence';

/**
 * A whole-workspace backup.
 *
 * The backup is the workspace as the application holds it, so a restore is exact rather
 * than a re-import that could drift: records keep their ids, revisions and fingerprints.
 * A checksum covers the payload, which detects a truncated or edited file. It does not
 * prove the records are correct, only that the file is the one that was written.
 */

export const BACKUP_FORMAT = 'sheet-set-pro.workspace';
export const BACKUP_VERSION = 1;

export type BackupCounts = Record<string, number>;

export type WorkspaceBackup = {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  counts: BackupCounts;
  checksum: string;
  state: AppState;
};

export type BackupProblem = { where: string; problem: string };

export type BackupReadResult =
  | { ok: true; backup: WorkspaceBackup; warnings: string[] }
  | { ok: false; problems: string[] };

/**
 * FNV-1a over the JSON text. `fingerprint` in the domain refuses non-integers, and a
 * workspace legitimately holds fractional values (a 0.42 mm thickness), so the backup
 * hashes its own text instead.
 */
function checksumOf(payload: unknown): string {
  const text = JSON.stringify(payload);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

function countRecords(state: AppState): BackupCounts {
  const counts: BackupCounts = {};
  for (const collection of COLLECTION_ORDER) {
    counts[collection] = state[collection].length;
  }
  return counts;
}

export function createBackup(state: AppState, exportedAt = new Date().toISOString()): WorkspaceBackup {
  // Structured clone so a later edit to the live workspace cannot alter the backup in hand.
  const copy = JSON.parse(JSON.stringify(state)) as AppState;
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    counts: countRecords(copy),
    checksum: checksumOf({ company: copy.company, records: pickRecords(copy) }),
    state: copy,
  };
}

function pickRecords(state: AppState): Record<string, unknown[]> {
  const records: Record<string, unknown[]> = {};
  for (const collection of COLLECTION_ORDER) records[collection] = state[collection];
  return records;
}

export function backupJson(backup: WorkspaceBackup): string {
  return JSON.stringify(backup, null, 2);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Referential integrity: a restored workspace must not contain records that point nowhere. */
function checkReferences(state: AppState): BackupProblem[] {
  const problems: BackupProblem[] = [];
  const ids = {
    customers: new Set(state.customers.map((row) => row.id)),
    jobs: new Set(state.jobs.map((row) => row.id)),
    evidence: new Set(state.evidence.map((row) => row.id)),
    invoices: new Set(state.invoices.map((row) => row.id)),
    payments: new Set(state.payments.map((row) => row.id)),
    estimates: new Set(state.estimates.map((row) => row.id)),
  };

  state.jobs.forEach((job, index) => {
    if (!ids.customers.has(job.customerId)) {
      problems.push({ where: `jobs[${index}] ${job.jobNumber}`, problem: `names customer ${job.customerId}, which is not in the backup` });
    }
  });
  state.planes.forEach((plane, index) => {
    if (!ids.jobs.has(plane.jobId)) {
      problems.push({ where: `planes[${index}] ${plane.ref}`, problem: `belongs to job ${plane.jobId}, which is not in the backup` });
    }
  });
  state.measurements.forEach((measurement, index) => {
    if (!ids.jobs.has(measurement.jobId)) {
      problems.push({ where: `measurements[${index}]`, problem: `belongs to job ${measurement.jobId}, which is not in the backup` });
    }
    if (measurement.evidenceId && !ids.evidence.has(measurement.evidenceId)) {
      problems.push({ where: `measurements[${index}]`, problem: `cites evidence ${measurement.evidenceId}, which is not in the backup` });
    }
  });
  state.quotes.forEach((quote, index) => {
    if (!ids.jobs.has(quote.jobId)) {
      problems.push({ where: `quotes[${index}] ${quote.number}`, problem: `belongs to job ${quote.jobId}, which is not in the backup` });
    }
  });
  state.invoices.forEach((invoice, index) => {
    if (!ids.jobs.has(invoice.jobId)) {
      problems.push({ where: `invoices[${index}] ${invoice.number}`, problem: `belongs to job ${invoice.jobId}, which is not in the backup` });
    }
  });
  state.payments.forEach((payment, index) => {
    if (!ids.jobs.has(payment.jobId)) {
      problems.push({ where: `payments[${index}]`, problem: `belongs to job ${payment.jobId}, which is not in the backup` });
    }
  });
  state.allocations.forEach((allocation, index) => {
    if (!ids.payments.has(allocation.paymentId)) {
      problems.push({ where: `allocations[${index}]`, problem: `cites payment ${allocation.paymentId}, which is not in the backup` });
    }
    if (!ids.invoices.has(allocation.invoiceId)) {
      problems.push({ where: `allocations[${index}]`, problem: `cites invoice ${allocation.invoiceId}, which is not in the backup` });
    }
  });
  state.snapshots.forEach((snapshot, index) => {
    if (!ids.jobs.has(snapshot.jobId)) {
      problems.push({ where: `snapshots[${index}]`, problem: `belongs to job ${snapshot.jobId}, which is not in the backup` });
    }
  });
  state.supplierExports.forEach((entry, index) => {
    if (!ids.jobs.has(entry.jobId)) {
      problems.push({ where: `supplierExports[${index}] ${entry.number}`, problem: `belongs to job ${entry.jobId}, which is not in the backup` });
    }
  });
  return problems;
}

/**
 * Reads a backup file. Anything that is not exactly a backup this application wrote is
 * refused: a partial restore is worse than no restore, because it looks complete.
 */
export function readBackup(text: string): BackupReadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    return { ok: false, problems: [`The file is not JSON: ${cause instanceof Error ? cause.message : String(cause)}`] };
  }

  if (!isRecord(parsed)) return { ok: false, problems: ['The file does not contain a backup object.'] };
  if (parsed.format !== BACKUP_FORMAT) {
    return { ok: false, problems: [`This is not a Sheet Set Pro backup (format ${String(parsed.format)}).`] };
  }
  const version = typeof parsed.version === 'number' ? parsed.version : 0;
  if (version > BACKUP_VERSION) {
    return {
      ok: false,
      problems: [`The backup was written by a newer version of the application (backup version ${version}, this build reads ${BACKUP_VERSION}).`],
    };
  }

  const state = parsed.state;
  if (!isRecord(state)) return { ok: false, problems: ['The backup has no workspace state.'] };
  if (!isRecord(state.company)) return { ok: false, problems: ['The backup has no business settings.'] };

  const problems: string[] = [];
  for (const collection of COLLECTION_ORDER) {
    if (!Array.isArray(state[collection])) problems.push(`The backup has no ${collection} list.`);
  }
  if (problems.length > 0) return { ok: false, problems };

  const restored = state as unknown as AppState;
  for (const problem of checkReferences(restored)) {
    problems.push(`${problem.where}: ${problem.problem}.`);
  }
  if (problems.length > 0) return { ok: false, problems };

  const warnings: string[] = [];
  const expected = parsed.checksum;
  const actual = checksumOf({ company: restored.company, records: pickRecords(restored) });
  if (typeof expected !== 'string') {
    warnings.push('The backup carries no checksum, so its contents cannot be compared with what was written.');
  } else if (expected !== actual) {
    warnings.push('The checksum does not match the contents: this file has been edited since it was written.');
  }

  const counts = isRecord(parsed.counts) ? (parsed.counts as BackupCounts) : null;
  if (counts) {
    for (const collection of COLLECTION_ORDER) {
      const claimed = counts[collection];
      if (typeof claimed === 'number' && claimed !== restored[collection].length) {
        warnings.push(`${collection}: the file claims ${claimed} record(s) but contains ${restored[collection].length}.`);
      }
    }
  }

  return {
    ok: true,
    warnings,
    backup: {
      format: BACKUP_FORMAT,
      version,
      exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : 'unknown',
      counts: counts ?? countRecords(restored),
      checksum: typeof expected === 'string' ? expected : '',
      state: restored,
    },
  };
}

/**
 * Restoring replaces the workspace. In a shared workspace the database refuses to delete
 * issued documents, payments and calculations, so a restore over live records would fail
 * half way through: it is allowed only where there is nothing to lose.
 */
export function restoreBlocker(state: AppState, mode: 'local' | 'remote'): string | null {
  if (mode === 'local') return null;
  // Catalogue profiles are configuration and may be replaced. Everything else is history
  // the database will not delete, so a restore over it cannot succeed.
  const held = COLLECTION_ORDER.filter(
    (collection) => collection !== 'catalogue' && state[collection].length > 0,
  );
  if (held.length === 0) return null;
  return `This workspace already holds records (${held.join(', ')}). Restoring replaces the workspace, and the database keeps issued documents, payments and calculations permanently. Restore into an empty workspace instead.`;
}

const SINGULAR: Record<string, string> = {
  customers: 'customer',
  catalogue: 'catalogue profile',
  jobs: 'job',
  planes: 'roof plane',
  flashings: 'flashing',
  evidence: 'evidence record',
  measurements: 'measurement',
  estimates: 'estimate',
  quotes: 'quote',
  invoices: 'invoice',
  payments: 'payment',
  allocations: 'allocation',
  snapshots: 'calculation',
  supplierExports: 'supplier order',
  activity: 'activity event',
};

export function summariseBackup(backup: WorkspaceBackup): string {
  return COLLECTION_ORDER.filter((collection) => (backup.counts[collection] ?? 0) > 0)
    .map((collection) => {
      const count = backup.counts[collection];
      const name = count === 1 ? (SINGULAR[collection] ?? collection) : collection;
      return `${count} ${name}`;
    })
    .join(' · ');
}
