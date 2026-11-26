import { mulDivRound } from './units';

export type PricedLine = {
  qtyMicro: number;
  unitPriceCents: number;
};

export type Totals = {
  lineAmountsCents: number[];
  subtotalCents: number;
  gstCents: number;
  totalCents: number;
  gstRateBp: number;
  gstApplied: boolean;
};

/**
 * Rounding boundary R4/R5 from NDC-1.0.
 *
 * Each line is rounded individually and the subtotal is their sum, so a customer can add
 * the printed lines and reach the printed subtotal. Tax is computed on that subtotal.
 */
export function computeTotals(
  lines: PricedLine[],
  options: { gstRateBp: number; gstApplied: boolean },
): Totals {
  const lineAmountsCents = lines.map((line) => mulDivRound(line.qtyMicro, line.unitPriceCents, 1_000_000));
  const subtotalCents = lineAmountsCents.reduce((sum, amount) => sum + amount, 0);
  const gstCents = options.gstApplied ? mulDivRound(subtotalCents, options.gstRateBp, 10_000) : 0;
  return {
    lineAmountsCents,
    subtotalCents,
    gstCents,
    totalCents: subtotalCents + gstCents,
    gstRateBp: options.gstRateBp,
    gstApplied: options.gstApplied,
  };
}

/** Apply a margin to a cost base. 1000 bp = 10%. */
export function applyMargin(costCents: number, marginBp: number): number {
  return mulDivRound(costCents, 10_000 + marginBp, 10_000);
}

/** Allocations must never exceed the payment or the invoice. */
export function remainingBalance(totalCents: number, allocatedCents: number): number {
  return totalCents - allocatedCents;
}
