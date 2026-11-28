import type { AppState } from './types';

/**
 * Offline-first plumbing: a device copy of the workspace, and a queue of writes
 * that have not reached the database yet.
 *
 * The queue holds the same diff payload the online path sends, so replaying it
 * writes exactly the changes the operator made, in the order they made them.
 */

type Row = Record<string, unknown>;

export type SavePayload = {
  businessId: string;
  business: Row | null;
  upserts: Record<string, Row[]>;
  deletes: Record<string, string[]>;
};

export type QueuedSave = SavePayload & {
  id: string;
  queuedAt: string;
  label: string;
};

export type KeyValueStore = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

export const CACHE_KEY = 'sheet-set-pro.workspace-cache.v1';
export const OUTBOX_KEY = 'sheet-set-pro.outbox.v1';

/** The queue is folded into one entry past this size, so storage cannot grow without bound. */
export const OUTBOX_FOLD_THRESHOLD = 25;

export type WorkspaceCache = {
  savedAt: string;
  businessId: string;
  state: AppState;
};

/** A browser without local storage (private mode, blocked storage) simply runs online-only. */
export function browserStore(): KeyValueStore | null {
  try {
    const probe = '__ssp_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}

const parse = <T>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export function readCache(store: KeyValueStore | null): WorkspaceCache | null {
  if (!store) return null;
  const cached = parse<WorkspaceCache>(store.getItem(CACHE_KEY));
  if (!cached || !cached.state || cached.state.version !== 1) return null;
  if (!cached.state.company?.id) return null;
  return cached;
}

/**
 * Writes the device copy. Activity and calculation snapshots are the bulk of a
 * workspace and the least costly to trim if the browser refuses the full copy.
 */
export function writeCache(store: KeyValueStore | null, state: AppState, savedAt = new Date().toISOString()): string | null {
  if (!store) return null;
  const snapshot = (value: AppState): WorkspaceCache => ({
    savedAt,
    businessId: value.company.id,
    state: value,
  });

  try {
    store.setItem(CACHE_KEY, JSON.stringify(snapshot(state)));
    return savedAt;
  } catch {
    // Fall through to a trimmed copy.
  }

  try {
    const trimmed: AppState = {
      ...state,
      activity: state.activity.slice(0, 100),
      snapshots: state.snapshots.slice(0, 20),
    };
    store.setItem(CACHE_KEY, JSON.stringify(snapshot(trimmed)));
    return savedAt;
  } catch {
    return null;
  }
}

export function clearCache(store: KeyValueStore | null): void {
  try {
    store?.removeItem(CACHE_KEY);
  } catch {
    // Nothing to clean up.
  }
}

export function readOutbox(store: KeyValueStore | null): QueuedSave[] {
  if (!store) return [];
  const queue = parse<QueuedSave[]>(store.getItem(OUTBOX_KEY));
  return Array.isArray(queue) ? queue.filter((entry) => entry && entry.businessId) : [];
}

export function writeOutbox(store: KeyValueStore | null, queue: QueuedSave[]): QueuedSave[] {
  if (!store) return queue;
  try {
    if (queue.length === 0) store.removeItem(OUTBOX_KEY);
    else store.setItem(OUTBOX_KEY, JSON.stringify(queue));
  } catch {
    // A full or blocked store keeps the in-memory queue this session only.
  }
  return queue;
}

/** Names the parts of a save so a queued change can be described in the interface. */
export function describePayload(payload: SavePayload): string {
  const tables = [...new Set([...Object.keys(payload.upserts), ...Object.keys(payload.deletes)])];
  if (payload.business) tables.unshift('business settings');
  if (tables.length === 0) return 'No changes';
  if (tables.length === 1) return tables[0];
  return `${tables.slice(0, -1).join(', ')} and ${tables[tables.length - 1]}`;
}

const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `q-${Date.now()}-${Math.random().toString(16).slice(2)}`;

/**
 * Combines queued payloads into one. Each payload is a diff, so later values for
 * the same row replace earlier ones and the folded payload means the same thing.
 */
export function foldQueue(queue: QueuedSave[]): QueuedSave[] {
  if (queue.length <= 1) return queue;

  const business = [...queue].reverse().find((entry) => entry.business)?.business ?? null;
  const rows = new Map<string, Map<string, Row | null>>();

  for (const entry of queue) {
    for (const [table, upserts] of Object.entries(entry.upserts)) {
      const bucket = rows.get(table) ?? new Map<string, Row | null>();
      for (const row of upserts) bucket.set(String(row.id), row);
      rows.set(table, bucket);
    }
    for (const [table, deletes] of Object.entries(entry.deletes)) {
      const bucket = rows.get(table) ?? new Map<string, Row | null>();
      for (const id of deletes) bucket.set(id, null);
      rows.set(table, bucket);
    }
  }

  const upserts: Record<string, Row[]> = {};
  const deletes: Record<string, string[]> = {};
  for (const [table, bucket] of rows) {
    const live = [...bucket.values()].filter((row): row is Row => row !== null);
    const removed = [...bucket.entries()].filter(([, row]) => row === null).map(([id]) => id);
    if (live.length > 0) upserts[table] = live;
    if (removed.length > 0) deletes[table] = removed;
  }

  if (!business && Object.keys(upserts).length === 0 && Object.keys(deletes).length === 0) return [];

  const oldest = queue[0];
  const entries = queue.reduce((sum, entry) => sum + Object.values(entry.upserts).flat().length, 0);
  return [
    {
      id: uid(),
      queuedAt: oldest.queuedAt,
      businessId: oldest.businessId,
      business,
      upserts,
      deletes,
      label: `${entries} pending change${entries === 1 ? '' : 's'}`,
    },
  ];
}

export function enqueue(store: KeyValueStore | null, payload: SavePayload, at = new Date().toISOString()): QueuedSave[] {
  const entry: QueuedSave = {
    ...payload,
    id: uid(),
    queuedAt: at,
    label: describePayload(payload),
  };
  const queue = [...readOutbox(store), entry];
  return writeOutbox(store, queue.length > OUTBOX_FOLD_THRESHOLD ? foldQueue(queue) : queue);
}

export function removeQueued(store: KeyValueStore | null, id: string): QueuedSave[] {
  return writeOutbox(
    store,
    readOutbox(store).filter((entry) => entry.id !== id),
  );
}

const NETWORK_SIGNS = [
  'failed to fetch',
  'networkerror',
  'network request failed',
  'network error',
  'load failed',
  'fetch failed',
  'err_internet_disconnected',
  'err_network',
  'err_name_not_resolved',
  'etimedout',
  'econnrefused',
  'econnreset',
  'timed out',
  'timeout',
  'upstream connect error',
  'bad gateway',
  'service unavailable',
];

/**
 * Tells a transport failure (retry later, keep the change) apart from a refusal
 * (the database rejected the write, so retrying it unchanged cannot help).
 */
export function isNetworkFailure(error: unknown): boolean {
  if (!error) return false;
  if (!isOnline()) return true;
  const message = (
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : typeof error === 'object'
          ? [String((error as { message?: unknown }).message ?? ''), String((error as { details?: unknown }).details ?? '')].join(' ')
          : ''
  ).toLowerCase();
  return NETWORK_SIGNS.some((sign) => message.includes(sign));
}

export function describeFailure(error: unknown): string {
  if (!error) return 'Unknown error.';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object') {
    const record = error as { message?: string; details?: string; hint?: string; code?: string };
    const parts = [record.message, record.details, record.hint].filter(Boolean);
    if (parts.length > 0) return parts.join(' — ');
    if (record.code) return `Request failed (${record.code}).`;
  }
  return 'The database request failed.';
}

export type DrainOutcome = {
  sent: number;
  remaining: QueuedSave[];
  refusals: { label: string; reason: string }[];
  offline: boolean;
};

/**
 * Sends queued changes oldest first, stopping at the first transport failure so
 * order is preserved. A refused change is dropped and reported: it was rejected
 * by the database, so keeping it would block every change behind it.
 */
export async function drainOutbox(
  store: KeyValueStore | null,
  send: (payload: SavePayload) => Promise<void>,
): Promise<DrainOutcome> {
  const refusals: { label: string; reason: string }[] = [];
  let sent = 0;
  let queue = readOutbox(store);

  while (queue.length > 0) {
    const entry = queue[0];
    try {
      await send(entry);
      sent += 1;
      queue = removeQueued(store, entry.id);
    } catch (error) {
      if (isNetworkFailure(error)) {
        return { sent, remaining: queue, refusals, offline: true };
      }
      refusals.push({ label: entry.label, reason: describeFailure(error) });
      queue = removeQueued(store, entry.id);
    }
  }

  return { sent, remaining: queue, refusals, offline: false };
}
