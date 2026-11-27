import { describe, expect, it } from 'vitest';
import {
  type RoofPlaneInput,
  buildRoofModel,
  describeRoofForm,
  planePlanCorners,
  polygonOverlapAreaMm2,
  effectiveRidgeWidthMm,
  planRiseMm,
  planRunMm,
  planeFootprint,
  sheetBoundaryLines,
  suggestFlashings,
  surfaceZ,
} from './roof3d';
import { totalAreaMm2 } from './geometry';
import { degToMicro } from './units';

const PITCH_22_5 = degToMicro(22.5);
const PITCH_45 = degToMicro(45);

function plane(overrides: Partial<RoofPlaneInput> & Pick<RoofPlaneInput, 'id' | 'ref'>): RoofPlaneInput {
  return {
    xMm: 0,
    yMm: 0,
    widthMm: 6000,
    lengthMm: 3600,
    pitchMicrodeg: PITCH_22_5,
    fall: 'south',
    ...overrides,
  };
}

describe('roof geometry primitives', () => {
  it('turns a slope length into a plan run and a rise', () => {
    expect(planRunMm(3600, PITCH_22_5)).toBe(3326);
    expect(planRiseMm(3600, PITCH_22_5)).toBe(1378);
    expect(planRunMm(2828, PITCH_45)).toBe(2000);
    expect(planRiseMm(2828, PITCH_45)).toBe(2000);
    expect(planRunMm(3000, 0)).toBe(3000);
    expect(planRiseMm(3000, 0)).toBe(0);
  });

  it('places the footprint in the direction of fall', () => {
    expect(planeFootprint(plane({ id: 'a', ref: 'A', fall: 'south' }))).toEqual({
      minXMm: 0,
      maxXMm: 6000,
      minYMm: 0,
      maxYMm: 3326,
    });
    expect(planeFootprint(plane({ id: 'a', ref: 'A', fall: 'west' }))).toEqual({
      minXMm: 0,
      maxXMm: 3326,
      minYMm: 0,
      maxYMm: 6000,
    });
  });

  it('measures height from the eave, whichever way the plane falls', () => {
    const south = plane({ id: 's', ref: 'S', fall: 'south' });
    expect(surfaceZ(south, 1000, 0)).toBe(1378);
    expect(surfaceZ(south, 1000, 3326)).toBe(0);
    const north = plane({ id: 'n', ref: 'N', fall: 'north' });
    expect(surfaceZ(north, 1000, 0)).toBe(0);
    expect(surfaceZ(north, 1000, 3326)).toBe(1378);
  });

  it('narrows the ridge for a hip end and refuses to widen it past the eave', () => {
    expect(effectiveRidgeWidthMm(plane({ id: 'a', ref: 'A' }))).toBe(6000);
    expect(effectiveRidgeWidthMm(plane({ id: 'a', ref: 'A', ridgeWidthMm: 2000 }))).toBe(2000);
    expect(effectiveRidgeWidthMm(plane({ id: 'a', ref: 'A', ridgeWidthMm: 9000 }))).toBe(6000);
  });
});

describe('a single plane', () => {
  const model = buildRoofModel([plane({ id: 'p1', ref: 'P1' })]);

  it('has one surface whose slope area is the measured area', () => {
    expect(model.surfaces).toHaveLength(1);
    expect(model.slopeAreaMm2).toBe(6000 * 3600);
    expect(model.surfaces[0].riseMm).toBe(1378);
  });

  it('reports an eave, an open ridge side and two rakes', () => {
    expect(model.edges.map((edge) => edge.kind).sort()).toEqual(['apron', 'barge', 'barge', 'eave']);
    expect(model.totals.eave).toBe(6000);
    // A rake runs up the slope, so its length is the slope length, not the run.
    expect(model.totals.barge).toBe(3600 * 2);
  });

  it('agrees with the deterministic area engine', () => {
    expect(model.slopeAreaMm2).toBe(totalAreaMm2([plane({ id: 'p1', ref: 'P1' })]));
  });
});

