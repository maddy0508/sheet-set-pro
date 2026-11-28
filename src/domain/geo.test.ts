import { describe, expect, it } from 'vitest';
import {
  GeoError,
  assessAerialQuality,
  edgeLengthMm,
  fitAffine,
  isSimplePolygon,
  mapToPixel,
  perimeterMm,
  pixelToMap,
  planAreaMm2,
  slopeFromPlan,
  slopeLengthMm,
  transformFromDeclaredGsd,
  type ControlPoint,
} from './geo';

/** 100 mm per pixel, north up the image (image y grows downwards, so northing falls). */
const GSD_CONTROL: ControlPoint[] = [
  { pixel: { x: 0, y: 0 }, map: { east: 0, north: 0 } },
  { pixel: { x: 100, y: 0 }, map: { east: 10, north: 0 } },
  { pixel: { x: 0, y: 100 }, map: { east: 0, north: -10 } },
  { pixel: { x: 100, y: 100 }, map: { east: 10, north: -10 } },
];

const ROOF_PIXELS = [
  { x: 10, y: 10 },
  { x: 110, y: 10 },
  { x: 110, y: 110 },
  { x: 10, y: 110 },
];

describe('georeferencing', () => {
  it('recovers scale from four control points', () => {
    const fit = fitAffine(GSD_CONTROL);
    expect(fit.groundSampleMmPerPx).toBeCloseTo(100, 6);
    expect(fit.residualRm).toBeCloseTo(0, 9);
    expect(fit.controlPointCount).toBe(4);
  });

  it('maps a pixel to metres and back again', () => {
    const { transform } = fitAffine(GSD_CONTROL);
    const map = pixelToMap(transform, { x: 50, y: 25 });
    expect(map.east).toBeCloseTo(5, 9);
    expect(map.north).toBeCloseTo(-2.5, 9);
    const back = mapToPixel(transform, map);
    expect(back.x).toBeCloseTo(50, 6);
    expect(back.y).toBeCloseTo(25, 6);
  });

  it('refuses collinear control points instead of inventing a scale', () => {
    const collinear: ControlPoint[] = [
      { pixel: { x: 0, y: 0 }, map: { east: 0, north: 0 } },
      { pixel: { x: 10, y: 10 }, map: { east: 1, north: 1 } },
      { pixel: { x: 20, y: 20 }, map: { east: 2, north: 2 } },
    ];
    expect(() => fitAffine(collinear)).toThrow(GeoError);
  });

  it('refuses fewer than three control points', () => {
    expect(() => fitAffine(GSD_CONTROL.slice(0, 2))).toThrow(/three control points/);
  });

  it('reports the residual of noisy control points rather than hiding it', () => {
    const noisy = GSD_CONTROL.map((point, index) =>
      index === 3 ? { ...point, map: { east: point.map.east + 1.2, north: point.map.north - 0.8 } } : point,
    );
    const fit = fitAffine(noisy);
    // Least squares spreads the error over the other points, so the residual is smaller than
    // the offset itself — but it is reported, and it is what the grade is based on.
    expect(fit.residualRm).toBeGreaterThan(0.2);
    const quality = assessAerialQuality(fit);
    expect(quality.grade).toBe('ESTIMATE_GRADE');
    expect(quality.reasons.join(' ')).toMatch(/control points disagree|four control points|on-site/);

    const poor = assessAerialQuality({ ...fit, residualRm: 0.9 });
    expect(poor.reasons.join(' ')).toMatch(/control points disagree by 0.90 m/);
  });
});

describe('declared ground sample distance', () => {
  it('measures a square from a declared resolution', () => {
    const transform = transformFromDeclaredGsd(100);
    expect(planAreaMm2(transform, ROOF_PIXELS)).toBe(100_000_000);
    expect(perimeterMm(transform, ROOF_PIXELS)).toBe(40_000);
  });

  it('refuses a missing or negative resolution', () => {
    expect(() => transformFromDeclaredGsd(0)).toThrow(GeoError);
    expect(() => transformFromDeclaredGsd(Number.NaN)).toThrow(GeoError);
  });

  it('keeps northing increasing upwards on the image', () => {
    const transform = transformFromDeclaredGsd(100);
    expect(pixelToMap(transform, { x: 0, y: 0 }).north).toBeGreaterThan(pixelToMap(transform, { x: 0, y: 10 }).north);
  });
});

describe('measurement on georeferenced imagery', () => {
  const { transform } = fitAffine(GSD_CONTROL);

  it('measures an edge in millimetres', () => {
    expect(edgeLengthMm(transform, { x: 0, y: 0 }, { x: 100, y: 0 })).toBe(10_000);
  });

  it('measures a 10 m square as 100 m2 and 40 m perimeter', () => {
    expect(planAreaMm2(transform, ROOF_PIXELS)).toBe(100_000_000);
    expect(perimeterMm(transform, ROOF_PIXELS)).toBe(40_000);
  });

  it('rejects a polygon with fewer than three points', () => {
    expect(() => planAreaMm2(transform, ROOF_PIXELS.slice(0, 2))).toThrow(/at least three/);
  });

  it('detects a self-intersecting outline', () => {
    expect(isSimplePolygon(ROOF_PIXELS)).toBe(true);
    expect(
      isSimplePolygon([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ]),
    ).toBe(false);
  });

  it('applies pitch to one plane, not to the whole roof', () => {
    const shallow = slopeFromPlan(100_000_000, 10_000_000); // 10 degrees
    const steep = slopeFromPlan(100_000_000, 30_000_000); // 30 degrees
    expect(shallow.slopeAreaMm2).toBeCloseTo(101_542_000, -1000);
    expect(steep.slopeAreaMm2).toBeCloseTo(115_470_000, -1000);
    expect(steep.slopeAreaMm2).toBeGreaterThan(shallow.slopeAreaMm2);
  });

  it('converts a plan run to slope length', () => {
    expect(slopeLengthMm(4_000, 15_000_000)).toBe(4_141);
  });

  it('refuses an impossible pitch', () => {
    expect(() => slopeFromPlan(1_000_000, 90_000_000)).toThrow(GeoError);
    expect(() => slopeFromPlan(1_000_000, -1)).toThrow(GeoError);
  });
});

describe('aerial quality grading', () => {
  it('never calls aerial measurement order grade', () => {
    const quality = assessAerialQuality(fitAffine(GSD_CONTROL));
    expect(quality.grade).toBe('ESTIMATE_GRADE');
    expect(quality.reasons.join(' ')).toMatch(/on-site/);
  });

  it('names coarse imagery as the reason', () => {
    const coarse: ControlPoint[] = GSD_CONTROL.map((point) => ({
      pixel: point.pixel,
      map: { east: point.map.east * 3, north: point.map.north * 3 },
    }));
    const quality = assessAerialQuality(fitAffine(coarse));
    expect(quality.reasons.join(' ')).toMatch(/ground sample distance/);
  });

  it('flags three control points as uncross-checked', () => {
    const quality = assessAerialQuality(fitAffine(GSD_CONTROL.slice(0, 3)));
    expect(quality.reasons.join(' ')).toMatch(/four control points/);
  });
});
