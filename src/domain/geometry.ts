import { NumericError, assertLengthMm, ceilDiv, mulDivRound } from './units';
import { planRunMm } from './roof3d';
import type { PlaneGeometry } from './types';

export type PlaneMetrics = {
  ref: string;
  areaMm2: number;
  eaveLinealMm: number;
  rakeLinealMm: number;
  slopeFactorNote: string;
};

/** Width at the ridge: the eave width unless the plane is a hip end. */
export function ridgeWidthMm(plane: PlaneGeometry): number {
  if (plane.ridgeWidthMm === null || plane.ridgeWidthMm === undefined) return plane.widthMm;
  return Math.max(0, Math.min(plane.widthMm, plane.ridgeWidthMm));
}

/**
 * Area of a plane measured on the roof surface.
 *
 * A hip end narrows towards the ridge, so its surface is a trapezoid: the mean of the eave
 * and ridge widths over the slope length. A plain rectangle reduces to width x length.
 */
export function planeAreaMm2(plane: PlaneGeometry): number {
  return mulDivRound(plane.widthMm + ridgeWidthMm(plane), plane.lengthMm, 2);
}

export function planeMetrics(plane: PlaneGeometry): PlaneMetrics {
  return {
    ref: plane.ref,
    areaMm2: planeAreaMm2(plane),
    eaveLinealMm: plane.widthMm,
    rakeLinealMm: plane.lengthMm * 2,
    slopeFactorNote: 'measured along the slope',
  };
}

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

/**
 * The plane's shadow on plan. A pitched plane covers less ground than its slope length, and
 * the fall direction decides which way it lies, so overlap checks and the plan drawing use
 * the same footprint the 3D model does.
 */
export function planeBounds(plane: PlaneGeometry): Bounds {
  const runMm = planRunMm(plane.lengthMm, plane.pitchMicrodeg);
  if (plane.fall === 'east' || plane.fall === 'west') {
    return { minX: plane.xMm, minY: plane.yMm, maxX: plane.xMm + runMm, maxY: plane.yMm + plane.widthMm };
  }
  return { minX: plane.xMm, minY: plane.yMm, maxX: plane.xMm + plane.widthMm, maxY: plane.yMm + runMm };
}

export function boundsOverlap(a: Bounds, b: Bounds): boolean {
  const separated = a.maxX <= b.minX || b.maxX <= a.minX || a.maxY <= b.minY || b.maxY <= a.minY;
  return !separated;
}

export function totalAreaMm2(planes: PlaneGeometry[]): number {
  return planes.reduce((sum, plane) => sum + planeAreaMm2(plane), 0);
}

export type RoofBounds = { widthMm: number; heightMm: number };

export function roofExtent(planes: PlaneGeometry[]): RoofBounds {
  if (planes.length === 0) return { widthMm: 0, heightMm: 0 };
  let maxX = 0;
  let maxY = 0;
  for (const plane of planes) {
    const b = planeBounds(plane);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  return { widthMm: maxX, heightMm: maxY };
}

/** Scale a roof extent to fit a pixel viewport while preserving aspect ratio. */
export function fitScale(extent: RoofBounds, viewport: { width: number; height: number }, paddingMm = 400): number {
  const usableWidth = Math.max(1, viewport.width);
  const usableHeight = Math.max(1, viewport.height);
  const contentWidth = Math.max(1, extent.widthMm + paddingMm * 2);
  const contentHeight = Math.max(1, extent.heightMm + paddingMm * 2);
  return Math.min(usableWidth / contentWidth, usableHeight / contentHeight);
}

export function validatePlaneDimensions(widthMm: number, lengthMm: number): void {
  assertLengthMm(widthMm, 'width');
  assertLengthMm(lengthMm, 'length');
  if (widthMm <= 0 || lengthMm <= 0) {
    throw new NumericError('GEOMETRY_DEGENERATE', 'width and length must be greater than zero');
  }
}

/** Number of sheet courses across a plane for a given effective cover width. */
export function courseCount(widthMm: number, effectiveCoverMm: number): number {
  if (effectiveCoverMm <= 0) throw new NumericError('RULE_MISSING', 'effective cover width missing');
  return ceilDiv(widthMm, effectiveCoverMm);
}
