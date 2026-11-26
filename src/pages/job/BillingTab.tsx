import { useMemo, useState } from 'react';
import { useStore } from '@/data/store';
import { formatCents } from '@/domain/units';
import { Badge, Card, EmptyState, Field, Modal, Notice, SelectInput, Stat, TextInput, UnitInput } from '@/ui';
import { IconAlert, IconCash, IconDoc } from '@/ui/icons';
import { invoiceDocument } from '@/lib/document';
import { downloadPdf } from '@/lib/pdf';
import type { JobTabProps } from './types';

export function BillingTab({ job, profile }: JobTabProps) {
  const { state, actions } = useStore();
  const invoices = state.invoices.filter((i) => i.jobId === job.id);
  const payments = state.payments.filter((p) => p.jobId === job.id);
  const quotes = state.quotes.filter((q) => q.jobId === job.id);
  const customer = state.customers.find((c) => c.id === job.customerId);
  const company = state.company;

  const [showPayment, setShowPayment] = useState(false);
  const [paymentDraft, setPaymentDraft] = useState({
    amount: '',
    method: 'bank_transfer' as 'bank_transfer' | 'cash' | 'card' | 'cheque' | 'other',
    reference: '',
    receivedAt: new Date().toISOString().slice(0, 10),
  });
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [feedback, setFeedback] = useState('');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState('');
  const [allocate, setAllocate] = useState({ paymentId: '', invoiceId: '', amount: '' });

  const allocationSums = useMemo(() => {
    const byInvoice = new Map<string, number>();
    const byPayment = new Map<string, number>();
    for (const allocation of state.allocations) {
      byInvoice.set(allocation.invoiceId, (byInvoice.get(allocation.invoiceId) ?? 0) + allocation.amountCents);
      byPayment.set(allocation.paymentId, (byPayment.get(allocation.paymentId) ?? 0) + allocation.amountCents);
    }
    return { byInvoice, byPayment };
  }, [state.allocations]);

  const issuedInvoices = invoices.filter((i) => i.status === 'issued');
  const invoicedTotal = issuedInvoices.reduce((sum, invoice) => sum + invoice.totals.totalCents, 0);
  const paidTotal = issuedInvoices.reduce((sum, invoice) => sum + (allocationSums.byInvoice.get(invoice.id) ?? 0), 0);
  const outstandingTotal = invoicedTotal - paidTotal;
  const previewInvoice = invoices.find((i) => i.id === previewId) ?? null;
  const acceptedQuote = quotes.find((q) => q.status === 'accepted') ?? null;

  const saveInvoicePdf = (invoiceId: string) => {
    const invoice = invoices.find((candidate) => candidate.id === invoiceId);
    if (!invoice) return;
    const allocated = allocationSums.byInvoice.get(invoice.id) ?? 0;
    const balanceCents =
      invoice.status === 'voided' ? 0 : invoice.status === 'issued' ? invoice.totals.totalCents - allocated : invoice.totals.totalCents;
    setPdfError('');
    downloadPdf(
      invoiceDocument({
        invoice,
        job,
        customer,
        company,
        catalogueVerified: profile?.verificationState === 'VERIFIED',
        balanceCents,
      }),
    ).catch((error: unknown) => {
      setPdfError(error instanceof Error ? error.message : 'The PDF could not be produced.');
    });
  };

  const recordPayment = () => {
    const amount = Math.round(Number(paymentDraft.amount) * 100);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFeedback('Enter a payment amount greater than zero.');
      return;
    }
    const result = actions.addPayment(
      job.id,
      { amountCents: amount, method: paymentDraft.method, reference: paymentDraft.reference, receivedAt: paymentDraft.receivedAt },
      idempotencyKey,
    );
    if (!result.ok) {
      setFeedback(result.message ?? 'Payment was not recorded.');
      return;
    }
    setIdempotencyKey(crypto.randomUUID());
    setPaymentDraft({ amount: '', method: 'bank_transfer', reference: '', receivedAt: new Date().toISOString().slice(0, 10) });
    setShowPayment(false);
    setFeedback('');
  };

  const doAllocate = () => {
    const amount = Math.round(Number(allocate.amount) * 100);
    if (!allocate.paymentId || !allocate.invoiceId) {
      setFeedback('Choose a payment and an invoice.');
      return;
    }
    const result = actions.allocatePayment(allocate.paymentId, allocate.invoiceId, amount);
    setFeedback(result.ok ? '' : result.message ?? 'Allocation failed.');
    if (result.ok) setAllocate({ paymentId: '', invoiceId: '', amount: '' });
  };

  return (
    <div className="grid" style={{ gap: 16 }}>
      {pdfError && (
        <Notice tone="danger" icon={<IconAlert />}>
          The document could not be produced: {pdfError}
        </Notice>
      )}

      <div className="grid grid-4">
        <Stat label="Invoiced" value={formatCents(invoicedTotal)} hint={`${issuedInvoices.length} issued`} />
        <Stat label="Received" value={formatCents(paidTotal)} hint={`${payments.length} payments`} />
        <Stat accent label="Outstanding" value={formatCents(outstandingTotal)} hint="Issued less allocated" />
        <Stat label="Draft invoices" value={invoices.filter((i) => i.status === 'draft').length} hint="Not yet issued" />
      </div>

      {company.gstRegistered === null && (
        <Notice tone="warn" icon={<IconAlert />}>
          GST registration is not confirmed. Invoices are issued without GST and without &ldquo;tax invoice&rdquo; wording.
          The setting at issue time is stored on the invoice and never rewritten.
        </Notice>
      )}

      <Card
        title="Invoices"
        subtitle="Issued invoices are immutable; voiding preserves the record"
        tight
        action={
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => actions.createInvoice(job.id, acceptedQuote?.id ?? quotes[0]?.id ?? null)}
            disabled={quotes.length === 0}
          >
            <IconDoc size={13} />
            Draft invoice
          </button>
        }
      >
        {invoices.length === 0 ? (
          <EmptyState
            title="No invoices"
            description={
              quotes.length === 0
                ? 'Issue a quote before invoicing.'
                : 'Draft an invoice from the accepted quote, review it, then issue it.'
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Issued</th>
                  <th className="num">Total</th>
                  <th className="num">Allocated</th>
                  <th className="num">Balance</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => {
                  const allocated = allocationSums.byInvoice.get(invoice.id) ?? 0;
                  return (
                    <tr key={invoice.id}>
                      <td>
                        <span className="cell-strong">{invoice.number}</span>
                        {invoice.quoteId && <span className="cell-sub">from quote</span>}
                      </td>
                      <td className="small">{invoice.issuedAt ? new Date(invoice.issuedAt).toLocaleDateString('en-AU') : 'Draft'}</td>
                      <td className="num">{formatCents(invoice.totals.totalCents)}</td>
                      <td className="num">{formatCents(allocated)}</td>
                      <td className="num">{formatCents(invoice.totals.totalCents - allocated)}</td>
                      <td>
                        <Badge tone={invoice.status === 'issued' ? 'warn' : invoice.status === 'voided' ? 'danger' : 'neutral'}>
                          {invoice.status}
                        </Badge>
                      </td>
                      <td className="actions">
                        {invoice.status === 'draft' && (
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => actions.issueInvoice(invoice.id)}>
                            Issue
                          </button>
                        )}
                        {invoice.status !== 'draft' && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => {
                              setPreviewId(invoice.id);
                            }}
                          >
                            Preview
                          </button>
                        )}
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => saveInvoicePdf(invoice.id)}>
                          PDF
                        </button>
                        {invoice.status === 'issued' && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => {
                              const reason = prompt('Reason for voiding this invoice?');
                              if (reason) actions.voidInvoice(invoice.id, reason);
                            }}
                          >
                            Void
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid grid-2">
        <Card
          title="Payments"
          subtitle="Idempotent: a repeated submission is rejected, not duplicated"
          tight
          action={
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowPayment(true)}>
              <IconCash size={13} />
              Record payment
            </button>
          }
        >
          {payments.length === 0 ? (
            <div className="empty">
              <strong>No payments</strong>
              <p>Record money received against this job, then allocate it to an invoice.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Received</th>
                    <th>Method</th>
                    <th className="num">Amount</th>
                    <th className="num">Allocated</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.id}>
                      <td className="small">{new Date(payment.receivedAt).toLocaleDateString('en-AU')}</td>
                      <td className="small">{payment.method.replace(/_/g, ' ')}</td>
                      <td className="num">{formatCents(payment.amountCents)}</td>
                      <td className="num">{formatCents(allocationSums.byPayment.get(payment.id) ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Allocate a payment" subtitle="Allocations can never exceed the payment or the invoice">
          <div className="grid" style={{ gap: 12 }}>
            <Field label="Payment">
              <SelectInput value={allocate.paymentId} onChange={(e) => setAllocate({ ...allocate, paymentId: e.target.value })}>
                <option value="">Select payment…</option>
                {payments.map((payment) => {
                  const remaining = payment.amountCents - (allocationSums.byPayment.get(payment.id) ?? 0);
                  return (
                    <option key={payment.id} value={payment.id}>
                      {new Date(payment.receivedAt).toLocaleDateString('en-AU')} · {formatCents(remaining)} unallocated
                    </option>
                  );
                })}
              </SelectInput>
            </Field>
            <Field label="Invoice">
              <SelectInput value={allocate.invoiceId} onChange={(e) => setAllocate({ ...allocate, invoiceId: e.target.value })}>
                <option value="">Select invoice…</option>
                {issuedInvoices.map((invoice) => (
                  <option key={invoice.id} value={invoice.id}>
                    {invoice.number} · {formatCents(invoice.totals.totalCents - (allocationSums.byInvoice.get(invoice.id) ?? 0))} outstanding
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Amount">
              <UnitInput unit="$" value={allocate.amount} onChange={(e) => setAllocate({ ...allocate, amount: e.target.value })} />
            </Field>
            <button type="button" className="btn btn-secondary" onClick={doAllocate} disabled={issuedInvoices.length === 0 || payments.length === 0}>
              Allocate
            </button>
            {feedback && <div className="notice notice-warn"><IconAlert /><div>{feedback}</div></div>}
          </div>
        </Card>
      </div>

      <Modal
        open={showPayment}
        title="Record payment"
        subtitle="A payment is a fact about money received, not a change to the invoice."
        onClose={() => setShowPayment(false)}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setShowPayment(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={recordPayment}>
              Record payment
            </button>
          </>
        }
      >
        <div className="grid" style={{ gap: 14 }}>
          <div className="form-row">
            <Field label="Amount">
              <UnitInput unit="$" value={paymentDraft.amount} onChange={(e) => setPaymentDraft({ ...paymentDraft, amount: e.target.value })} />
            </Field>
            <Field label="Received">
              <TextInput
                type="date"
                value={paymentDraft.receivedAt}
                onChange={(e) => setPaymentDraft({ ...paymentDraft, receivedAt: e.target.value })}
              />
            </Field>
          </div>
          <div className="form-row">
            <Field label="Method">
              <SelectInput
                value={paymentDraft.method}
                onChange={(e) => setPaymentDraft({ ...paymentDraft, method: e.target.value as typeof paymentDraft.method })}
              >
                <option value="bank_transfer">Bank transfer</option>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="cheque">Cheque</option>
                <option value="other">Other</option>
              </SelectInput>
            </Field>
            <Field label="Reference">
              <TextInput value={paymentDraft.reference} onChange={(e) => setPaymentDraft({ ...paymentDraft, reference: e.target.value })} />
            </Field>
          </div>
          <div className="small faint">
            Allocated to invoice {customer ? `for ${customer.name}` : ''}. Duplicate submissions are blocked by the
            idempotency key.
          </div>
        </div>
      </Modal>

      <Modal
        open={previewInvoice !== null}
        title={`Invoice ${previewInvoice?.number ?? ''}`}
        onClose={() => setPreviewId(null)}
        wide
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setPreviewId(null)}>
              Close
            </button>
            {previewInvoice && (
              <button type="button" className="btn btn-primary" onClick={() => saveInvoicePdf(previewInvoice.id)}>
                <IconDoc size={14} />
                Download PDF
              </button>
            )}
          </div>
        }
      >
        {previewInvoice && (
          <div className="doc-preview">
            <div className="doc-head">
              <div>
                <h2>{company.displayName}</h2>
                <div className="small" style={{ marginTop: 4, color: '#4d5c69' }}>
                  {company.address ?? 'Business address not confirmed'}
                  <br />
                  {company.abn ? `ABN ${company.abn}` : 'ABN not confirmed'}
                </div>
              </div>
              <div className="doc-meta">
                <strong>
                  {previewInvoice.gstRegisteredSnapshot === true ? 'TAX INVOICE' : 'INVOICE'} {previewInvoice.number}
                </strong>
                <br />
                Issued {previewInvoice.issuedAt ? new Date(previewInvoice.issuedAt).toLocaleDateString('en-AU') : '—'}
                <br />
                Due {previewInvoice.dueDate ? new Date(previewInvoice.dueDate).toLocaleDateString('en-AU') : '—'}
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <strong>{customer?.name ?? 'Customer'}</strong>
              <div style={{ color: '#4d5c69' }}>{customer?.address || job.siteAddress || 'Address not recorded'}</div>
            </div>
            <table className="doc-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th className="num">Qty</th>
                  <th className="num">Rate</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {previewInvoice.lines.map((line) => (
                  <tr key={line.key}>
                    <td>{line.description}</td>
                    <td className="num">
                      {(line.qtyMicro / 1_000_000).toLocaleString('en-AU', { maximumFractionDigits: 2 })} {line.unit}
                    </td>
                    <td className="num">{formatCents(line.unitPriceCents)}</td>
                    <td className="num">{formatCents(Math.round((line.qtyMicro * line.unitPriceCents) / 1_000_000))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="doc-totals">
              <div>
                <span>Subtotal</span>
                <span>{formatCents(previewInvoice.totals.subtotalCents)}</span>
              </div>
              <div>
                <span>GST {previewInvoice.gstRegisteredSnapshot === true ? `(${(previewInvoice.gstRateBp / 100).toFixed(2)}%)` : '(not applied)'}</span>
                <span>{formatCents(previewInvoice.totals.gstCents)}</span>
              </div>
              <div className="grand">
                <span>Total due</span>
                <span>{formatCents(previewInvoice.totals.totalCents)}</span>
              </div>
            </div>
            <div className="doc-stamp">
              {previewInvoice.status === 'voided' && <strong>VOIDED — {previewInvoice.voidReason}. </strong>}
              GST setting recorded at issue: {previewInvoice.gstRegisteredSnapshot === null ? 'not confirmed' : previewInvoice.gstRegisteredSnapshot ? 'registered' : 'not registered'}.
              Document fingerprint {previewInvoice.fingerprint || 'draft, not issued'}.
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
