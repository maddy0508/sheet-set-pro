/**
 * Deterministic numeric core.
 *
 * Manufacturing dimensions are integer millimetres. Money is integer cents.
 * Nothing in this module may use floating-point division or trigonometry:
 * see the Numeric and Determinism Contract (NDC-1.0).
 */

export const MM_PER_M = 1000;
export const MICRO = 1_000_000;

/** Hard bounds. Out-of-range input is a failure, never a clamp. */
export const BOUNDS = {
  lengthMm: 20_000_000,
  pitchMicrodeg: 90_000_000,
  moneyCents: 9_000_000_000_000,
} as const;

export type FailureCode =
  | 'INPUT_OUT_OF_RANGE'
  | 'INPUT_NEGATIVE_LENGTH'
  | 'GEOMETRY_DEGENERATE'
  | 'PITCH_NOT_SUPPORTED'
  | 'CATALOGUE_INCOMPLETE'
  | 'RULE_MISSING'
  | 'NUMERIC_OVERFLOW'
  | 'DIVISION_BY_ZERO';

export class NumericError extends Error {
  readonly code: FailureCode;
  constructor(code: FailureCode, message: string) {
    super(message);
    this.name = 'NumericError';
    this.code = code;
  }
}

/** Exact integer multiply-divide with an explicit half-away-from-zero tie rule. */
export function mulDivRound(a: number, b: number, divisor: number): number {
  if (divisor === 0) throw new NumericError('DIVISION_BY_ZERO', 'divisor is zero');
  const n = BigInt(Math.trunc(a)) * BigInt(Math.trunc(b));
  const d = BigInt(Math.trunc(divisor));
  const negative = n < 0n !== d < 0n;
  const abs = n < 0n ? -n : n;
  const absD = d < 0n ? -d : d;
  const q = abs / absD;
  const r = abs % absD;
  const rounded = r * 2n >= absD ? q + 1n : q;
  const result = negative ? -rounded : rounded;
  const asNumber = Number(result);
  if (!Number.isSafeInteger(asNumber)) {
    throw new NumericError('NUMERIC_OVERFLOW', 'result exceeds safe integer range');
  }
  return asNumber;
}

/** Ceiling division for positive integers (course and segment counts). */
export function ceilDiv(numerator: number, denominator: number): number {
  if (denominator <= 0) throw new NumericError('DIVISION_BY_ZERO', 'denominator must be positive');
  if (numerator <= 0) return 0;
  return Math.floor((numerator + denominator - 1) / denominator);
}

export function assertLengthMm(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new NumericError('INPUT_OUT_OF_RANGE', `${name} is not finite`);
  const rounded = Math.trunc(value);
  if (rounded < 0) throw new NumericError('INPUT_NEGATIVE_LENGTH', `${name} must not be negative`);
  if (rounded > BOUNDS.lengthMm) {
    throw new NumericError('INPUT_OUT_OF_RANGE', `${name} exceeds ${BOUNDS.lengthMm} mm`);
  }
  return rounded;
}

export function formatMm(valueMm: number): string {
  const metres = valueMm / MM_PER_M;
  return `${metres.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;
}

export function formatCents(cents: number, currency = 'AUD'): string {
  if (!Number.isFinite(cents)) return '—';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(cents / 100);
}

export function formatAreaM2(areaMm2: number): string {
  const m2 = areaMm2 / (MM_PER_M * MM_PER_M);
  return `${m2.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²`;
}

/** Degrees <-> micro-degrees. Angles are integers end to end. */
export function degToMicro(deg: number): number {
  return Math.round(deg * MICRO);
}
export function microToDeg(micro: number): number {
  return micro / MICRO;
}

/** Deterministic content fingerprint (FNV-1a, 64-bit). Integrity, not cryptography. */
export function fingerprint(input: unknown): string {
  const text = canonicalise(input);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

/** Canonical JSON: sorted keys, no whitespace, integers only. */
export function canonicalise(value: unknown): string {
  const walk = (input: unknown): string => {
    if (input === null) return 'null';
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) throw new NumericError('INPUT_OUT_OF_RANGE', 'non-finite number');
      if (!Number.isInteger(input)) throw new NumericError('INPUT_OUT_OF_RANGE', 'non-integer in canonical form');
      return String(input === 0 ? 0 : input);
    }
    if (typeof input === 'boolean') return input ? 'true' : 'false';
    if (typeof input === 'string') return JSON.stringify(input.normalize('NFC'));
    if (Array.isArray(input)) return `[${input.map(walk).join(',')}]`;
    if (typeof input === 'object') {
      const entries = Object.entries(input as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${walk(v)}`).join(',')}}`;
    }
    throw new NumericError('INPUT_OUT_OF_RANGE', 'unsupported value in canonical form');
  };
  return walk(value);
}
