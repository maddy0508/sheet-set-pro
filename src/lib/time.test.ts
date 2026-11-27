import { describe, expect, it } from 'vitest';
import { normaliseTimestamp } from './time';

const FALLBACK = '2026-11-26T05:00:00.000Z';

describe('normaliseTimestamp', () => {
  it('turns a blank date field into the fallback instead of an empty string', () => {
    expect(normaliseTimestamp('', FALLBACK)).toBe(FALLBACK);
    expect(normaliseTimestamp('   ', FALLBACK)).toBe(FALLBACK);
    expect(normaliseTimestamp(null, FALLBACK)).toBe(FALLBACK);
  });

  it('keeps a real date, expressed as a full timestamp', () => {
    expect(normaliseTimestamp('2026-11-01', FALLBACK)).toBe('2026-11-01T00:00:00.000Z');
    expect(normaliseTimestamp('2026-11-01T09:30:00+11:00', FALLBACK)).toBe('2026-10-31T22:30:00.000Z');
  });

  it('falls back rather than persisting an unparseable date', () => {
    expect(normaliseTimestamp('next tuesday', FALLBACK)).toBe(FALLBACK);
  });
});