describe('two planes meeting along a line', () => {
  it('forms a ridge when both fall away from the shared line', () => {
    const run = planRunMm(3600, PITCH_22_5);
    const model = buildRoofModel([
      plane({ id: 'p1', ref: 'P1', xMm: 0, fall: 'west' }),
      plane({ id: 'p2', ref: 'P2', xMm: run, fall: 'east' }),
    ]);
    const ridges = model.edges.filter((edge) => edge.kind === 'ridge');
    expect(ridges).toHaveLength(1);
    expect(ridges[0].lengthMm).toBe(6000);
    expect(ridges[0].planes).toEqual(['P1', 'P2']);
    expect(model.totals.hip).toBe(0);
    expect(model.totals.valley).toBe(0);
    expect(model.totals.eave).toBe(12000);
    expect(model.issues).toEqual([]);
  });

  it('forms a valley when both rise away from the shared line', () => {
    const run = planRunMm(3600, PITCH_22_5);
    const model = buildRoofModel([
      plane({ id: 'p1', ref: 'P1', xMm: 0, fall: 'east' }),
      plane({ id: 'p2', ref: 'P2', xMm: run, fall: 'west' }),
    ]);
    const valleys = model.edges.filter((edge) => edge.kind === 'valley');
    expect(valleys).toHaveLength(1);
    expect(valleys[0].lengthMm).toBe(6000);
    expect(model.totals.ridge).toBe(0);
  });

  it('calls a coplanar join a seam, not a valley', () => {
    // Two measured planes that continue one surface: same pitch, same fall, side by side.
    const run = planRunMm(3600, PITCH_22_5);
    const model = buildRoofModel([
      plane({ id: 'p1', ref: 'P1', xMm: 0, fall: 'south' }),
      plane({ id: 'p2', ref: 'P2', xMm: 6000, fall: 'south' }),
    ]);
    expect(model.edges.filter((edge) => edge.kind === 'valley')).toHaveLength(0);
    expect(model.edges.filter((edge) => edge.kind === 'seam')).toHaveLength(1);
    expect(model.totals.seam).toBe(3600);
    expect(suggestFlashings(model).some((run_) => run_.kind === 'valley')).toBe(false);
    expect(model.issues).toEqual([]);
  });

  it('reports a step when two planes share a line but do not meet', () => {
    const run = planRunMm(3600, PITCH_22_5);
    const model = buildRoofModel([
      plane({ id: 'p1', ref: 'P1', xMm: 0, fall: 'south' }),
      // Same footprint line, steeper plane: the shared edge steps by the difference in rise.
      plane({ id: 'p2', ref: 'P2', xMm: run, fall: 'south', pitchMicrodeg: degToMicro(35) }),
    ]);
    expect(model.issues.map((issue) => issue.ruleId)).toEqual(['GEO-021']);
    expect(model.issues[0].severity).toBe('blocking');
  });
});

