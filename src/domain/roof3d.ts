/**
 * The roof as a 3D surface, derived from the measured planes.
 *
 * This module is the single source of truth for roof shape: the plan view, the 3D model,
 * the derived flashing runs and the geometry issues all read the same surfaces. Nothing
 * downstream may re-derive shape from raw rows, so the picture on screen and the numbers
 * in the estimate cannot drift apart.
 *
 * A plane is a trapezoid: an eave of `widthMm` across the slope, a ridge of
 * `ridgeWidthMm` (defaulting to the eave width) one horizontal run uphill, and two rakes
 * joining them. A ridge shorter than the eave is a hip end, which is how hipped roofs are
 * captured: the rakes then run at 45° in plan and meet the neighbouring planes' rakes.
 *
 * Coordinates: x/y are plan millimetres in the job's local metric frame (y increases
 * "south"), z is height above the eave datum. All arithmetic is integer.
 */
import { NumericError, mulDivRound } from './units';
import { MICRO_UNIT, cosMicro, sinMicro } from './trig';

/** The direction water runs off a plane: the eave is the low edge. */
export type Fall = 'north' | 'south' | 'east' | 'west';

export const FALL_DIRECTIONS: readonly Fall[] = ['north', 'south', 'east', 'west'];

export function isFall(value: unknown): value is Fall {
  return typeof value === 'string' && (FALL_DIRECTIONS as readonly string[]).includes(value);
}

export type RoofPlaneInput = {
  id: string;
  ref: string;
  xMm: number;
  yMm: number;
  widthMm: number;
  lengthMm: number;
  pitchMicrodeg: number;
  fall: Fall;
  /** Ridge length across the slope. Shorter than the eave width makes a hip end. */
  ridgeWidthMm?: number | null;
};

export type Vec3 = { xMm: number; yMm: number; zMm: number };

export type Footprint = { minXMm: number; minYMm: number; maxXMm: number; maxYMm: number };

export type RoofSurface = {
  id: string;
  ref: string;
  fall: Fall;
  pitchMicrodeg: number;
  footprint: Footprint;
  /** Horizontal run of the slope, millimetres. */
  runMm: number;
  /** Vertical rise from eave to ridge, millimetres. */
  riseMm: number;
  ridgeWidthMm: number;
  /** Surface area measured on the slope. */
  slopeAreaMm2: number;
  /** Area of the shadow the plane casts on plan. */
  planAreaMm2: number;
  /** Ridge start, ridge end, eave end, eave start. */
  corners: [Vec3, Vec3, Vec3, Vec3];
};

/** `seam` is where two measured planes abut on the same surface: no flashing is needed. */
export type RoofEdgeKind = 'ridge' | 'hip' | 'valley' | 'eave' | 'barge' | 'apron' | 'seam';

/** The kinds a roofer orders flashing for. */
export const FLASHABLE_EDGE_KINDS = ['ridge', 'hip', 'valley', 'barge', 'apron', 'eave'] as const;
export type FlashableEdgeKind = (typeof FLASHABLE_EDGE_KINDS)[number];

export type RoofEdge = {
  kind: RoofEdgeKind;
  from: Vec3;
  to: Vec3;
  /** True 3D length, so an inclined hip is measured along its incline. */
  lengthMm: number;
  /** Plane refs the edge belongs to; one ref means an open edge. */
  planes: string[];
};

export type RoofIssue = {
  ruleId: string;
  severity: 'blocking' | 'warning';
  message: string;
  subjectRef?: string;
};

export type RoofModel = {
  surfaces: RoofSurface[];
  edges: RoofEdge[];
  issues: RoofIssue[];
  bounds: Footprint & { maxZMm: number };
  planAreaMm2: number;
  slopeAreaMm2: number;
  totals: Record<RoofEdgeKind, number>;
};

export type PlaneLike = {
  id: string;
  ref: string;
  xMm: number;
  yMm: number;
  widthMm: number;
  lengthMm: number;
  pitchMicrodeg: number;
  fall?: Fall;
  ridgeWidthMm?: number | null;
};

/**
 * Planes captured before the fall direction existed rise up the page, which is the drafting
 * convention they were drawn under, so they are read as falling south. The database applies
 * the same default.
 */
export function asRoofPlane(plane: PlaneLike): RoofPlaneInput {
  return { ...plane, fall: plane.fall ?? 'south' };
}

