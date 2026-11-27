import { mulDivRound } from './units';
import type { BomLine, FlashingKind, PlaneGeometry } from './types';
import type { LayoutResult } from './layout';

export type MaterialProfile = {
  id: string;
  name: string;
  manufacturer: string;
  effectiveCoverMm: number | null;
  minPitchMicrodeg: number | null;
  maxLengthMm: number | null;
  lapLongitudinalMm: number | null;
  lapTransverseMm: number | null;
  sheetPriceCentsPerM: number | null;
  fixingPerSheet: number | null;
  flashingPriceCentsPerM: Record<FlashingKind, number | null>;
  priceBasis: 'SYNTHETIC' | 'ENTERED';
};

export type FlashingInput = { kind: FlashingKind; lengthMm: number };

export type BomResult = {
  lines: BomLine[];
  warnings: string[];
  incomplete: boolean;
};

/**
 * Bill of materials for one roof revision.
 *
 * Anything derived from an unverified or synthetic specification is flagged, not silently
 * priced as though it were real. A BOM containing flagged lines cannot be ordered.
 */
export function buildBom(params: {
  planes: PlaneGeometry[];
  layout: LayoutResult;
  flashings: FlashingInput[];
  profile: MaterialProfile;
}): BomResult {
  const { layout, flashings, profile } = params;
  const lines: BomLine[] = [];
  const warnings: string[] = [];
  let incomplete = false;

  if (!layout.ok) {
    return { lines: [], warnings: [layout.reason], incomplete: true };
  }

  const priceIsSynthetic = profile.priceBasis === 'SYNTHETIC';
  const specUnverified = profile.effectiveCoverMm === null || profile.maxLengthMm === null;

  // Sheets, grouped by cut length across every plane.
  const byLength = new Map<number, number>();
  for (const plane of layout.planes) {
    for (const segment of plane.segments) {
      byLength.set(segment.lengthMm, (byLength.get(segment.lengthMm) ?? 0) + plane.courses);
    }
  }

  const sheetPriceCentsPerM = profile.sheetPriceCentsPerM ?? 0;
  if (profile.sheetPriceCentsPerM === null) {
    warnings.push('Sheet pricing is not configured; sheet lines are priced at zero.');
    incomplete = true;
  }

  for (const [lengthMm, quantity] of [...byLength.entries()].sort((a, b) => a[0] - b[0])) {
    lines.push({
      key: `sheet-${lengthMm}`,
      description: `${profile.name} sheet — ${lengthMm} mm`,
      category: 'sheet',
      lengthMm,
      quantityMicro: quantity * 1_000_000,
      unit: 'ea',
      unitPriceCents: mulDivRound(sheetPriceCentsPerM, lengthMm, 1000),
      isPlaceholder: specUnverified || priceIsSynthetic,
      note: priceIsSynthetic ? 'Synthetic development pricing' : undefined,
    });
  }

  // Flashings: quantity is lineal metres of the installed run.
  for (const flashing of flashings) {
    if (flashing.lengthMm <= 0) continue;
    const price = profile.flashingPriceCentsPerM[flashing.kind];
    if (price === null) {
      warnings.push(`${flashing.kind} pricing is not configured.`);
      incomplete = true;
    }
    lines.push({
      key: `flashing-${flashing.kind}`,
      description: `${labelForFlashing(flashing.kind)} flashing`,
      category: 'flashing',
      quantityMicro: flashing.lengthMm * 1000,
      unit: 'm',
      unitPriceCents: price ?? 0,
      isPlaceholder: specUnverified || priceIsSynthetic,
      note: priceIsSynthetic ? 'Synthetic development pricing' : undefined,
    });
  }

  // Fasteners come from a rule. Without the rule there is no number at all.
  if (profile.fixingPerSheet === null) {
    warnings.push('Fixing rule is not configured, so fastener quantities are not calculated.');
    incomplete = true;
  } else if (layout.ok) {
    const sheets = layout.totalSheets;
    lines.push({
      key: 'fasteners',
      description: 'Roofing fasteners',
      category: 'fastener',
      quantityMicro: sheets * profile.fixingPerSheet * 1_000_000,
      unit: 'ea',
      unitPriceCents: 0,
      isPlaceholder: true,
      note: 'Quantity derived from the fixing rule; unit price not yet configured.',
    });
  }

  return { lines, warnings, incomplete };
}

export function labelForFlashing(kind: FlashingKind): string {
  const labels: Record<FlashingKind, string> = {
    ridge: 'Ridge',
    hip: 'Hip',
    valley: 'Valley',
    barge: 'Barge',
    apron: 'Apron',
    box_gutter: 'Box gutter',
    eave: 'Eave',
  };
  return labels[kind];
}
