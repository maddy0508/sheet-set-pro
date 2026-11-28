import { NumericError, mulDivRound } from './units';

/**
 * Aerial geometry: image pixels to metres, and back.
 *
 * The AI service answers in pixels. Pixels become metres only through a transform fitted to
 * ground control points the operator or the imagery metadata supplies. Nothing here derives a
 * scale from how large a roof looks — that would be a guess dressed as a measurement.
 *
 * Output lengths and areas are integer millimetres / square millimetres at the boundary, so
 * everything downstream (sheet layout, material take-off, pricing) keeps the same numeric
 * contract as manual measurement. The affine fit itself uses floating point, which is fine:
 * it is an input estimate, not a manufacturing calculation.
 */

export type PixelPoint = { x: number; y: number };
/** Easting and northing in metres, in a projected CRS such as MGA2020 (EPSG:7850-7859). */
export type MapPoint = { east: number; north: number };

export type ControlPoint = { pixel: PixelPoint; map: MapPoint };

/** x' = a·x + b·y + c, y' = d·x + e·y + f, with x' easting and y' northing in metres. */
export type AffineTransform = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

export type FitResult = {
  transform: AffineTransform;
  /** Root mean square of the control point residuals, in metres. */
  residualRm: number;
  /** Ground sample distance implied by the transform, in millimetres per pixel. */
  groundSampleMmPerPx: number;
  /** Rotation of the pixel grid relative to the map grid, in degrees. */
  rotationDeg: number;
  controlPointCount: number;
};

export type QualityGrade = 'ESTIMATE_GRADE' | 'ORDER_GRADE';

export type QualityAssessment = {
  grade: QualityGrade;
  reasons: string[];
};

export class GeoError extends Error {
  readonly code:
    | 'NO_CONTROL_POINTS'
    | 'DEGENERATE_CONTROL_POINTS'
    | 'OUTSIDE_IMAGE'
    | 'INVALID_POLYGON'
    | 'PITCH_OUT_OF_RANGE';

  constructor(code: GeoError['code'], message: string) {
    super(message);
    this.name = 'GeoError';
    this.code = code;
  }
}

/**
 * Fit the transform by least squares on three or more control points.
 *
 * Three points fix the six unknowns exactly; more points average out survey error, which is
 * why the residual is reported and used for the grade rather than assumed to be zero.
 */
export function fitAffine(controlPoints: ControlPoint[]): FitResult {
  if (controlPoints.length < 3) {
    throw new GeoError('NO_CONTROL_POINTS', 'at least three control points are required to georeference an image');
  }

  const rows = controlPoints.map((point) => [point.pixel.x, point.pixel.y, 1]);
  const targetsE = controlPoints.map((point) => point.map.east);
  const targetsN = controlPoints.map((point) => point.map.north);

  const normal = normalMatrix(rows);
  if (normal === null) {
    throw new GeoError(
      'DEGENERATE_CONTROL_POINTS',
      'the control points are collinear, so no scale and rotation can be solved from them',
    );
  }

  const [a, b, c] = solve3(normal, normalTimes(rows, targetsE));
  const [d, e, f] = solve3(normal, normalTimes(rows, targetsN));

  const residuals = rows.map((row, index) => {
    const east = a * row[0] + b * row[1] + c - targetsE[index];
    const north = d * row[0] + e * row[1] + f - targetsN[index];
    return Math.hypot(east, north);
  });
  const residualRm = Math.sqrt(residuals.reduce((sum, value) => sum + value * value, 0) / residuals.length);

  // The fitted coefficients are metres per pixel along each axis.
  const metresPerPixelEast = Math.hypot(a, b);
  const metresPerPixelNorth = Math.hypot(d, e);
  const metresPerPixel = (metresPerPixelEast + metresPerPixelNorth) / 2;
  if (!Number.isFinite(metresPerPixel) || metresPerPixel <= 0) {
    throw new GeoError('DEGENERATE_CONTROL_POINTS', 'the control points give no usable image scale');
  }

  return {
    transform: { a, b, c, d, e, f },
    residualRm,
    groundSampleMmPerPx: metresPerPixel * 1000,
    rotationDeg: (Math.atan2(d, a) * 180) / Math.PI,
    controlPointCount: controlPoints.length,
  };
}

