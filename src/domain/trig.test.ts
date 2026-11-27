import { describe, expect, it } from 'vitest';
import { MICRO_UNIT, cosMicro, sinMicro, tanMicro } from './trig';
import { degToMicro } from './units';

/**
 * The table is a constant, so these tests check it against double precision once: if a
 * table entry were ever mistyped, the geometry that depends on it would be wrong on every
 * platform in the same way.
 */
describe('fixed-point trigonometry', () => {
  it('matches double precision across the whole quarter turn', () => {
    let worst = 0;
    for (let tenths = 0; tenths <= 900; tenths += 1) {
      const deg = tenths / 10;
      const micro = degToMicro(deg);
      const expectedSin = Math.sin((deg * Math.PI) / 180) * MICRO_UNIT;
      const expectedCos = Math.cos((deg * Math.PI) / 180) * MICRO_UNIT;
      worst = Math.max(worst, Math.abs(sinMicro(micro) - expectedSin), Math.abs(cosMicro(micro) - expectedCos));
    }
    // One micro-unit is a millionth. Quarter-degree sampling plus table rounding costs at
    // most a few micro-units, which is 0.05 mm over a 20 m slope.
    expect(worst).toBeLessThan(4);
  });

  it('is exact at the quarter turn', () => {
    expect(sinMicro(0)).toBe(0);
    expect(cosMicro(0)).toBe(MICRO_UNIT);
    expect(sinMicro(degToMicro(30))).toBe(500_000);
    expect(sinMicro(degToMicro(90))).toBe(MICRO_UNIT);
    expect(cosMicro(degToMicro(90))).toBe(0);
  });

  it('refuses angles outside 0–90° and non-integer micro-degrees', () => {
    expect(() => sinMicro(degToMicro(-1))).toThrow(/between 0 and 90/);
    expect(() => sinMicro(degToMicro(91))).toThrow(/between 0 and 90/);
    expect(() => sinMicro(1.5)).toThrow(/whole micro-degrees/);
  });

  it('reports an unbounded tangent at the vertical', () => {
    expect(tanMicro(degToMicro(45))).toBe(1_000_000);
    expect(tanMicro(degToMicro(90))).toBeNull();
  });
});