describe('a hipped roof', () => {
  // 6000 x 4000 building, ridge 2000 long at mid height, 45° on every plane.
  const slope = 2828;
  const model = buildRoofModel([
    plane({ id: 'front', ref: 'F', xMm: 0, yMm: 2000, widthMm: 6000, lengthMm: slope, pitchMicrodeg: PITCH_45, fall: 'south', ridgeWidthMm: 2000 }),
    plane({ id: 'back', ref: 'B', xMm: 0, yMm: 0, widthMm: 6000, lengthMm: slope, pitchMicrodeg: PITCH_45, fall: 'north', ridgeWidthMm: 2000 }),
    plane({ id: 'left', ref: 'L', xMm: 0, yMm: 0, widthMm: 4000, lengthMm: slope, pitchMicrodeg: PITCH_45, fall: 'west', ridgeWidthMm: 0 }),
    plane({ id: 'right', ref: 'R', xMm: 4000, yMm: 0, widthMm: 4000, lengthMm: slope, pitchMicrodeg: PITCH_45, fall: 'east', ridgeWidthMm: 0 }),
  ]);

  it('closes with four hips and one ridge', () => {
    expect(model.issues).toEqual([]);
    const hips = model.edges.filter((edge) => edge.kind === 'hip');
    const ridges = model.edges.filter((edge) => edge.kind === 'ridge');
    expect(hips).toHaveLength(4);
    expect(hips.every((edge) => edge.lengthMm === 3464)).toBe(true);
    expect(ridges).toHaveLength(1);
    expect(ridges[0].lengthMm).toBe(2000);
  });

  it('has four eaves and no open rakes', () => {
    expect(model.totals.eave).toBe(20000);
    expect(model.totals.barge).toBe(0);
    expect(model.totals.apron).toBe(0);
  });

  it('covers the plan exactly once', () => {
    expect(model.planAreaMm2).toBe(6000 * 4000);
    // Every plane is at 45°, so the slope area is the plan area times sqrt(2).
    expect(model.slopeAreaMm2 / model.planAreaMm2).toBeCloseTo(Math.SQRT2, 2);
  });

  it('suggests the flashing runs a roofer would order', () => {
    expect(suggestFlashings(model)).toEqual([
      { kind: 'ridge', lengthMm: 2000 },
      { kind: 'hip', lengthMm: 3464 * 4 },
      { kind: 'eave', lengthMm: 20000 },
    ]);
  });
});

describe('model invariants', () => {
  it('never disagrees with the area engine, whatever the shape', () => {
    const planes: RoofPlaneInput[] = [
      plane({ id: '1', ref: 'P1', fall: 'south', widthMm: 4200, lengthMm: 5100, pitchMicrodeg: degToMicro(17) }),
      plane({ id: '2', ref: 'P2', fall: 'west', widthMm: 3300, lengthMm: 2700, pitchMicrodeg: degToMicro(30) }),
      plane({ id: '3', ref: 'P3', fall: 'north', widthMm: 1200, lengthMm: 900, pitchMicrodeg: degToMicro(5) }),
    ];
    const model = buildRoofModel(planes);
    expect(model.slopeAreaMm2).toBe(totalAreaMm2(planes));
    expect(model.surfaces).toHaveLength(planes.length);
    expect(model.bounds.maxZMm).toBeGreaterThan(0);
  });

  it('keeps every corner on its own surface', () => {
    const model = buildRoofModel([plane({ id: 'p1', ref: 'P1', fall: 'east', widthMm: 5000, lengthMm: 4000 })]);
    for (const corner of model.surfaces[0].corners) {
      const input = plane({ id: 'p1', ref: 'P1', fall: 'east', widthMm: 5000, lengthMm: 4000 });
      expect(corner.zMm).toBe(surfaceZ(input, corner.xMm, corner.yMm));
    }
  });
});

describe('sheet boundaries', () => {
  it('spaces boundaries by the effective cover along the eave', () => {
    const single = plane({ id: 'p1', ref: 'P1', widthMm: 6000, fall: 'south' });
    const lines = sheetBoundaryLines(single, 762);
    expect(lines).toHaveLength(7); // 6000 / 762 = 7 full covers, the eighth sheet is trimmed
    expect(lines[0].from).toEqual({ xMm: 762, yMm: planRunMm(3600, PITCH_22_5) });
    expect(lines[0].to).toEqual({ xMm: 762, yMm: 0 });
  });

  it('runs boundaries up the slope on an east-facing plane', () => {
    const single = plane({ id: 'p1', ref: 'P1', widthMm: 6000, fall: 'east' });
    const lines = sheetBoundaryLines(single, 1000);
    expect(lines).toHaveLength(5);
    expect(lines[0].from).toEqual({ xMm: planRunMm(3600, PITCH_22_5), yMm: 1000 });
    expect(lines[0].to).toEqual({ xMm: 0, yMm: 1000 });
  });

  it('draws nothing without a cover width', () => {
    expect(sheetBoundaryLines(plane({ id: 'p1', ref: 'P1' }), 0)).toEqual([]);
  });
});