function normalMatrix(rows: number[][]): number[][] | null {
  const matrix = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const row of rows) {
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        matrix[i][j] += row[i] * row[j];
      }
    }
  }
  if (Math.abs(determinant3(matrix)) < 1e-9) return null;
  return matrix;
}

function normalTimes(rows: number[][], targets: number[]): number[] {
  const result = [0, 0, 0];
  rows.forEach((row, index) => {
    for (let i = 0; i < 3; i += 1) result[i] += row[i] * targets[index];
  });
  return result;
}

function determinant3(m: number[][]): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}

function solve3(m: number[][], rhs: number[]): [number, number, number] {
  const det = determinant3(m);
  if (Math.abs(det) < 1e-12) {
    throw new GeoError('DEGENERATE_CONTROL_POINTS', 'the control point system has no unique solution');
  }
  const replace = (column: number) =>
    m.map((row, index) => row.map((value, position) => (position === column ? rhs[index] : value)));
  return [determinant3(replace(0)) / det, determinant3(replace(1)) / det, determinant3(replace(2)) / det];
}

/**
 * Transform from a declared ground sample distance, for a north-up orthophoto.
 *
 * This is a declaration, not a guess: the operator states the imagery's published resolution
 * and confirms it is a north-up orthorectified aerial image, and that statement is recorded as
 * the calibration method. It gives scale without rotation, so it cannot correct a rotated or
 * skewed image — fit control points with `fitAffine` when those exist.
 */
export function transformFromDeclaredGsd(gsdMmPerPx: number): AffineTransform {
  if (!Number.isFinite(gsdMmPerPx) || gsdMmPerPx <= 0) {
    throw new GeoError('DEGENERATE_CONTROL_POINTS', 'ground sample distance must be a positive number of millimetres per pixel');
  }
  const metresPerPixel = gsdMmPerPx / 1000;
  // Northing falls as image y increases, so the pixel grid is mirrored in y.
  return { a: metresPerPixel, b: 0, c: 0, d: 0, e: -metresPerPixel, f: 0 };
}

export function pixelToMap(transform: AffineTransform, point: PixelPoint): MapPoint {
  return {
    east: transform.a * point.x + transform.b * point.y + transform.c,
    north: transform.d * point.x + transform.e * point.y + transform.f,
  };
}

export function mapToPixel(transform: AffineTransform, point: MapPoint): PixelPoint {
  const det = transform.a * transform.e - transform.b * transform.d;
  if (Math.abs(det) < 1e-12) {
    throw new GeoError('DEGENERATE_CONTROL_POINTS', 'the transform cannot be inverted');
  }
  const dx = point.east - transform.c;
  const dy = point.north - transform.f;
  return {
    x: (transform.e * dx - transform.b * dy) / det,
    y: (-transform.d * dx + transform.a * dy) / det,
  };
}

/** Length of one edge in whole millimetres. */
export function edgeLengthMm(transform: AffineTransform, from: PixelPoint, to: PixelPoint): number {
  const start = pixelToMap(transform, from);
  const end = pixelToMap(transform, to);
  return Math.round(Math.hypot(end.east - start.east, end.north - start.north) * 1000);
}

export function perimeterMm(transform: AffineTransform, polygon: PixelPoint[]): number {
  if (polygon.length < 3) {
    throw new GeoError('INVALID_POLYGON', 'a polygon needs at least three points');
  }
  let total = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    total += edgeLengthMm(transform, polygon[index], polygon[(index + 1) % polygon.length]);
  }
  return total;
}

/**
 * Plan area in square millimetres, using the shoelace sum in map metres.
 *
 * Screen-space or Web Mercator area is never used: both distort with latitude, and a roof
 * near Bendigo is not the same size in degrees as it is on the ground.
 */
export function planAreaMm2(transform: AffineTransform, polygon: PixelPoint[]): number {
  if (polygon.length < 3) {
    throw new GeoError('INVALID_POLYGON', 'a polygon needs at least three points');
  }
  const mapped = polygon.map((point) => pixelToMap(transform, point));
  let total = 0;
  for (let index = 0; index < mapped.length; index += 1) {
    const current = mapped[index];
    const next = mapped[(index + 1) % mapped.length];
    total += current.east * next.north - next.east * current.north;
  }
  const areaM2 = Math.abs(total) / 2;
  return Math.round(areaM2 * 1_000_000);
}

