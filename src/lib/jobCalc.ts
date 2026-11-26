import type { CatalogueProfile, Flashing, Job, Measurement, Plane } from '@/data/types';
import type { CatalogueContext } from '@/domain/validation';
import { EMPTY_CATALOGUE, orderGradeBlockers, validateRoof } from '@/domain/validation';
import type { MaterialProfile } from '@/domain/material';
import { buildBom } from '@/domain/material';
import type { LayoutResult } from '@/domain/layout';
import { computeLayout } from '@/domain/layout';
import { degToMicro } from '@/domain/units';
import { totalAreaMm2 } from '@/domain/geometry';

export function profileToContext(profile: CatalogueProfile | null): CatalogueContext {
  if (!profile) return EMPTY_CATALOGUE;
  return {
    effectiveCoverMm: profile.effectiveCoverMm,
    minPitchMicrodeg: profile.minPitchDeg === null ? null : degToMicro(profile.minPitchDeg),
    maxLengthMm: profile.maxLengthMm,
    hasLapRule: profile.lapLongitudinalMm !== null && profile.lapTransverseMm !== null,
    verificationState: profile.verificationState,
  };
}

export function profileToMaterial(profile: CatalogueProfile | null): MaterialProfile {
  const base = profile?.sheetPriceCentsPerM ?? null;
  const derive = (factor: number) => (base === null ? null : Math.round(base * factor));
  return {
    id: profile?.id ?? 'none',
    name: profile?.name ?? 'No product selected',
    manufacturer: profile?.manufacturer ?? '—',
    effectiveCoverMm: profile?.effectiveCoverMm ?? null,
    minPitchMicrodeg:
      profile?.minPitchDeg === null || profile?.minPitchDeg === undefined ? null : degToMicro(profile.minPitchDeg),
    maxLengthMm: profile?.maxLengthMm ?? null,
    lapLongitudinalMm: profile?.lapLongitudinalMm ?? null,
    lapTransverseMm: profile?.lapTransverseMm ?? null,
    sheetPriceCentsPerM: base,
    fixingPerSheet: profile?.fixingPerSheet ?? null,
    flashingPriceCentsPerM: {
      ridge: derive(1.6),
      hip: derive(1.6),
      valley: derive(1.9),
      barge: derive(1.6),
      apron: derive(1.5),
      box_gutter: derive(2.4),
      eave: derive(1.4),
    },
    priceBasis: profile?.priceBasis ?? 'SYNTHETIC',
  };
}

export type JobComputation = {
  issues: ReturnType<typeof validateRoof>;
  blockingCount: number;
  layout: LayoutResult;
  bom: ReturnType<typeof buildBom>;
  areaMm2: number;
  verifiedControlDimensions: number;
  orderBlockers: string[];
};

export function computeJob(params: {
  job: Job;
  planes: Plane[];
  flashings: Flashing[];
  measurements: Measurement[];
  profile: CatalogueProfile | null;
}): JobComputation {
  const { job, planes, flashings, measurements, profile } = params;
  const context = profileToContext(profile);
  const issues = validateRoof(planes, context);
  const layout = computeLayout(planes, {
    effectiveCoverMm: context.effectiveCoverMm,
    maxLengthMm: context.maxLengthMm,
    lapTransverseMm: profile?.lapTransverseMm ?? 0,
    eaveAllowanceMm: 60,
    topAllowanceMm: 40,
  });
  const bom = buildBom({
    planes,
    layout,
    flashings: flashings.map((f) => ({ kind: f.kind, lengthMm: f.lengthMm })),
    profile: profileToMaterial(profile),
  });
  const verifiedControlDimensions = measurements.filter(
    (m) => m.isActive && m.kind === 'control_dimension' && m.grade === 'ORDER_GRADE',
  ).length;

  return {
    issues,
    blockingCount: issues.filter((i) => i.severity === 'blocking').length,
    layout,
    bom,
    areaMm2: totalAreaMm2(planes),
    verifiedControlDimensions,
    orderBlockers: orderGradeBlockers(planes, context, verifiedControlDimensions, job.operatorApproved),
  };
}