/** Horizontal distance covered by a slope length at a pitch. */
export function planRunMm(lengthMm: number, pitchMicrodeg: number): number {
  return mulDivRound(lengthMm, cosMicro(pitchMicrodeg), MICRO_UNIT);
}

/** Height gained over a slope length at a pitch. */
export function planRiseMm(lengthMm: number, pitchMicrodeg: number): number {
  return mulDivRound(lengthMm, sinMicro(pitchMicrodeg), MICRO_UNIT);
}

/** The plane's shadow on plan. The fall direction decides which side is the eave. */
export function planeFootprint(plane: RoofPlaneInput): Footprint {
  const runMm = planRunMm(plane.lengthMm, plane.pitchMicrodeg);
  if (plane.fall === 'east' || plane.fall === 'west') {
    return {
      minXMm: plane.xMm,
      maxXMm: plane.xMm + runMm,
      minYMm: plane.yMm,
      maxYMm: plane.yMm + plane.widthMm,
    };
  }
  return {
    minXMm: plane.xMm,
    maxXMm: plane.xMm + plane.widthMm,
    minYMm: plane.yMm,
    maxYMm: plane.yMm + runMm,
  };
}

/** Ridge width actually used: the eave width unless a hip end narrows it. */
export function effectiveRidgeWidthMm(plane: RoofPlaneInput): number {
  if (plane.ridgeWidthMm === null || plane.ridgeWidthMm === undefined) return plane.widthMm;
  return Math.max(0, Math.min(plane.widthMm, plane.ridgeWidthMm));
}

/** Height of the plane's surface above the eave datum at a plan point. */
export function surfaceZ(plane: RoofPlaneInput, xMm: number, yMm: number): number {
  const runMm = planRunMm(plane.lengthMm, plane.pitchMicrodeg);
  if (runMm <= 0) return 0;
  const riseMm = planRiseMm(plane.lengthMm, plane.pitchMicrodeg);
  const footprint = planeFootprint(plane);
  switch (plane.fall) {
    case 'south':
      return mulDivRound(riseMm, footprint.maxYMm - yMm, runMm);
    case 'north':
      return mulDivRound(riseMm, yMm - footprint.minYMm, runMm);
    case 'east':
      return mulDivRound(riseMm, footprint.maxXMm - xMm, runMm);
    case 'west':
      return mulDivRound(riseMm, xMm - footprint.minXMm, runMm);
  }
}

type PlanPoint = { xMm: number; yMm: number };

type Side = {
  planeIndex: number;
  role: 'eave' | 'ridge' | 'rake';
  from: PlanPoint;
  to: PlanPoint;
  shared: boolean;
};

function sub(a: PlanPoint, b: PlanPoint): PlanPoint {
  return { xMm: a.xMm - b.xMm, yMm: a.yMm - b.yMm };
}

function dot(a: PlanPoint, b: PlanPoint): number {
  return a.xMm * b.xMm + a.yMm * b.yMm;
}

function cross(a: PlanPoint, b: PlanPoint): number {
  return a.xMm * b.yMm - a.yMm * b.xMm;
}

function intSqrt(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new NumericError('INPUT_OUT_OF_RANGE', 'square root of a negative length');
  }
  const n = BigInt(Math.trunc(value));
  if (n < 2n) return Number(n);
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return Number(x);
}

function distanceMm(from: Vec3, to: Vec3): number {
  const dx = to.xMm - from.xMm;
  const dy = to.yMm - from.yMm;
  const dz = to.zMm - from.zMm;
  return intSqrt(dx * dx + dy * dy + dz * dz);
}

/** Area of a plan polygon (shoelace), so a hip end counts as the triangle it is. */
function polygonAreaMm2(points: PlanPoint[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    sum += current.xMm * next.yMm - next.xMm * current.yMm;
  }
  return Math.abs(sum) / 2;
}

