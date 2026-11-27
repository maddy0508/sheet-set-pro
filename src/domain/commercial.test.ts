import { describe, expect, it } from 'vitest';
import type { Allocation, Invoice, Payment } from '@/data/types';
import {
  allocatedToInvoice,
  checkAllocation,
  checkInvoiceVoid,
  checkPaymentAmount,
  decideGst,
  invoiceOutstanding,
} from './commercial';

const payment = (amountCents: number): Payment => ({
  id: 'pay-1',
  jobId: 'job-1',
  amountCents,
  receivedAt: '2026-11-26T00:00:00.000Z',
  method: 'bank_transfer',
  reference: 'REF-1',
  idempotencyKey: 'key-1',
  createdAt: '2026-11-26T00:00:00.000Z',
});

const invoice = (status: Invoice['status'], totalCents: number): Invoice => ({
  id: 'inv-1',
  jobId: 'job-1',
  number: 'INV-0001',
  quoteId: null,
  status,
  lines: [],
  totals: { subtotalCents: totalCents, gstCents: 0, totalCents },
  gstRegisteredSnapshot: null,
  gstRateBp: 1000,
  issuedAt: status === 'draft' ? null : '2026-11-26T00:00:00.000Z',
  dueDate: null,
  voidReason: null,
  fingerprint: '',
  createdAt: '2026-11-26T00:00:00.000Z',
});

const allocation = (paymentId: string, invoiceId: string, amountCents: number): Allocation => ({
  id: `alloc-${paymentId}-${invoiceId}-${amountCents}`,
  paymentId,
  invoiceId,
  amountCents,
  createdAt: '2026-11-26T00:00:00.000Z',
});

describe('payment amount', () => {
  it('rejects zero, negative and fractional cents', () => {
    expect(checkPaymentAmount(0).ok).toBe(false);
    expect(checkPaymentAmount(-100).ok).toBe(false);
    expect(checkPaymentAmount(10.5).ok).toBe(false);
  });

  it('accepts a positive whole number of cents', () => {
    expect(checkPaymentAmount(458_544).ok).toBe(true);
  });
});

describe('allocation', () => {
  it('refuses a draft invoice', () => {
    const result = checkAllocation({
      payment: payment(458_544),
      invoice: invoice('draft', 458_544),
      allocations: [],
      amountCents: 1000,
    });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ message: expect.stringContaining('draft') });
  });

  it('refuses a voided invoice', () => {
    const result = checkAllocation({
      payment: payment(458_544),
      invoice: invoice('voided', 458_544),
      allocations: [],
      amountCents: 1000,
    });
    expect(result.ok).toBe(false);
  });

  it('accepts a partial payment against an issued invoice', () => {
    expect(
      checkAllocation({
        payment: payment(458_544),
        invoice: invoice('issued', 458_544),
        allocations: [],
        amountCents: 200_000,
      }).ok,
    ).toBe(true);
  });

  it('refuses an allocation beyond the payment remainder', () => {
    const result = checkAllocation({
      payment: payment(100_000),
      invoice: invoice('issued', 458_544),
      allocations: [allocation('pay-1', 'inv-1', 60_000)],
      amountCents: 50_000,
    });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ message: expect.stringContaining('payment') });
  });

  it('refuses an allocation beyond the invoice outstanding balance', () => {
    const result = checkAllocation({
      payment: payment(1_000_000),
      invoice: invoice('issued', 458_544),
      allocations: [allocation('pay-1', 'inv-1', 400_000)],
      amountCents: 60_000,
    });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ message: expect.stringContaining('outstanding') });
  });

  it('allows the final allocation that clears the invoice', () => {
    const allocations = [allocation('pay-1', 'inv-1', 400_000)];
    expect(
      checkAllocation({
        payment: payment(458_544),
        invoice: invoice('issued', 458_544),
        allocations,
        amountCents: 58_544,
      }).ok,
    ).toBe(true);
    expect(invoiceOutstanding(invoice('issued', 458_544), [...allocations, allocation('pay-1', 'inv-1', 58_544)])).toBe(0);
  });
});

describe('voiding an invoice', () => {
  it('refuses an invoice that has money allocated to it', () => {
    const result = checkInvoiceVoid(invoice('issued', 458_544), [allocation('pay-1', 'inv-1', 100_000)]);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ message: expect.stringContaining('$1,000.00') });
  });

  it('allows an unpaid issued invoice to be voided', () => {
    expect(checkInvoiceVoid(invoice('issued', 458_544), []).ok).toBe(true);
  });

  it('refuses a draft, which is deleted rather than voided', () => {
    expect(checkInvoiceVoid(invoice('draft', 458_544), []).ok).toBe(false);
  });
});

describe('GST decision', () => {
  it('does not apply GST while registration is unconfirmed', () => {
    expect(decideGst({ gstRegistered: null, gstRateConfirmed: false })).toEqual({ ok: true, applied: false });
  });

  it('does not apply GST when the business is recorded as not registered', () => {
    expect(decideGst({ gstRegistered: false, gstRateConfirmed: false })).toEqual({ ok: true, applied: false });
  });

  it('refuses to issue while registered but the rate is unconfirmed', () => {
    const result = decideGst({ gstRegistered: true, gstRateConfirmed: false });
    expect(result.ok).toBe(false);
  });

  it('applies GST once registration and the rate are both confirmed', () => {
    expect(decideGst({ gstRegistered: true, gstRateConfirmed: true })).toEqual({ ok: true, applied: true });
  });
});

describe('allocation totals', () => {
  it('sums only the allocations for the invoice asked about', () => {
    const allocations = [allocation('pay-1', 'inv-1', 1000), allocation('pay-1', 'inv-2', 5000)];
    expect(allocatedToInvoice(allocations, 'inv-1')).toBe(1000);
  });
});
