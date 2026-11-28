import { describe, expect, it } from 'vitest';
import { createInitialState } from './seed';
import { buildSavePayload } from './remote';
import type { AppState, Customer } from './types';

const workspace = (): AppState => {
  const base = createInitialState();
  return { ...base, company: { ...base.company, id: 'biz-1' } };
};

const customer = (id: string, name: string, at: string): Customer => ({
  id,
  name,
  contactName: '',
  email: '',
  phone: '',
  address: '',
  notes: '',
  sourceType: 'TEST',
  createdAt: at,
  updatedAt: at,
});

describe('buildSavePayload', () => {
  it('returns nothing when the state is unchanged', () => {
    const state = workspace();
    expect(buildSavePayload(state, state)).toBeNull();
  });

  it('sends only the rows that changed', () => {
    const before = workspace();
    const after: AppState = {
      ...before,
      customers: [customer('cust-1', 'Test Customer', '2026-11-28T00:00:00.000Z')],
    };

    const payload = buildSavePayload(before, after);
    expect(payload?.businessId).toBe('biz-1');
    expect(payload?.business).toBeNull();
    expect(payload?.upserts.customers).toHaveLength(1);
    expect(payload?.upserts.customers[0].id).toBe('cust-1');
    expect(payload?.deletes).toEqual({});
  });

  it('sends deletes for removed rows', () => {
    const before: AppState = {
      ...workspace(),
      customers: [customer('cust-1', 'Test Customer', '2026-11-28T00:00:00.000Z')],
    };
    const after: AppState = { ...before, customers: [] };

    expect(buildSavePayload(before, after)?.deletes).toEqual({ customers: ['cust-1'] });
  });

  it('includes the business row only when settings changed', () => {
    const before = workspace();
    const after: AppState = { ...before, company: { ...before.company, displayName: 'Mitchell Metal Roofing' } };

    const payload = buildSavePayload(before, after);
    expect(payload?.business).toMatchObject({ id: 'biz-1', display_name: 'Mitchell Metal Roofing' });
  });
});