/** Corners in plan, ordered ridge start, ridge end, eave end, eave start. */
function planeCorners(plane: RoofPlaneInput): [PlanPoint, PlanPoint, PlanPoint, PlanPoint] {
  const { minXMm, maxXMm, minYMm, maxYMm } = planeFootprint(plane);
  const acrossMm = plane.fall === 'east' || plane.fall === 'west' ? maxYMm - minYMm : maxXMm - minXMm;
  const inset = Math.max(0, Math.round((acrossMm - effectiveRidgeWidthMm(plane)) / 2));

  switch (plane.fall) {
    case 'south':
      return [
        { xMm: minXMm + inset, yMm: minYMm },
        { xMm: maxXMm - inset, yMm: minYMm },
        { xMm: maxXMm, yMm: maxYMm },
        { xMm: minXMm, yMm: maxYMm },
      ];
    case 'north':
      return [
        { xMm: minXMm + inset, yMm: maxYMm },
        { xMm: maxXMm - inset, yMm: maxYMm },
        { xMm: maxXMm, yMm: minYMm },
        { xMm: minXMm, yMm: minYMm },
      ];
    case 'east':
      return [
        { xMm: minXMm, yMm: minYMm + inset },
        { xMm: minXMm, yMm: maxYMm - inset },
        { xMm: maxXMm, yMm: maxYMm },
        { xMm: maxXMm, yMm: minYMm },
      ];
    case 'west':
      return [
        { xMm: maxXMm, yMm: minYMm + inset },
        { xMm: maxXMm, yMm: maxYMm - inset },
        { xMm: minXMm, yMm: maxYMm },
        { xMm: minXMm, yMm: minYMm },
      ];
  }
}

function planeSides(plane: RoofPlaneInput, planeIndex: number): Side[] {
  const [ridgeStart, ridgeEnd, eaveEnd, eaveStart] = planeCorners(plane);
  return [
    { planeIndex, role: 'ridge', from: ridgeStart, to: ridgeEnd, shared: false },
    { planeIndex, role: 'eave', from: eaveStart, to: eaveEnd, shared: false },
    { planeIndex, role: 'rake', from: ridgeStart, to: eaveStart, shared: false },
    { planeIndex, role: 'rake', from: ridgeEnd, to: eaveEnd, shared: false },
  ];
}

/** Which way the surface tilts, over one run. */
function fallGradient(plane: RoofPlaneInput): PlanPoint {
  const riseMm = planRiseMm(plane.lengthMm, plane.pitchMicrodeg);
  switch (plane.fall) {
    case 'south':
      return { xMm: 0, yMm: -riseMm };
    case 'north':
      return { xMm: 0, yMm: riseMm };
    case 'east':
      return { xMm: -riseMm, yMm: 0 };
    case 'west':
      return { xMm: riseMm, yMm: 0 };
  }
}

/** Does the surface rise as you walk away from this edge into the plane? */
function fallsInto(plane: RoofPlaneInput, from: PlanPoint, to: PlanPoint): boolean {
  return risesAwayFrom(plane, from, to);
}

function risesAwayFrom(plane: RoofPlaneInput, from: PlanPoint, to: PlanPoint): boolean {
  const direction = sub(to, from);
  let normal: PlanPoint = { xMm: -direction.yMm, yMm: direction.xMm };
  const footprint = planeFootprint(plane);
  const centre: PlanPoint = {
    xMm: Math.floor((footprint.minXMm + footprint.maxXMm) / 2),
    yMm: Math.floor((footprint.minYMm + footprint.maxYMm) / 2),
  };
  if (dot(normal, sub(centre, from)) < 0) normal = { xMm: -normal.xMm, yMm: -normal.yMm };
  return dot(fallGradient(plane), normal) > 0;
}

/** Does the surface drop as you walk away from this edge into the plane? */
function fallsAwayFrom(plane: RoofPlaneInput, from: PlanPoint, to: PlanPoint): boolean {
  const direction = sub(to, from);
  let normal: PlanPoint = { xMm: -direction.yMm, yMm: direction.xMm };
  const footprint = planeFootprint(plane);
  const centre: PlanPoint = {
    xMm: Math.floor((footprint.minXMm + footprint.maxXMm) / 2),
    yMm: Math.floor((footprint.minYMm + footprint.maxYMm) / 2),
  };
  if (dot(normal, sub(centre, from)) < 0) normal = { xMm: -normal.xMm, yMm: -normal.yMm };
  return dot(fallGradient(plane), normal) < 0;
}

const MEETING_TOLERANCE_MM = 5;

/**
 * Build the roof model: surfaces, classified edges and any issue that stops the planes
 * from forming one roof.
 */
