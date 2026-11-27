/**
 * Operator-entered dates reach the database as timestamps. A date input left blank
 * yields '', which Postgres rejects as an invalid timestamp rather than storing null,
 * so every value is normalised at the boundary before it is committed.
 */
export function normaliseTimestamp(value: string | null | undefined, fallback: string): string {
  if (!value || !value.trim()) return fallback;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? fallback : new Date(parsed).toISOString();
}
