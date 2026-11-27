import { useMemo, useState } from 'react';
import { useStore } from '@/data/store';
import { applyMargin, computeTotals } from '@/domain/pricing';
import { formatAreaM2, formatCents, MM_PER_M } from '@/domain/units';
import type { DocLine } from '@/data/types';
import { Badge, Card, Field, Modal, Notice, Stat, UnitInput } from '@/ui';
import { IconAlert, IconCheck, IconDoc } from '@/ui/icons';
import { quoteDocument } from '@/lib/document';
import { downloadPdf } from '@/lib/pdf';
import type { JobTabProps } from './types';

export function CommercialTab({ job, computation, profile }: JobTabProps) {
  const { state, actions } = useStore();
  const company = state.company;
  const estimates = state.estimates.filter((e) => e.jobId === job.id);
  const quotes = state.quotes.filter((q) => q.jobId === job.id);
  const customer = state.customers.find((c) => c.id === job.customerId);

  const [marginBp, setMarginBp] = useState(String(company.defaultMarginBp));
  const [showPreview, setShowPreview] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const [pdfNotice, setPdfNotice] = useState('');
  const [issueError, setIssueError] = useState('');
  const [previewQuoteId, setPreviewQuoteId] = useState<string | null>(null);
  const [validUntil, setValidUntil] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    return date.toISOString().slice(0, 10);
  });

  const margin = Number(marginBp) || 0;
  const areaM2Micro = Math.round((computation.areaMm2 / (MM_PER_M * MM_PER_M)) * 1_000_000);
  const labourCents = Math.round((areaM2Micro * company.labourRateCentsPerM2) / 1_000_000);

  const sellLines: DocLine[] = useMemo(
    () =>
      computation.bom.lines.map((line) => ({
        key: line.key,
        description: line.description,
        qtyMicro: line.quantityMicro,
        unit: line.unit,
        unitPriceCents: applyMargin(line.unitPriceCents, margin),
        isPlaceholder: line.isPlaceholder,
      })),
    [computation.bom.lines, margin],
  );

  const materialTotals = computeTotals(
    sellLines.map((line) => ({ qtyMicro: line.qtyMicro, unitPriceCents: line.unitPriceCents })),
    { gstRateBp: company.gstRateBp, gstApplied: company.gstRegistered === true },
  );

  const labourLine: DocLine = {
    key: 'labour',
    description: 'Installation labour',
    qtyMicro: areaM2Micro,
    unit: 'm²',
    unitPriceCents: company.labourRateCentsPerM2,
    isPlaceholder: false,
  };
  const pricedLines = [...sellLines, labourLine];
  const allTotals = computeTotals(
    pricedLines.map((line) => ({ qtyMicro: line.qtyMicro, unitPriceCents: line.unitPriceCents })),
    { gstRateBp: company.gstRateBp, gstApplied: company.gstRegistered === true },
  );
  const sellSubtotal = allTotals.subtotalCents;
  const gstCents = allTotals.gstCents;

  const catalogueVerified = profile?.verificationState === 'VERIFIED';
  const saveQuotePdf = (quoteId: string) => {
    const quote = quotes.find((candidate) => candidate.id === quoteId);
    if (!quote) return;
    setPdfError('');
    setPdfNotice('');
    void downloadPdf(quoteDocument({ quote, job, customer, company, catalogueVerified }))
      .then(() => setPdfNotice(`Quote ${quote.number} saved as a PDF.`))
      .catch((error: unknown) => {
        setPdfError(error instanceof Error ? error.message : 'The PDF could not be produced.');
      });
  };

  const latestEstimate = estimates[0];
  const latestQuote = quotes[0];
  const previewQuote = quotes.find((q) => q.id === previewQuoteId) ?? null;

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="grid grid-4">
        <Stat label="Sell price" value={formatCents(sellSubtotal + gstCents)} hint={company.gstRegistered === true ? 'Including GST' : 'GST not applied'} />
        <Stat label="Material" value={formatCents(materialTotals.subtotalCents)} hint={`${sellLines.length} priced lines`} />
        <Stat label="Labour" value={formatCents(labourCents)} hint={`${formatAreaM2(computation.areaMm2)} at ${formatCents(company.labourRateCentsPerM2)}/m²`} />
        <Stat accent label="Margin" value={`${(margin / 100).toFixed(2)}%`} hint="Applied per line, recorded on the revision" />
      </div>

      {company.gstRegistered === null && (
        <Notice tone="warn" icon={<IconAlert />}>
          GST registration is not confirmed, so quotes and invoices are produced without GST. Confirm the business tax
          status in <strong>Settings</strong> before issuing a tax document.
        </Notice>
      )}

      <div className="grid grid-sidebar">
        <Card
          title="Build estimate"
          subtitle="Priced from the current bill of materials"
          action={
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => actions.saveEstimate(job.id, pricedLines, margin, 0)}
              disabled={sellLines.length === 0}
            >
              Save revision
            </button>
          }
          tight
        >
          {sellLines.length === 0 ? (
            <div className="empty">
              <strong>No priced lines</strong>
              <p>Complete the roof and product specification to price this job.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="num">Qty</th>
                    <th className="num">Rate</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {pricedLines.map((line, index) => (
                    <tr key={line.key}>
                      <td>
                        <span className="cell-strong">{line.description}</span>
                        {line.isPlaceholder && <span className="cell-sub">Unverified specification</span>}
                      </td>
                      <td className="num">
                        {(line.qtyMicro / 1_000_000).toLocaleString('en-AU', { maximumFractionDigits: 2 })} {line.unit}
                      </td>
                      <td className="num">{formatCents(line.unitPriceCents)}</td>
                      <td className="num">{formatCents(allTotals.lineAmountsCents[index])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="card-foot">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="small faint">Margin</span>
              <div style={{ width: 90 }}>
                <UnitInput unit="bp" value={marginBp} onChange={(e) => setMarginBp(e.target.value)} />
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="small faint">Subtotal {formatCents(sellSubtotal)}</div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{formatCents(sellSubtotal + gstCents)}</div>
            </div>
          </div>
        </Card>

        <div className="grid" style={{ gap: 16 }}>
          <Card title="Issue quote" subtitle="Issued quotes are locked and hash-stamped">
            {latestEstimate ? (
              <div className="grid" style={{ gap: 12 }}>
                <div className="small muted">
                  Revision {latestEstimate.revision} · {formatCents(latestEstimate.totals.totalCents)}
                </div>
                <Field label="Valid until">
                  <UnitInput unit="" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
                </Field>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    const result = actions.issueQuote(job.id, latestEstimate.id, validUntil);
                    setIssueError(result.ok ? '' : (result.message ?? 'The quote was not issued.'));
                  }}
                >
                  <IconDoc size={14} />
                  Issue quote
                </button>
                {issueError && (
                  <Notice tone="danger" icon={<IconAlert />}>
                    {issueError}
                  </Notice>
                )}
              </div>
            ) : (
              <div className="small muted">Save an estimate revision first.</div>
            )}
          </Card>

          <Card title="Revisions" subtitle="Full history retained">
            {estimates.length === 0 ? (
              <div className="small muted">No estimates saved.</div>
            ) : (
              <div className="grid" style={{ gap: 8 }}>
                {estimates.slice(0, 5).map((estimate) => (
                  <div key={estimate.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                    <div>
                      <div className="small" style={{ fontWeight: 600 }}>Revision {estimate.revision}</div>
                      <div className="small faint mono">{estimate.fingerprint.slice(0, 10)}</div>
                    </div>
                    <span className="nums small">{formatCents(estimate.totals.totalCents)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {pdfError && (
        <Notice tone="danger" icon={<IconAlert />}>
          The document could not be produced: {pdfError}
        </Notice>
      )}
      {pdfNotice && (
        <Notice tone="ok" icon={<IconCheck />}>
          {pdfNotice} Check your downloads folder.
        </Notice>
      )}

      <Card title="Quotes" subtitle="Customer-facing offers" tight>
        {quotes.length === 0 ? (
          <div className="empty">
            <strong>No quote issued</strong>
            <p>Save an estimate revision, then issue it as a quote. Issued quotes cannot be edited.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Quote</th>
                  <th>Issued</th>
                  <th>Valid until</th>
                  <th className="num">Total</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {quotes.map((quote) => (
                  <tr key={quote.id}>
                    <td>
                      <span className="cell-strong">{quote.number}</span>
                      <span className="cell-sub mono">{quote.fingerprint.slice(0, 10)}</span>
                    </td>
                    <td className="small">
                      {quote.issuedAt ? new Date(quote.issuedAt).toLocaleDateString('en-AU') : '—'}
                    </td>
                    <td className="small">{quote.validUntil ?? '—'}</td>
                    <td className="num">{formatCents(quote.totals.totalCents)}</td>
                    <td>
                      <Badge tone={quote.status === 'accepted' ? 'ok' : quote.status === 'declined' ? 'danger' : 'cyan'}>
                        {quote.status}
                      </Badge>
                    </td>
                    <td className="actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          setPreviewQuoteId(quote.id);
                          setShowPreview(true);
                        }}
                      >
                        Preview
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => saveQuotePdf(quote.id)}>
                        PDF
                      </button>
                      {quote.status === 'issued' && (
                        <>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => actions.setQuoteStatus(quote.id, 'accepted')}>
                            Accept
                          </button>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => actions.setQuoteStatus(quote.id, 'declined')}>
                            Decline
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {latestQuote?.status === 'accepted' && (
        <Notice tone="ok" icon={<IconCheck />}>
          Quote {latestQuote.number} has been accepted. The job is ready to invoice from the Billing tab.
        </Notice>
      )}

      <Modal
        open={showPreview && previewQuote !== null}
        title={`Quote ${previewQuote?.number ?? ''}`}
        subtitle="Exactly what the customer receives"
        onClose={() => setShowPreview(false)}
        wide
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setShowPreview(false)}>
              Close
            </button>
            {previewQuote && (
              <button type="button" className="btn btn-primary" onClick={() => saveQuotePdf(previewQuote.id)}>
                <IconDoc size={14} />
                Download PDF
              </button>
            )}
          </div>
        }
      >
        {previewQuote && (
          <div className="doc-preview">
            <div className="doc-head">
              <div>
                <h2>{company.displayName}</h2>
                <div className="small" style={{ marginTop: 4, color: '#4d5c69' }}>
                  {company.address ?? 'Business address not confirmed'}
                  <br />
                  {company.abn ? `ABN ${company.abn}` : 'ABN not confirmed'}
                  <br />
                  {company.phone || company.email || ''}
                </div>
              </div>
              <div className="doc-meta">
                <strong>QUOTE {previewQuote.number}</strong>
                <br />
                Issued {previewQuote.issuedAt ? new Date(previewQuote.issuedAt).toLocaleDateString('en-AU') : '—'}
                <br />
                Valid until {previewQuote.validUntil ?? '—'}
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
                {previewQuote.lines.map((line) => (
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
                <span>{formatCents(previewQuote.totals.subtotalCents)}</span>
              </div>
              <div>
                <span>GST {previewQuote.gstApplied ? `(${(previewQuote.gstRateBp / 100).toFixed(2)}%)` : '(not applied)'}</span>
                <span>{formatCents(previewQuote.totals.gstCents)}</span>
              </div>
              <div className="grand">
                <span>Total</span>
                <span>{formatCents(previewQuote.totals.totalCents)}</span>
              </div>
            </div>

            <div className="doc-stamp">
              Prepared from measurements recorded for this site. Quantities are based on
              {profile?.verificationState === 'VERIFIED' ? ' a verified product specification.' : ' a synthetic development specification and are not for manufacture.'}
              {company.gstRegistered === null && ' GST registration is not confirmed; this document is not a tax invoice.'}
              <br />
              Document fingerprint {previewQuote.fingerprint}.
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