export function buildRoofModel(planes: RoofPlaneInput[]): RoofModel {
  const issues: RoofIssue[] = [];
  const surfaces: RoofSurface[] = [];
  const sidesByPlane: Side[][] = [];

  for (const plane of planes) {
    const runMm = planRunMm(plane.lengthMm, plane.pitchMicrodeg);
    const riseMm = planRiseMm(plane.lengthMm, plane.pitchMicrodeg);
    const footprint = planeFootprint(plane);
    if (plane.lengthMm > 0 && runMm <= 0) {
      issues.push({
        ruleId: 'GEO-023',
        severity: 'blocking',
        message: `Plane ${plane.ref} has no horizontal run at its pitch, so it cannot be modelled.`,
        subjectRef: plane.ref,
      });
    }
    const plan = planeCorners(plane);
    const corner = (point: PlanPoint): Vec3 => ({
      xMm: point.xMm,
      yMm: point.yMm,
      zMm: surfaceZ(plane, point.xMm, point.yMm),
    });

    surfaces.push({
      id: plane.id,
      ref: plane.ref,
      fall: plane.fall,
      pitchMicrodeg: plane.pitchMicrodeg,
      footprint,
      runMm,
      riseMm,
      ridgeWidthMm: effectiveRidgeWidthMm(plane),
      // A hip end is a trapezoid: half the eave-plus-ridge width over the slope length.
      slopeAreaMm2: mulDivRound(plane.widthMm + effectiveRidgeWidthMm(plane), plane.lengthMm, 2),
      planAreaMm2: polygonAreaMm2(plan),
      corners: [corner(plan[0]), corner(plan[1]), corner(plan[2]), corner(plan[3])],
    });
    sidesByPlane.push(planeSides(plane, surfaces.length - 1));
  }

  const edges: RoofEdge[] = [];

  for (let i = 0; i < planes.length; i += 1) {
    for (let j = i + 1; j < planes.length; j += 1) {
      for (const sideA of sidesByPlane[i]) {
        const direction = sub(sideA.to, sideA.from);
        const lengthSquared = dot(direction, direction);
        if (lengthSquared === 0) continue;

        for (const sideB of sidesByPlane[j]) {
          const bFrom = sub(sideB.from, sideA.from);
          const bTo = sub(sideB.to, sideA.from);
          if (cross(direction, bFrom) !== 0 || cross(direction, bTo) !== 0) continue;

          const tFrom = dot(bFrom, direction);
          const tTo = dot(bTo, direction);
          const low = Math.max(0, Math.min(tFrom, tTo));
          const high = Math.min(lengthSquared, Math.max(tFrom, tTo));
          if (high - low <= 0) continue;

          sideA.shared = true;
          sideB.shared = true;

          const pointAt = (t: number): PlanPoint => ({
            xMm: sideA.from.xMm + mulDivRound(t, direction.xMm, lengthSquared),
            yMm: sideA.from.yMm + mulDivRound(t, direction.yMm, lengthSquared),
          });
          const start = pointAt(low);
          const end = pointAt(high);

          const zAStart = surfaceZ(planes[i], start.xMm, start.yMm);
          const zAEnd = surfaceZ(planes[i], end.xMm, end.yMm);
          const zBStart = surfaceZ(planes[j], start.xMm, start.yMm);
          const zBEnd = surfaceZ(planes[j], end.xMm, end.yMm);
          const stepMm = Math.max(Math.abs(zAStart - zBStart), Math.abs(zAEnd - zBEnd));

          const from: Vec3 = { ...start, zMm: zAStart };
          const to: Vec3 = { ...end, zMm: zAEnd };
          const lengthMm = distanceMm(from, to);

          if (stepMm > MEETING_TOLERANCE_MM) {
            issues.push({
              ruleId: 'GEO-021',
              severity: 'blocking',
              message: `Planes ${planes[i].ref} and ${planes[j].ref} share an edge but do not meet: the surface steps by ${stepMm} mm.`,
              subjectRef: planes[i].ref,
            });
            edges.push({ kind: 'apron', from, to, lengthMm, planes: [planes[i].ref, planes[j].ref] });
            continue;
          }

          const awayA = fallsAwayFrom(planes[i], start, end);
          const awayB = fallsAwayFrom(planes[j], start, end);
          const level = zAStart === zAEnd;
          // A shared edge that runs across both slopes at the same height is a join in one
          // surface, not a ridge or a valley: nothing is flashed there.
          const acrossA = !awayA && !fallsInto(planes[i], start, end);
          const acrossB = !awayB && !fallsInto(planes[j], start, end);
          const kind: RoofEdgeKind =
            acrossA && acrossB
              ? 'seam'
              : awayA && awayB
                ? level
                  ? 'ridge'
                  : 'hip'
                : !awayA && !awayB
                  ? 'valley'
                  : 'apron';
          edges.push({ kind, from, to, lengthMm, planes: [planes[i].ref, planes[j].ref] });
        }
      }
    }
  }

  for (let i = 0; i < planes.length; i += 1) {
    for (const side of sidesByPlane[i]) {
      if (side.shared) continue;
      if (side.from.xMm === side.to.xMm && side.from.yMm === side.to.yMm) continue;
      const kind: RoofEdgeKind = side.role === 'eave' ? 'eave' : side.role === 'rake' ? 'barge' : 'apron';
      const from: Vec3 = { ...side.from, zMm: surfaceZ(planes[i], side.from.xMm, side.from.yMm) };
      const to: Vec3 = { ...side.to, zMm: surfaceZ(planes[i], side.to.xMm, side.to.yMm) };
      edges.push({ kind, from, to, lengthMm: distanceMm(from, to), planes: [planes[i].ref] });
    }
  }

  const totals: Record<RoofEdgeKind, number> = { ridge: 0, hip: 0, valley: 0, eave: 0, barge: 0, apron: 0, seam: 0 };
  for (const edge of edges) totals[edge.kind] += edge.lengthMm;

  const bounds = surfaces.reduce(
    (acc, surface) => ({
      minXMm: Math.min(acc.minXMm, surface.footprint.minXMm),
      minYMm: Math.min(acc.minYMm, surface.footprint.minYMm),
      maxXMm: Math.max(acc.maxXMm, surface.footprint.maxXMm),
      maxYMm: Math.max(acc.maxYMm, surface.footprint.maxYMm),
      maxZMm: Math.max(acc.maxZMm, ...surface.corners.map((corner) => corner.zMm)),
    }),
    { minXMm: 0, minYMm: 0, maxXMm: 0, maxYMm: 0, maxZMm: 0 },
  );

  return {
    surfaces,
    edges,
    issues,
    bounds,
    planAreaMm2: surfaces.reduce((sum, surface) => sum + surface.planAreaMm2, 0),
    slopeAreaMm2: surfaces.reduce((sum, surface) => sum + surface.slopeAreaMm2, 0),
    totals,
  };
}

