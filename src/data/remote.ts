import { describeError, requireSupabase } from '@/lib/supabase';
import { COLLECTION_ORDER, TABLE_PLANS, companyFromRow, companyToRow, diffState } from './persistence';
import type { SavePayload } from './offline';
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
    supplierExports: [],
    activity: [],
  } as AppState;

  for (const { collection, entities } of loaded) {
    (state[collection] as unknown[]) = entities;
  }

  return state;
}

/**
 * Writes only what changed, in one database transaction.
 *
 * Every part of a save travels in a single RPC, so a refusal anywhere leaves the database
 * exactly as it was: the operator never ends up with a job status that describes a quote
 * the database would not store. Callers await this before telling the operator the change
 * was saved; a rejection here is a real failure, never something to swallow.
 */
export async function persistStateChange(previous: AppState, next: AppState): Promise<void> {
  const payload = buildSavePayload(previous, next);
  if (!payload) return;
  await sendSavePayload(payload);
}

/**
 * Turns two states into the payload the database function expects, or null when
 * nothing changed. The same payload is what the offline queue stores and replays.
 */
export function buildSavePayload(previous: AppState, next: AppState): SavePayload | null {
  const businessId = next.company.id;
  const businessChanged = JSON.stringify(previous.company) !== JSON.stringify(next.company);
  const changes = diffState(previous, next, businessId);

  const upserts: Record<string, Row[]> = {};
  const deletes: Record<string, string[]> = {};

  for (const change of changes) {
    if (change.upserts.length > 0) upserts[change.table] = change.upserts;
    if (change.deletes.length > 0) deletes[change.table] = change.deletes;
  }

  if (!businessChanged && Object.keys(upserts).length === 0 && Object.keys(deletes).length === 0) return null;

  return {
    businessId,
    business: businessChanged ? companyToRow(next.company) : null,
    upserts,
    deletes,
  };
}

export async function sendSavePayload(payload: SavePayload): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc('save_workspace', {
    p_business_id: payload.businessId,
    p_business: payload.business,
    p_upserts: payload.upserts,
    p_deletes: payload.deletes,
  });

  if (error) {
    // Name the parts of the save so a refusal points at the records it was writing;
    // the database's own message says why.
    const scope = [
      ...(payload.business ? ['business settings'] : []),
      ...Object.keys(payload.upserts),
      ...Object.keys(payload.deletes),
    ];
    return fail(`Saving the workspace (${scope.join(', ')})`, error);
  }
}
