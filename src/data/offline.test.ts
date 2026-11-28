import { beforeEach, describe, expect, it } from 'vitest';
import { createInitialState } from './seed';
import { readCache, writeCache, clearCache } from './offline';
import type { KeyValueStore, SavePayload } from './offline';
import {
  OUTBOX_FOLD_THRESHOLD,
  describePayload,
  drainOutbox,
  enqueue,
  foldQueue,
  isNetworkFailure,
  readOutbox,
  removeQueued,
  writeOutbox,
} from './offline';
import type { AppState } from './types';

/** Stands in for the browser's local storage, which does not exist under Node. */
function memoryStore(): KeyValueStore & { dump: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    dump: data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const payload = (id: string, tables: string[] = ['jobs']): SavePayload => ({
  businessId: 'biz-1',
  business: null,
  upserts: Object.fromEntries(tables.map((table) => [table, [{ id, table }]])),
  deletes: {},
});

describe('workspace cache', () => {
  let store: ReturnType<typeof memoryStore>;

  beforeEach(() => {
    store = memoryStore();
  });

  it('round-trips the workspace with a timestamp', () => {
    const state = { ...createInitialState(), company: { ...createInitialState().company, id: 'biz-1' } };
    const savedAt = writeCache(store, state, '2026-11-28T01:00:00.000Z');

    const cached = readCache(store);
    expect(savedAt).toBe('2026-11-28T01:00:00.000Z');
    expect(cached?.businessId).toBe('biz-1');
    expect(cached?.state.jobs).toEqual(state.jobs);
  });

  it('ignores a cache written by a different state shape', () => {
    store.setItem('sheet-set-pro.workspace-cache.v1', JSON.stringify({ savedAt: 'x', businessId: 'biz-1', state: { version: 2 } }));
    expect(readCache(store)).toBeNull();
  });

  it('ignores a cache with no workspace id', () => {
    const state = createInitialState();
    writeCache(store, { ...state, company: { ...state.company, id: '' } });
    expect(readCache(store)).toBeNull();
  });

  it('trims bulky collections when the store refuses the full copy', () => {
    const state: AppState = {
      ...createInitialState(),
      company: { ...createInitialState().company, id: 'biz-1' },
      activity: Array.from({ length: 500 }, (_, index) => ({
        id: `a-${index}`,
        at: '2026-11-28T00:00:00.000Z',
        type: 'job.updated',
        subjectType: 'job' as const,
        subjectId: 'job-1',
        detail: 'x'.repeat(200),
      })),
    };
    const full = JSON.stringify(state);
    let limit = full.length - 10;
    const limited: KeyValueStore = {
      getItem: (key) => store.getItem(key),
      setItem: (key, value) => {
        if (value.length > limit) throw new Error('QuotaExceededError');
        store.setItem(key, value);
      },
      removeItem: (key) => store.removeItem(key),
    };
    // Allow only the trimmed copy: activity drops from 500 entries to 100.
    limit = full.length;

    expect(writeCache(limited, state)).not.toBeNull();
    expect(readCache(store)?.state.activity.length).toBe(100);
  });

  it('clears the device copy', () => {
    const state = { ...createInitialState(), company: { ...createInitialState().company, id: 'biz-1' } };
    writeCache(store, state);
    clearCache(store);
    expect(readCache(store)).toBeNull();
  });
});

describe('outbox', () => {
  let store: ReturnType<typeof memoryStore>;

  beforeEach(() => {
    store = memoryStore();
  });

  it('keeps queued changes in the order they were made', () => {
    enqueue(store, payload('job-1'), '2026-11-28T01:00:00.000Z');
    enqueue(store, payload('job-2'), '2026-11-28T01:01:00.000Z');

    expect(readOutbox(store).map((entry) => entry.upserts.jobs[0].id)).toEqual(['job-1', 'job-2']);
    expect(readOutbox(store)[0].label).toBe('jobs');
  });

  it('describes a payload by the tables it touches', () => {
    expect(describePayload(payload('id-1', ['jobs', 'planes']))).toBe('jobs and planes');
    expect(describePayload({ businessId: 'b', business: { id: 'b' }, upserts: {}, deletes: {} })).toBe('business settings');
    expect(describePayload({ businessId: 'b', business: null, upserts: {}, deletes: {} })).toBe('No changes');
  });

  it('removes a sent change and leaves the rest', () => {
    enqueue(store, payload('job-1'));
    enqueue(store, payload('job-2'));
    const first = readOutbox(store)[0];

    removeQueued(store, first.id);
    expect(readOutbox(store).map((entry) => entry.upserts.jobs[0].id)).toEqual(['job-2']);
  });

  it('folds a long queue into one payload that means the same thing', () => {
    enqueue(store, { ...payload('job-1'), upserts: { jobs: [{ id: 'job-1', title: 'First' }] } });
    enqueue(store, { ...payload('job-1'), upserts: { jobs: [{ id: 'job-1', title: 'Second' }] } });
    enqueue(store, { ...payload('job-2'), deletes: { jobs: ['job-2'] }, upserts: {} });

    const folded = foldQueue(readOutbox(store));
    expect(folded).toHaveLength(1);
    expect(folded[0].upserts.jobs).toEqual([{ id: 'job-1', title: 'Second' }]);
    expect(folded[0].deletes.jobs).toEqual(['job-2']);
    expect(folded[0].label).toBe('2 pending changes');
  });

  it('folds automatically so a long queue cannot grow without bound', () => {
    for (let index = 0; index < OUTBOX_FOLD_THRESHOLD + 5; index += 1) {
      enqueue(store, payload(`job-${index}`));
    }
    const queue = readOutbox(store);
    const kept = queue.flatMap((entry) => entry.upserts.jobs.map((row) => String(row.id)));

    expect(queue.length).toBeLessThanOrEqual(OUTBOX_FOLD_THRESHOLD);
    expect(kept).toHaveLength(OUTBOX_FOLD_THRESHOLD + 5);
    expect(new Set(kept).size).toBe(OUTBOX_FOLD_THRESHOLD + 5);
  });

  it('survives a malformed queue rather than throwing', () => {
    store.setItem('sheet-set-pro.outbox.v1', 'not json');
    expect(readOutbox(store)).toEqual([]);
  });

  it('clears storage when the queue empties', () => {
    enqueue(store, payload('job-1'));
    writeOutbox(store, []);
    expect(store.dump.has('sheet-set-pro.outbox.v1')).toBe(false);
  });
});

describe('drainOutbox', () => {
  let store: ReturnType<typeof memoryStore>;

  beforeEach(() => {
    store = memoryStore();
  });

  it('sends everything and empties the queue', async () => {
    enqueue(store, payload('job-1'));
    enqueue(store, payload('job-2'));
    const sent: string[] = [];

    const outcome = await drainOutbox(store, async (entry) => {
      sent.push(String(entry.upserts.jobs[0].id));
    });

    expect(sent).toEqual(['job-1', 'job-2']);
    expect(outcome).toMatchObject({ sent: 2, offline: false, refusals: [] });
    expect(outcome.remaining).toEqual([]);
    expect(readOutbox(store)).toEqual([]);
  });

  it('stops at a transport failure and keeps the rest, in order', async () => {
    enqueue(store, payload('job-1'));
    enqueue(store, payload('job-2'));
    enqueue(store, payload('job-3'));

    const outcome = await drainOutbox(store, async (entry) => {
      if (entry.upserts.jobs[0].id === 'job-2') throw new TypeError('Failed to fetch');
    });

    expect(outcome.sent).toBe(1);
    expect(outcome.offline).toBe(true);
    expect(outcome.remaining.map((entry) => entry.upserts.jobs[0].id)).toEqual(['job-2', 'job-3']);
    expect(readOutbox(store).map((entry) => entry.upserts.jobs[0].id)).toEqual(['job-2', 'job-3']);
  });

  it('drops a refused change, reports it, and continues', async () => {
    enqueue(store, payload('job-1'));
    enqueue(store, payload('job-2'));

    const outcome = await drainOutbox(store, async (entry) => {
      if (entry.upserts.jobs[0].id === 'job-1') throw new Error('Saving the workspace (jobs): new row violates check constraint');
    });

    expect(outcome.sent).toBe(1);
    expect(outcome.offline).toBe(false);
    expect(outcome.refusals).toHaveLength(1);
    expect(outcome.refusals[0].reason).toContain('check constraint');
    expect(outcome.remaining).toEqual([]);
    expect(readOutbox(store)).toEqual([]);
  });

  it('does nothing with an empty queue', async () => {
    const outcome = await drainOutbox(store, async () => {
      throw new Error('should not be called');
    });
    expect(outcome).toMatchObject({ sent: 0, remaining: [], refusals: [], offline: false });
  });
});

describe('failure classification', () => {
  it('treats dropped connections as retryable', () => {
    expect(isNetworkFailure(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkFailure(new Error('TypeError: Failed to fetch at postgrest'))).toBe(true);
    expect(isNetworkFailure({ message: 'TypeError: Failed to fetch', details: 'net::ERR_INTERNET_DISCONNECTED' })).toBe(true);
    expect(isNetworkFailure(new Error('Load failed'))).toBe(true);
  });

  it('treats a proxy outage as retryable rather than a refusal', () => {
    expect(isNetworkFailure({ message: 'upstream connect error or disconnect/reset before headers' })).toBe(true);
    expect(isNetworkFailure(new Error('Service Unavailable'))).toBe(true);
  });

  it('treats database refusals as final', () => {
    expect(isNetworkFailure(new Error('Saving the workspace (jobs): violates foreign key constraint'))).toBe(false);
    expect(isNetworkFailure({ message: 'new row violates row-level security policy', code: '42501' })).toBe(false);
    expect(isNetworkFailure(null)).toBe(false);
  });
});
