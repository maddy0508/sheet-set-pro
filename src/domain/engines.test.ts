import { describe, expect, it } from 'vitest';
import { canonicalise, ceilDiv, degToMicro, fingerprint, formatCents, mulDivRound, NumericError } from './units';
import { computeLayout } from './layout';
import { computeTotals, applyMargin } from './pricing';
import { validateRoof, orderGradeBlockers } from './validation';
import { buildBom } from './material';
import type { PlaneGeometry } from './types';

const plane = (ref: string, widthMm: number, lengthMm: number, pitchDeg = 22.5, xMm = 0): PlaneGeometry => ({
  ref,
  xMm,
  yMm: 0,
  widthMm,
  lengthMm,
  pitchMicrodeg: degToMicro(pitchDeg),
});

const verifiedCatalogue = {
  effectiveCoverMm: 762,
  minPitchMicrodeg: degToMicro(5),
  maxLengthMm: 8200,
  hasLapRule: true,
  verificationState: 'VERIFIED' as const,
};

describe('numeric core', () => {
  it('rounds ties away from zero', () => {
    expect(mulDivRound(5, 1, 2)).toBe(3);
    expect(mulDivRound(-5, 1, 2)).toBe(-3);
    expect(mulDivRound(4, 1, 2)).toBe(2);
  });

  it('refuses division by zero rather than returning Infinity', () => {
    expect(() => mulDivRound(1, 1, 0)).toThrow(NumericError);
  });

  it('computes ceiling division for positive integers', () => {
    expect(ceilDiv(6000, 762)).toBe(8);
    expect(ceilDiv(762, 762)).toBe(1);
    expect(ceilDiv(0, 762)).toBe(0);
  });

  it('rejects fractional values in canonical form', () => {
    expect(() => canonicalise({ value: 1.5 })).toThrow(NumericError);
    expect(canonicalise({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('produces a stable fingerprint regardless of key order', () => {
    expect(fingerprint({ a: 1, b: 2 })).toBe(fingerprint({ b: 2, a: 1 }));
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
  });

  it('formats money from integer cents', () => {
    expect(formatCents(123456)).toContain('1,234.56');
  });
});

describe('sheet layout', () => {
  it('derives courses from effective cover width, not nominal width', () => {
    const result = computeLayout([plane('P1', 6000, 3600)], {
      effectiveCoverMm: 762,
      maxLengthMm: 8200,
      lapTransverseMm: 150,
      eaveAllowanceMm: 60,
      topAllowanceMm: 40,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.planes[0].courses).toBe(8);
    expect(result.planes[0].segmentsPerCourse).toBe(1);
    expect(result.planes[0].sheetCount).toBe(8);
    expect(result.planes[0].overhangMm).toBe(8 * 762 - 6000);
  });

  it('splits a run longer than the maximum sheet length', () => {
    const result = computeLayout([plane('P1', 3000, 12000)], {
      effectiveCoverMm: 762,
      maxLengthMm: 8200,
      lapTransverseMm: 150,
      eaveAllowanceMm: 0,
      topAllowanceMm: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.planes[0].segmentsPerCourse).toBe(2);
    expect(result.planes[0].segments[0].lengthMm).toBe(8050);
    expect(result.planes[0].segments[1].lengthMm).toBe(3950);
  });

  it('fails explicitly when a rule is missing', () => {
    const result = computeLayout([plane('P1', 3000, 3000)], {
      effectiveCoverMm: null,
      maxLengthMm: 8200,
      lapTransverseMm: 150,
      eaveAllowanceMm: 0,
      topAllowanceMm: 0,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('RULE_MISSING');
  });
});

describe('pricing', () => {
  it('sums rounded line amounts so the document adds up', () => {
    const totals = computeTotals(
      [
        { qtyMicro: 1_500_000, unitPriceCents: 333 },
        { qtyMicro: 1_000_000, unitPriceCents: 101 },
      ],
      { gstRateBp: 1000, gstApplied: true },
    );
    expect(totals.lineAmountsCents).toEqual([500, 101]);
    expect(totals.subtotalCents).toBe(601);
    expect(totals.gstCents).toBe(60);
    expect(totals.totalCents).toBe(661);
  });

  it('omits GST when it is not applied', () => {
    const totals = computeTotals([{ qtyMicro: 1_000_000, unitPriceCents: 1000 }], { gstRateBp: 1000, gstApplied: false });
    expect(totals.gstCents).toBe(0);
    expect(totals.totalCents).toBe(1000);
  });

  it('applies margin in basis points', () => {
    expect(applyMargin(10000, 2500)).toBe(12500);
    expect(applyMargin(10000, 0)).toBe(10000);
  });
});

describe('validation', () => {
  it('blocks when no planes exist', () => {
    const issues = validateRoof([], verifiedCatalogue);
    expect(issues.some((issue) => issue.ruleId === 'GEO-017' && issue.severity === 'blocking')).toBe(true);
  });

  it('blocks overlapping planes', () => {
    const issues = validateRoof([plane('P1', 3000, 3000), plane('P2', 3000, 3000, 22.5, 1000)], verifiedCatalogue);
    const overlap = issues.find((issue) => issue.ruleId === 'GEO-006');
    expect(overlap?.severity).toBe('blocking');
    expect(overlap?.message).toContain('m² of the same plan area');
  });

  it('accepts a hipped roof, whose plane boxes overlap but whose surfaces only meet at hips', () => {
    // 6000 x 4000 hip: the front and side planes have overlapping bounding boxes, which is
    // the commonest roof there is, so a box test would make it impossible to capture.
    const hip = [
      { ...plane('F', 6000, 2828, 45), yMm: 2000, fall: 'south' as const, ridgeWidthMm: 2000 },
      { ...plane('B', 6000, 2828, 45), yMm: 0, fall: 'north' as const, ridgeWidthMm: 2000 },
      { ...plane('L', 4000, 2828, 45), yMm: 0, fall: 'west' as const, ridgeWidthMm: 0 },
      { ...plane('R', 4000, 2828, 45), xMm: 4000, yMm: 0, fall: 'east' as const, ridgeWidthMm: 0 },
    ];
    const issues = validateRoof(hip, verifiedCatalogue);
    expect(issues.some((issue) => issue.ruleId === 'GEO-006')).toBe(false);
  });

  it('treats below-minimum pitch as blocking when the catalogue is verified', () => {
    const issues = validateRoof([plane('P1', 3000, 3000, 2)], verifiedCatalogue);
    expect(issues.some((issue) => issue.ruleId === 'GEO-015' && issue.severity === 'blocking')).toBe(true);
  });

  it('downgrades below-minimum pitch to a warning without a verified catalogue', () => {
    const issues = validateRoof([plane('P1', 3000, 3000, 2)], { ...verifiedCatalogue, verificationState: 'PLACEHOLDER' });
    expect(issues.some((issue) => issue.ruleId === 'GEO-015' && issue.severity === 'warning')).toBe(true);
  });

  it('lists every order-grade blocker when nothing is prepared', () => {
    const blockers = orderGradeBlockers([], { ...verifiedCatalogue, verificationState: 'PLACEHOLDER' }, 0, false);
    expect(blockers.length).toBeGreaterThan(3);
  });

  it('allows order grade only when every condition holds', () => {
    const blockers = orderGradeBlockers([plane('P1', 3000, 3000)], verifiedCatalogue, 1, true);
    expect(blockers).toEqual([]);
  });
});

describe('bill of materials', () => {
  const layout = computeLayout([plane('P1', 6000, 3600)], {
    effectiveCoverMm: 762,
    maxLengthMm: 8200,
    lapTransverseMm: 150,
    eaveAllowanceMm: 60,
    topAllowanceMm: 40,
  });

  const profile = {
    id: 'cat',
    name: 'Test profile',
    manufacturer: 'Test',
    effectiveCoverMm: 762,
    minPitchMicrodeg: null,
    maxLengthMm: 8200,
    lapLongitudinalMm: 0,
    lapTransverseMm: 150,
    sheetPriceCentsPerM: 2000,
    fixingPerSheet: 12,
    flashingPriceCentsPerM: {
      ridge: 3000,
      hip: 3000,
      valley: 3000,
      barge: 3000,
      apron: 3000,
      box_gutter: 3000,
      eave: 3000,
    },
    priceBasis: 'SYNTHETIC' as const,
  };

  it('groups sheets by cut length and counts courses', () => {
    const bom = buildBom({ planes: [plane('P1', 6000, 3600)], layout, flashings: [], profile });
    const sheetLines = bom.lines.filter((line) => line.category === 'sheet');
    expect(sheetLines).toHaveLength(1);
    expect(sheetLines[0].quantityMicro).toBe(8_000_000);
    expect(sheetLines[0].unitPriceCents).toBe(7400);
  });

  it('prices flashing in lineal metres', () => {
    const bom = buildBom({ planes: [plane('P1', 6000, 3600)], layout, flashings: [{ kind: 'ridge', lengthMm: 6000 }], profile });
    const ridge = bom.lines.find((line) => line.key === 'flashing-ridge');
    expect(ridge?.quantityMicro).toBe(6_000_000);
    expect(ridge?.unit).toBe('m');
    expect(ridge?.unitPriceCents).toBe(3000);
  });

  it('does not invent a fastener quantity when the rule is missing', () => {
    const bom = buildBom({
      planes: [plane('P1', 6000, 3600)],
      layout,
      flashings: [],
      profile: { ...profile, fixingPerSheet: null },
    });
    expect(bom.lines.some((line) => line.category === 'fastener')).toBe(false);
    expect(bom.warnings.some((warning) => warning.includes('Fixing rule'))).toBe(true);
    expect(bom.incomplete).toBe(true);
  });

  it('flags synthetic prices as placeholders', () => {
    const bom = buildBom({ planes: [plane('P1', 6000, 3600)], layout, flashings: [], profile });
    expect(bom.lines.some((line) => line.isPlaceholder)).toBe(true);
  });

  it('returns the layout failure rather than an empty success', () => {
    const bom = buildBom({
      planes: [plane('P1', 6000, 3600)],
      layout: { ok: false, code: 'RULE_MISSING', reason: 'Effective cover width is missing.' },
      flashings: [],
      profile,
    });
    expect(bom.lines).toHaveLength(0);
    expect(bom.incomplete).toBe(true);
    expect(bom.warnings[0]).toContain('Effective cover width');
  });
});