/** True when two non-adjacent edges cross, which no roof outline may do. */
export function isSimplePolygon(polygon: PixelPoint[]): boolean {
  const count = polygon.length;
  if (count < 3) return false;
  for (let i = 0; i < count; i += 1) {
    const a1 = polygon[i];
    const a2 = polygon[(i + 1) % count];
    for (let j = i + 2; j < count; j += 1) {
      if (i === 0 && j === count - 1) continue;
      const b1 = polygon[j];
      const b2 = polygon[(j + 1) % count];
      if (segmentsIntersect(a1, a2, b1, b2)) return false;
    }
  }
  return true;
}

function cross(a: PixelPoint, b: PixelPoint, c: PixelPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(a1: PixelPoint, a2: PixelPoint, b1: PixelPoint, b2: PixelPoint): boolean {
  const d1 = cross(b1, b2, a1);
  const d2 = cross(b1, b2, a2);
  const d3 = cross(a1, a2, b1);
  const d4 = cross(a1, a2, b2);
  return d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0;
}

/**
 * Roof-surface length and area for a pitched plane.
 *
 * One plane at a time, per the geometry contract: a single roof-wide correction is wrong for
 * any roof with more than one pitch, which is most of them.
 */
export function slopeFromPlan(planMm2: number, pitchMicrodeg: number): { slopeAreaMm2: number; factorMicro: number } {
  if (pitchMicrodeg < 0 || pitchMicrodeg > 89_000_000) {
    throw new GeoError('PITCH_OUT_OF_RANGE', 'pitch must be between 0 and 89 degrees');
  }
  const radians = (pitchMicrodeg / 1_000_000) * (Math.PI / 180);
  const cos = Math.cos(radians);
  if (cos <= 0) throw new GeoError('PITCH_OUT_OF_RANGE', 'pitch is too steep to compute a slope factor');
  const factorMicro = Math.round(1_000_000 / cos);
  return { slopeAreaMm2: mulDivRound(planMm2, factorMicro, 1_000_000), factorMicro };
}

export function slopeLengthMm(planRunMm: number, pitchMicrodeg: number): number {
  const { factorMicro } = slopeFromPlan(1_000_000, pitchMicrodeg);
  return mulDivRound(planRunMm, factorMicro, 1_000_000);
}

/**
 * What the imagery can support, stated rather than assumed.
 *
 * Aerial imagery is not survey-grade: a 10 cm ground sample over a hipped roof, with a small
 * control residual, can narrow a plan dimension to a few centimetres. That is estimate grade.
 * Order grade needs on-site confirmation, which is why the grade is capped here and the
 * decision to release an order stays with the existing measurement workflow.
 */
export function assessAerialQuality(fit: FitResult): QualityAssessment {
  const reasons: string[] = [];
  const gsdMm = fit.groundSampleMmPerPx;
  if (!Number.isFinite(gsdMm) || gsdMm <= 0) {
    return { grade: 'ESTIMATE_GRADE', reasons: ['the imagery has no usable scale'] };
  }
  if (gsdMm > 250) reasons.push(`ground sample distance is ${Math.round(gsdMm)} mm per pixel`);
  if (fit.residualRm > 0.5) reasons.push(`control points disagree by ${fit.residualRm.toFixed(2)} m`);
  if (fit.controlPointCount < 4) reasons.push('fewer than four control points, so rotation and scale cannot be cross-checked');
  if (Math.abs(fit.rotationDeg) > 5) reasons.push(`pixel grid is rotated ${fit.rotationDeg.toFixed(1)} degrees from north`);
  if (reasons.length === 0) {
    reasons.push('aerial measurement is estimate grade until an on-site measurement confirms it');
  }
  return { grade: 'ESTIMATE_GRADE', reasons };
}

/** Convert a millimetre length to whole square millimetres of a rectangular plane. */
export function rectangleAreaMm2(widthMm: number, lengthMm: number): number {
  if (widthMm <= 0 || lengthMm <= 0) {
    throw new NumericError('INPUT_NEGATIVE_LENGTH', 'width and length must be positive');
  }
  return widthMm * lengthMm;
}
