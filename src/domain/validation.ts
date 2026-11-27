import type { PlaneGeometry, ValidationIssue } from './types';
import { BOUNDS, microToDeg } from './units';
import { OVERLAP_TOLERANCE_MM2, asRoofPlane, planePlanCorners, polygonOverlapAreaMm2 } from './roof3d';

export type CatalogueContext = {
  effectiveCoverMm: number | null;
  minPitchMicrodeg: number | null;
  maxLengthMm: number | null;
  hasLapRule: boolean;
  verificationState: 'PLACEHOLDER' | 'PARTIAL' | 'VERIFIED';
};

export const EMPTY_CATALOGUE: CatalogueContext = {
  effectiveCoverMm: null,
  minPitchMicrodeg: null,
  maxLengthMm: null,
  hasLapRule: false,
  verificationState: 'PLACEHOLDER',
};

/**
 * Geometry validation. Each rule reports rather than repairs: a repair would hide the
 * condition that the operator needs to see.
 */
export function validateRoof(planes: PlaneGeometry[], catalogue: CatalogueContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (planes.length === 0) {
    issues.push({
      ruleId: 'GEO-017',
      severity: 'blocking',
      message: 'No roof planes have been captured for this job.',
    });
    return issues;
  }

  const seenRefs = new Set<string>();
  for (const plane of planes) {
    const ref = plane.ref || '(unnamed)';
    if (!plane.ref.trim()) {
      issues.push({ ruleId: 'GEO-001', severity: 'warning', message: 'A plane has no reference label.' });
    }
    if (seenRefs.has(ref)) {
      issues.push({
        ruleId: 'GEO-001',
        severity: 'blocking',
        message: `Duplicate plane reference "${ref}".`,
        subjectRef: ref,
      });
    }
    seenRefs.add(ref);

    if (plane.widthMm <= 0 || plane.lengthMm <= 0) {
      issues.push({
        ruleId: 'GEO-004',
        severity: 'blocking',
        message: `Plane ${ref} has zero or negative dimensions.`,
        subjectRef: ref,
      });
    }
    if (plane.widthMm > BOUNDS.lengthMm || plane.lengthMm > BOUNDS.lengthMm) {
      issues.push({
        ruleId: 'GEO-004',
        severity: 'blocking',
        message: `Plane ${ref} exceeds the supported maximum dimension.`,
        subjectRef: ref,
      });
    }
    if (plane.pitchMicrodeg < 0 || plane.pitchMicrodeg > BOUNDS.pitchMicrodeg) {
      issues.push({
        ruleId: 'GEO-005',
        severity: 'blocking',
        message: `Plane ${ref} pitch is outside 0–90°.`,
        subjectRef: ref,
      });
    }
  }

  // Overlap is measured on the plan outline of each plane, not its bounding box. A hipped
  // or valley roof has planes whose boxes overlap where the trapezoids only meet along a
  // hip, and calling that an overlap would make the commonest roof shapes impossible to
  // capture. What is left is a genuine double count: the same square metre measured twice.
  for (let i = 0; i < planes.length; i += 1) {
    for (let j = i + 1; j < planes.length; j += 1) {
      const shared = polygonOverlapAreaMm2(planePlanCorners(asRoofPlane(planes[i])), planePlanCorners(asRoofPlane(planes[j])));
      if (shared > OVERLAP_TOLERANCE_MM2) {
        issues.push({
          ruleId: 'GEO-006',
          severity: 'blocking',
          message: `Planes ${planes[i].ref} and ${planes[j].ref} cover ${(shared / 1_000_000).toFixed(2)} m² of the same plan area: that area would be sheeted and ordered twice.`,
          subjectRef: planes[i].ref,
        });
      }
    }
  }

  if (catalogue.minPitchMicrodeg !== null) {
    for (const plane of planes) {
      if (plane.pitchMicrodeg < catalogue.minPitchMicrodeg) {
        const belowBy = microToDeg(catalogue.minPitchMicrodeg - plane.pitchMicrodeg);
        issues.push({
          ruleId: 'GEO-015',
          severity: catalogue.verificationState === 'VERIFIED' ? 'blocking' : 'warning',
          message: `Plane ${ref(plane)} is ${belowBy.toFixed(1)}° below the product minimum pitch of ${microToDeg(
            catalogue.minPitchMicrodeg,
          ).toFixed(1)}°.`,
          subjectRef: plane.ref,
        });
      }
    }
  }

  if (catalogue.maxLengthMm !== null) {
    for (const plane of planes) {
      if (plane.lengthMm > catalogue.maxLengthMm) {
        issues.push({
          ruleId: 'GEO-019',
          severity: 'warning',
          message: `Plane ${ref(plane)} is longer than the maximum sheet length; it will be split across segments.`,
          subjectRef: plane.ref,
        });
      }
    }
  }

  if (catalogue.verificationState !== 'VERIFIED') {
    issues.push({
      ruleId: 'CAT-002',
      severity: 'warning',
      message: 'The selected product specification is not verified. Order-grade output is unavailable.',
    });
  }

  return issues;
}

function ref(plane: PlaneGeometry): string {
  return plane.ref || '(unnamed)';
}

export function hasBlockingIssue(issues: ValidationIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'blocking');
}

/** Conditions that must all hold before any order-grade claim is possible. */
export function orderGradeBlockers(
  planes: PlaneGeometry[],
  catalogue: CatalogueContext,
  verifiedControlDimensions: number,
  operatorApproved: boolean,
): string[] {
  const blockers: string[] = [];
  if (planes.length === 0) blockers.push('No roof geometry captured.');
  if (catalogue.verificationState !== 'VERIFIED') blockers.push('Product specification is not verified.');
  if (catalogue.effectiveCoverMm === null) blockers.push('Effective cover width is missing.');
  if (catalogue.minPitchMicrodeg === null) blockers.push('Minimum pitch is missing.');
  if (catalogue.maxLengthMm === null) blockers.push('Maximum sheet length is missing.');
  if (!catalogue.hasLapRule) blockers.push('Lap rule is missing.');
  if (verifiedControlDimensions === 0) blockers.push('No verified control dimensions.');
  if (!operatorApproved) blockers.push('Operator approval has not been recorded.');
  return blockers;
}
