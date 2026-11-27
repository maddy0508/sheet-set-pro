import type { Allocation, Company, Invoice, Payment } from '@/data/types';
import { formatCents } from './units';

export type Refusal = { ok: true } | { ok: false; message: string };

const OK: Refusal = { ok: true };
const refuse = (message: string): Refusal => ({ ok: false, message });

export function allocatedToPayment(allocations: Allocation[], paymentId: string): number {
  return allocations.filter((a) => a.paymentId === paymentId).reduce((sum, a) => sum + a.amountCents, 0);
}

export function allocatedToInvoice(allocations: Allocation[], invoiceId: string): number {
  return allocations.filter((a) => a.invoiceId === invoiceId).reduce((sum, a) => sum + a.amountCents, 0);
}

export function paymentRemaining(payment: Payment, allocations: Allocation[]): number {
  return payment.amountCents - allocatedToPayment(allocations, payment.id);
}

export function invoiceOutstanding(invoice: Invoice, allocations: Allocation[]): number {
  return invoice.totals.totalCents - allocatedToInvoice(allocations, invoice.id);
}

export function checkPaymentAmount(amountCents: number): Refusal {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return refuse('A payment must be a positive whole number of cents.');
  }
  return OK;
}

/**
 * Money may only be applied to an issued invoice, never to a draft or a voided one, and
 * never beyond either the payment or the invoice. Both sides are recomputed from stored
 * allocations so a stale screen cannot over-allocate.
 */
export function checkAllocation(params: {
  payment: Payment;
  invoice: Invoice;
  allocations: Allocation[];
  amountCents: number;
}): Refusal {
  const { payment, invoice, allocations, amountCents } = params;
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return refuse('An allocation must be a positive whole number of cents.');
  }
  if (invoice.status === 'draft') {
    return refuse(`${invoice.number} is still a draft. Issue it before allocating money to it.`);
  }
  if (invoice.status === 'voided') {
    return refuse(`${invoice.number} has been voided and cannot receive payments.`);
  }
  if (allocatedToPayment(allocations, payment.id) + amountCents > payment.amountCents) {
    return refuse('Allocation exceeds the unallocated balance of this payment.');
  }
  if (allocatedToInvoice(allocations, invoice.id) + amountCents > invoice.totals.totalCents) {
    return refuse(`Allocation exceeds the outstanding balance of ${invoice.number}.`);
  }
  return OK;
}

/**
 * Voiding keeps the document and its reason, but it must not strand money: an invoice that
 * has been paid cannot be voided, because the allocation would then point at a document the
 * business says never existed.
 */
export function checkInvoiceVoid(invoice: Invoice, allocations: Allocation[]): Refusal {
  if (invoice.status !== 'issued') return refuse(`${invoice.number} is not an issued invoice.`);
  const allocated = allocatedToInvoice(allocations, invoice.id);
  if (allocated > 0) {
    return refuse(
      `${invoice.number} has ${formatCents(allocated)} allocated to it. Reverse the allocation before voiding it.`,
    );
  }
  return OK;
}

export type GstDecision = { ok: true; applied: boolean } | { ok: false; message: string };

/**
 * GST is only applied once the business has recorded that it is registered and confirmed
 * the rate. Registration recorded without a confirmed rate is a half-finished fact, so
 * issuing a tax document is refused rather than guessed at.
 */
export function decideGst(company: Pick<Company, 'gstRegistered' | 'gstRateConfirmed'>): GstDecision {
  if (company.gstRegistered !== true) return { ok: true, applied: false };
  if (!company.gstRateConfirmed) {
    return {
      ok: false,
      message: 'GST registration is recorded but the rate is not confirmed. Confirm it in Settings before issuing this document.',
    };
  }
  return { ok: true, applied: true };
}
