import { describeError, requireSupabase } from '@/lib/supabase';
import { COLLECTION_ORDER, TABLE_PLANS, companyFromRow, companyToRow, diffState } from './persistence';
import type { AppState } from './types';

type Row = Record<string, unknown>;

export type WorkspaceStatus = {
  businessId: string;
  displayName: string;
  claimed: boolean;
  isMember: boolean;
};

const fail = (context: string, error: unknown): never => {
  throw new Error(`${context}: ${describeError(error)}`);
};

/** What a signed-in user is allowed to know before they belong to a workspace. */
export async function fetchWorkspaceStatus(): Promise<WorkspaceStatus | null> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('workspace_status');
  if (error) return fail('Reading the workspace', error);
  const row = Array.isArray(data) ? (data[0] as Row | undefined) : (data as Row | null);
  if (!row) return null;
  return {
    businessId: String(row.business_id),
    displayName: String(row.display_name ?? ''),
    claimed: row.claimed === true,
    isMember: row.is_member === true,
  };
}

/** The first signed-in user takes ownership of a workspace that has no owner yet. */
export async function claimWorkspace(businessId: string): Promise<boolean> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('claim_workspace', { p_business_id: businessId });
  if (error) return fail('Claiming the workspace', error);
  return data === true;
}

export async function signIn(email: string, password: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) return fail('Signing in', error);
}

export async function signOut(): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.auth.signOut();
  if (error) return fail('Signing out', error);
}

export async function loadWorkspace(): Promise<AppState> {
  const client = requireSupabase();

  const business = await client.from('businesses').select('*').limit(1).maybeSingle();
  if (business.error) return fail('Reading the business record', business.error);
  if (!business.data) {
    throw new Error(
      'No workspace exists yet. Apply the migrations in supabase/migrations to this project, then reload.',
    );
  }

  const company = companyFromRow(business.data as Row);

  const loaded = await Promise.all(
    COLLECTION_ORDER.map(async (collection) => {
      const plan = TABLE_PLANS[collection];
      const fromRow = plan.fromRow as (row: Row) => unknown;
      let query = client
        .from(plan.table)
        .select('*')
        .order(plan.orderBy.column, { ascending: plan.orderBy.ascending });
      if (collection === 'activity') query = query.limit(500);
      const { data, error } = await query;
      if (error) return fail(`Reading ${plan.table}`, error);
      return { collection, entities: (data ?? []).map((row) => fromRow(row as Row)) };
    }),
  );

  const state = {
    version: 1,
    company,
    customers: [],
    jobs: [],
    planes: [],
    flashings: [],
    evidence: [],
    measurements: [],
    catalogue: [],
    estimates: [],
    quotes: [],
    invoices: [],
    payments: [],
    allocations: [],
    snapshots: [],
    activity: [],
  } as AppState;

  for (const { collection, entities } of loaded) {
    (state[collection] as unknown[]) = entities;
  }

  return state;
}

/**
 * Writes only what changed. Callers await this before telling the operator the change
 * was saved; a rejection here is a real failure, never something to swallow.
 */
export async function persistStateChange(previous: AppState, next: AppState): Promise<void> {
  const client = requireSupabase();
  const businessId = next.company.id;

  if (JSON.stringify(previous.company) !== JSON.stringify(next.company)) {
    const { error } = await client.from('businesses').update(companyToRow(next.company)).eq('id', businessId);
    if (error) return fail('Saving business settings', error);
  }

  const changes = diffState(previous, next, businessId);

  for (const change of changes) {
    if (change.upserts.length === 0) continue;
    const { error } = await client.from(change.table).upsert(change.upserts, { onConflict: 'id' });
    if (error) return fail(`Saving ${change.upserts.length} ${change.table} record(s)`, error);
  }

  for (const change of [...changes].reverse()) {
    if (change.deletes.length === 0) continue;
    const { error } = await client.from(change.table).delete().in('id', change.deletes);
    if (error) return fail(`Removing ${change.deletes.length} ${change.table} record(s)`, error);
  }
}
