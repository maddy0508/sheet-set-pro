import { NumericError, ceilDiv } from './units';
import type { PlaneGeometry } from './types';

export type LayoutRules = {
  effectiveCoverMm: number | null;
  maxLengthMm: number | null;
  lapTransverseMm: number;
  eaveAllowanceMm: number;
  topAllowanceMm: number;
};

export type LayoutSegment = { index: number; lengthMm: number };

export type PlaneLayout = {
  ref: string;
  courses: number;
  segmentsPerCourse: number;
  segments: LayoutSegment[];
  sheetCount: number;
  coveredWidthMm: number;
  overhangMm: number;
  areaMm2: number;
};

export type LayoutResult =
  | { ok: true; planes: PlaneLayout[]; totalSheets: number; totalSheetLengthMm: number }
  | { ok: false; code: string; reason: string };

/**
 * Sheet layout for one roof revision.
 *
 * Courses use the effective cover width, not the nominal width: using the nominal width
 * leaves the roof one lap short per course.
 */
export function computeLayout(planes: PlaneGeometry[], rules: LayoutRules): LayoutResult {
  if (rules.effectiveCoverMm === null || rules.effectiveCoverMm <= 0) {
    return { ok: false, code: 'RULE_MISSING', reason: 'Effective cover width is not configured for this product.' };
  }
  if (rules.maxLengthMm === null || rules.maxLengthMm <= 0) {
    return { ok: false, code: 'RULE_MISSING', reason: 'Maximum sheet length is not configured for this product.' };
  }
  if (planes.length === 0) {
    return { ok: false, code: 'GEOMETRY_DEGENERATE', reason: 'No roof planes to lay out.' };
  }

  const usableLengthMm = rules.maxLengthMm - rules.lapTransverseMm;
  if (usableLengthMm <= 0) {
    return { ok: false, code: 'RULE_MISSING', reason: 'Transverse lap leaves no usable sheet length.' };
  }

  const layouts: PlaneLayout[] = [];
  let totalSheets = 0;
  let totalSheetLengthMm = 0;

  for (const plane of planes) {
    const courses = ceilDiv(plane.widthMm, rules.effectiveCoverMm);
    const targetLengthMm = plane.lengthMm + rules.eaveAllowanceMm + rules.topAllowanceMm;
    const segmentCount = ceilDiv(targetLengthMm, usableLengthMm);

    const segments: LayoutSegment[] = [];
    let remaining = targetLengthMm;
    for (let i = 0; i < segmentCount; i += 1) {
      const length = Math.min(usableLengthMm, remaining);
      if (length <= 0) throw new NumericError('GEOMETRY_DEGENERATE', 'segment length collapsed to zero');
      segments.push({ index: i + 1, lengthMm: length });
      remaining -= length;
    }

    const sheetCount = courses * segmentCount;
    const coveredWidthMm = courses * rules.effectiveCoverMm;

    totalSheets += sheetCount;
    totalSheetLengthMm += segments.reduce((sum, s) => sum + s.lengthMm, 0) * courses;

    layouts.push({
      ref: plane.ref,
      courses,
      segmentsPerCourse: segmentCount,
      segments,
      sheetCount,
      coveredWidthMm,
      overhangMm: coveredWidthMm - plane.widthMm,
      areaMm2: plane.widthMm * plane.lengthMm,
    });
  }

  return { ok: true, planes: layouts, totalSheets, totalSheetLengthMm };
}