describe('plan outlines', () => {
  const square = [
    { xMm: 0, yMm: 0 },
    { xMm: 4000, yMm: 0 },
    { xMm: 4000, yMm: 4000 },
    { xMm: 0, yMm: 4000 },
  ];

  it('measures the area two outlines really share, not their bounding boxes', () => {
    expect(polygonOverlapAreaMm2(square, square)).toBe(16_000_000);
    const shifted = square.map((point) => ({ xMm: point.xMm + 2000, yMm: point.yMm }));
    expect(polygonOverlapAreaMm2(square, shifted)).toBe(8_000_000);
    const apart = square.map((point) => ({ xMm: point.xMm + 4000, yMm: point.yMm }));
    expect(polygonOverlapAreaMm2(square, apart)).toBe(0);
  });

  it('finds no overlap between planes that only abut along an edge', () => {
    const run = planRunMm(2828, PITCH_45);
    const first = plane({ id: 'a', ref: 'A', xMm: 0, fall: 'east', lengthMm: 2828, pitchMicrodeg: PITCH_45 });
    const second = plane({ id: 'b', ref: 'B', xMm: run, fall: 'west', lengthMm: 2828, pitchMicrodeg: PITCH_45 });
    expect(polygonOverlapAreaMm2(planePlanCorners(first), planePlanCorners(second))).toBe(0);
  });

  it('reports the same roof captured twice as a full overlap', () => {
    const only = plane({ id: 'a', ref: 'A', fall: 'south' });
    const model = buildRoofModel([only]);
    expect(polygonOverlapAreaMm2(planePlanCorners(only), planePlanCorners(only))).toBe(model.surfaces[0].planAreaMm2);
  });
});

describe('roof form', () => {
  it('names a single plane a skillion', () => {
    const model = buildRoofModel([plane({ id: 'p1', ref: 'P1' })]);
    expect(describeRoofForm(model).form).toBe('skillion');
    expect(describeRoofForm(model).label).toBe('Skillion');
  });

  it('names two planes falling away from a ridge a gable', () => {
    const run = planRunMm(3600, PITCH_22_5);
    const model = buildRoofModel([
      plane({ id: 'p1', ref: 'P1', xMm: 0, fall: 'west' }),
      plane({ id: 'p2', ref: 'P2', xMm: run, fall: 'east' }),
    ]);
    expect(describeRoofForm(model).label).toBe('Gable');
    expect(describeRoofForm(model).detail).toContain('2 planes');
  });

  it('names a four-plane roof hipped, and counts its hips', () => {
    const slope = 2828;
    const model = buildRoofModel([
      plane({ id: 'front', ref: 'F', xMm: 0, yMm: 2000, widthMm: 6000, lengthMm: slope, pitchMicrodeg: PITCH_45, fall: 'south', ridgeWidthMm: 2000 }),
      plane({ id: 'back', ref: 'B', xMm: 0, yMm: 0, widthMm: 6000, lengthMm: slope, pitchMicrodeg: PITCH_45, fall: 'north', ridgeWidthMm: 2000 }),
      plane({ id: 'left', ref: 'L', xMm: 0, yMm: 0, widthMm: 4000, lengthMm: slope, pitchMicrodeg: PITCH_45, fall: 'west', ridgeWidthMm: 0 }),
      plane({ id: 'right', ref: 'R', xMm: 4000, yMm: 0, widthMm: 4000, lengthMm: slope, pitchMicrodeg: PITCH_45, fall: 'east', ridgeWidthMm: 0 }),
    ]);
    const form = describeRoofForm(model);
    expect(form.label).toBe('Hipped');
    expect(form.detail).toContain('4 hips');
  });

  it('says so when nothing has been captured', () => {
    const model = buildRoofModel([]);
    expect(describeRoofForm(model).label).toBe('No roof');
  });
});