/**
 * Where the sheet boundaries fall, in plan.
 *
 * Sheets run up the slope, so the boundaries are parallel to the fall and spaced by the
 * effective cover width along the eave. The last sheet is trimmed to the plane edge, which
 * is why the boundary at the far edge is not drawn.
 */
export function sheetBoundaryLines(plane: RoofPlaneInput, coverMm: number): { from: PlanPoint; to: PlanPoint }[] {
  if (!Number.isFinite(coverMm) || coverMm <= 0) return [];
  const [ridgeStart, ridgeEnd, eaveEnd, eaveStart] = planeCorners(plane);
  const alongEave = sub(eaveEnd, eaveStart);
  const alongRidge = sub(ridgeEnd, ridgeStart);
  const widthMm = plane.widthMm;
  const lines: { from: PlanPoint; to: PlanPoint }[] = [];
  for (let offsetMm = coverMm; offsetMm < widthMm; offsetMm += coverMm) {
    const fraction = offsetMm / widthMm;
    lines.push({
      from: {
        xMm: eaveStart.xMm + Math.round(alongEave.xMm * fraction),
        yMm: eaveStart.yMm + Math.round(alongEave.yMm * fraction),
      },
      to: {
        xMm: ridgeStart.xMm + Math.round(alongRidge.xMm * fraction),
        yMm: ridgeStart.yMm + Math.round(alongRidge.yMm * fraction),
      },
    });
  }
  return lines;
}

/** Flashing runs the model can justify, in the order the trade quotes them. */
export function suggestFlashings(model: RoofModel): { kind: FlashableEdgeKind; lengthMm: number }[] {
  return FLASHABLE_EDGE_KINDS.filter((kind) => model.totals[kind] > 0).map((kind) => ({
    kind,
    lengthMm: model.totals[kind],
  }));
}
