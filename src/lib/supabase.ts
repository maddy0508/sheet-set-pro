import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

/**
 * Without both values the application runs as a local, device-only workspace.
 * Only a publishable (anon) key belongs here: row level security does the rest, and a
 * service-role key must never be shipped to a browser.
 */
export const isSupabaseConfigured = Boolean(url && publishableKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, publishableKey as string, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    })
  : null;

export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new Error('Supabase is not configured for this build.');
  return supabase;
}

/** Turns a PostgREST/GoTrue failure into something an operator can act on. */
export function describeError(error: unknown): string {
  if (!error) return 'Unknown error.';
  if (typeof error === 'string') return error;
  if (typeof error === 'object') {
    const record = error as { message?: string; details?: string; hint?: string; code?: string };
    const parts = [record.message, record.details, record.hint].filter(Boolean);
    if (parts.length > 0) return parts.join(' — ');
    if (record.code) return `Request failed (${record.code}).`;
  }
  return 'The database request failed.';
}
