import { useMemo, useState } from 'react';
import { useStore } from '@/data/store';
import type { SupplierExport } from '@/data/types';
import {
  SUPPLIER_ADAPTERS,
  adapterById,
  buildSupplierOrder,
  nextSupplierOrderNumber,
  type SupplierOrder,
} from '@/domain/supplier';
import { Badge, Card, Field, Notice, Stat } from '@/ui';
import { IconAlert, IconCheck, IconDoc } from '@/ui/icons';
import { downloadSupplierOrderPdf } from '@/lib/supplierPdf';
import type { JobTabProps } from './types';

const KIND_LABEL: Record<string, string> = {
  sheet: 'Sheets',
  flashing: 'Flashings',
  fastener: 'Fasteners',
  accessory: 'Accessories',
  consumable: 'Consumables',
};

function saveFile(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function OrderTab({ job, computation, profile }: JobTabProps) {
  const { state, actions } = useStore();
  const company = state.company;
  const customer = state.customers.find((c) => c.id === job.customerId);
  const exports = state.supplierExports.filter((entry) => entry.jobId === job.id);

  const [adapterId, setAdapterId] = useState(SUPPLIER_ADAPTERS[0].id);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [colourDraft, setColourDraft] = useState(job.colour ?? '');
  const [requiredByDraft, setRequiredByDraft] = useState(job.requiredBy ?? '');

  const calculation = state.snapshots.find((snapshot) => snapshot.jobId === job.id) ?? null;

  /** Review shows the exact order the export will write, with the number it will carry. */
  const preview = useMemo<SupplierOrder>(
    () =>
      buildSupplierOrder({
        number: nextSupplierOrderNumber(state.supplierExports),
        generatedAt: new Date().toISOString(),
        company,
        customer,
        job,
        profile,
        bom: computation.bom,
        layout: computation.layout,
        calculation: calculation
          ? {
              inputFingerprint: calculation.inputFingerprint,
              outputFingerprint: calculation.outputFingerprint,
              engineVersion: calculation.engineVersion,
            }
          : null,
        orderBlockers: computation.orderBlockers,
        colour: job.colour,
        requiredBy: job.requiredBy,
      }),
    [company, customer, job, profile, computation.bom, computation.layout, computation.orderBlockers, calculation, state.supplierExports],
  );

  const adapter = adapterById(adapterId);
  const canExport = computation.layout.ok && preview.lines.length > 0;

  const record = (order: SupplierOrder, format: 'pdf' | 'csv') =>
    actions.recordSupplierExport(job.id, order, adapter.id, format);

  const exportPdf = async () => {
    setError('');
    try {
      const number = nextSupplierOrderNumber(state.supplierExports);
      const order = buildSupplierOrder({
        number,
        generatedAt: new Date().toISOString(),
        company,
        customer,
        job,
        profile,
        bom: computation.bom,
        layout: computation.layout,
        calculation: calculation
          ? {
              inputFingerprint: calculation.inputFingerprint,
              outputFingerprint: calculation.outputFingerprint,
              engineVersion: calculation.engineVersion,
            }
          : null,
        orderBlockers: computation.orderBlockers,
        colour: job.colour,
        requiredBy: job.requiredBy,
      });
      await downloadSupplierOrderPdf(order);
      record(order, 'pdf');
      setNotice(`${number} recorded as a PDF export.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const exportCsv = () => {
    setError('');
    const number = nextSupplierOrderNumber(state.supplierExports);
    const order = buildSupplierOrder({
      number,
      generatedAt: new Date().toISOString(),
      company,
      customer,
      job,
      profile,
      bom: computation.bom,
      layout: computation.layout,
      calculation: calculation
        ? {
            inputFingerprint: calculation.inputFingerprint,
            outputFingerprint: calculation.outputFingerprint,
            engineVersion: calculation.engineVersion,
          }
        : null,
      orderBlockers: computation.orderBlockers,
      colour: job.colour,
      requiredBy: job.requiredBy,
    });
    saveFile(`${number}-${adapter.id}.csv`, adapter.csv(order), 'text/csv;charset=utf-8;');
    record(order, 'csv');
    setNotice(`${number} recorded as a CSV export.`);
  };

  const saveJobDetails = () => {
    actions.updateJob(job.id, {
      colour: colourDraft.trim() || null,
      requiredBy: requiredByDraft || null,
    });
    setNotice('Job details saved for the order.');
  };

  const totalSheets = preview.lines.filter((line) => line.kind === 'sheet').reduce((sum, line) => sum + line.quantity, 0);
  const cutLengths = new Set(preview.lines.filter((line) => line.kind === 'sheet' && line.lengthMm).map((line) => line.lengthMm));

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="grid grid-4">
        <Stat
          accent
          label="Order status"
          value={preview.status === 'READY' ? 'Ready' : 'Blocked'}
          hint={preview.status === 'READY' ? 'Verified specification and complete BOM' : `${preview.blockers.length} condition${preview.blockers.length === 1 ? '' : 's'} outstanding`}
        />
        <Stat label="Sheet lines" value={totalSheets} hint={`${cutLengths.size} distinct cut length${cutLengths.size === 1 ? '' : 's'}`} />
        <Stat label="Flashing / fixing lines" value={preview.lines.length - preview.lines.filter((line) => line.kind === 'sheet').length} hint="Lineal metres and counts" />
        <Stat label="Exports recorded" value={exports.length} hint="Every one carries its BOM fingerprint" />
      </div>

      {preview.blockers.length > 0 && (
        <Card title="Before this can be manufactured" subtitle="The order can still be sent, clearly marked as unconfirmed">
          <div className="grid" style={{ gap: 8 }}>
            {preview.blockers.map((blocker) => (
              <div key={blocker} className="notice notice-warn">
                <IconAlert />
                <div>{blocker}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {preview.placeholders.length > 0 && (
        <Card title="Not recorded" subtitle="Listed on the order as gaps, never filled in with a guess">
          <div className="grid" style={{ gap: 6 }}>
            {preview.placeholders.map((placeholder) => (
              <div key={placeholder} className="small muted">
                · {placeholder}
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-sidebar">
        <Card
          title="Supplier order"
          subtitle={`${preview.heading} · ${preview.number}`}
          tight
          action={
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={!canExport}>
                CSV
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void exportPdf()} disabled={!canExport}>
                <IconDoc size={14} />
                PDF
              </button>
            </div>
          }
        >
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Detail</th>
                  <th className="num">Length</th>
                  <th className="num">Qty</th>
                  <th>Unit</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {preview.lines.map((line) => (
                  <tr key={line.key}>
                    <td>
                      <div className="cell-strong">{line.item}</div>
                      <div className="small faint">{KIND_LABEL[line.kind] ?? line.kind}</div>
                    </td>
                    <td className="small muted">
                      {line.detail.length > 0 ? line.detail.join(' · ') : '—'}
                      {line.note && <div className="faint">{line.note}</div>}
                    </td>
                    <td className="num">{line.lengthMm === null ? '—' : `${line.lengthMm} mm`}</td>
                    <td className="num">{line.quantity.toLocaleString('en-AU')}</td>
                    <td>{line.unit}</td>
                    <td>
                      {line.verified ? <Badge tone="ok">Verified</Badge> : <Badge tone="warn">Unverified</Badge>}
                    </td>
                  </tr>
                ))}
                {preview.lines.length === 0 && (
                  <tr>
                    <td colSpan={6}>
                      <div className="empty">Nothing to order yet: the sheet layout has not produced any sheets.</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="grid" style={{ gap: 16 }}>
          <Card title="Product" subtitle={`Catalogue revision ${preview.product.catalogueRevision}`}>
            <dl className="kv">
              <dt>Profile</dt>
              <dd>{preview.product.profile}</dd>
              <dt>Manufacturer</dt>
              <dd>{preview.product.manufacturer}</dd>
              <dt>Material</dt>
              <dd>{preview.product.material}</dd>
              <dt>Thickness</dt>
              <dd>{preview.product.thickness ?? <span className="faint">Not configured</span>}</dd>
              <dt>Coating</dt>
              <dd>{preview.product.coating}</dd>
              <dt>Colour</dt>
              <dd>{preview.product.colour ?? <span className="faint">Not recorded</span>}</dd>
              <dt>Verification</dt>
              <dd>
                {preview.product.verification === 'VERIFIED' ? (
                  <Badge tone="ok">Verified</Badge>
                ) : (
                  <Badge tone="warn">{preview.product.verification}</Badge>
                )}
              </dd>
            </dl>
          </Card>

          <Card title="Supplier" subtitle="Set in Settings · used on every order">
            {company.supplierName ? (
              <dl className="kv">
                <dt>Name</dt>
                <dd>{company.supplierName}</dd>
                <dt>Email</dt>
                <dd>{company.supplierEmail ?? <span className="faint">Not configured</span>}</dd>
                <dt>Account</dt>
                <dd>{company.supplierAccount ?? <span className="faint">Not configured</span>}</dd>
              </dl>
            ) : (
              <Notice tone="warn" icon={<IconAlert />}>
                No supplier is configured. The order prints a placeholder so the gap is visible rather than invented.
              </Notice>
            )}
          </Card>

          <Card title="Job details for the order" subtitle="Recorded on the job, never assumed">
            <div className="grid" style={{ gap: 12 }}>
              <Field label="Roof colour">
                <input
                  className="input"
                  value={colourDraft}
                  placeholder="e.g. Monument"
                  onChange={(event) => setColourDraft(event.target.value)}
                />
              </Field>
              <Field label="Required by">
                <input
                  className="input"
                  type="date"
                  value={requiredByDraft}
                  onChange={(event) => setRequiredByDraft(event.target.value)}
                />
              </Field>
              <button type="button" className="btn btn-secondary btn-sm" onClick={saveJobDetails}>
                Save job details
              </button>
            </div>
          </Card>

          <Card title="Output format" subtitle="Each adapter writes the same order differently">
            <Field label="Adapter">
              <select className="input" value={adapterId} onChange={(event) => setAdapterId(event.target.value)}>
                {SUPPLIER_ADAPTERS.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="small muted" style={{ marginTop: 8 }}>
              {adapter.description}
            </div>
          </Card>
        </div>
      </div>

      {(notice || error) && (
        <Notice tone={error ? 'danger' : 'ok'} icon={error ? <IconAlert /> : <IconCheck />}>
          {error || notice}
        </Notice>
      )}

      <Card
        title="Provenance"
        subtitle="What this order was built from, so a query can be answered later"
      >
        <dl className="kv">
          <dt>Order fingerprint</dt>
          <dd className="mono small">{preview.fingerprint}</dd>
          <dt>Bill of materials</dt>
          <dd className="mono small">{preview.provenance.bomFingerprint}</dd>
          <dt>Calculation</dt>
          <dd className="mono small">
            {preview.provenance.calcOutputFingerprint
              ? `${preview.provenance.calcOutputFingerprint} · engine ${preview.provenance.engineVersion}`
              : 'No calculation snapshot stored'}
          </dd>
          <dt>Sheets</dt>
          <dd>
            {preview.provenance.totalSheets} sheets · {(preview.provenance.totalSheetLengthMm / 1000).toFixed(2)} m of sheet
          </dd>
          <dt>Record type</dt>
          <dd>
            {preview.provenance.recordType === 'REAL' ? (
              <Badge tone="ok">REAL</Badge>
            ) : (
              <Badge tone="warn">{preview.provenance.recordType}</Badge>
            )}
          </dd>
        </dl>
      </Card>

      <Card title="Export history" subtitle="Append-only: the exact order supplied, kept with its revision" tight>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Generated</th>
                <th>Format</th>
                <th>Adapter</th>
                <th>Status</th>
                <th>BOM</th>
              </tr>
            </thead>
            <tbody>
              {exports.map((entry: SupplierExport) => (
                <tr key={entry.id}>
                  <td className="cell-strong">{entry.number}</td>
                  <td className="small muted">{new Date(entry.generatedAt).toLocaleString('en-AU')}</td>
                  <td>{entry.format.toUpperCase()}</td>
                  <td className="small">{adapterById(entry.adapter).label}</td>
                  <td>
                    {entry.status === 'READY' ? <Badge tone="ok">Ready</Badge> : <Badge tone="warn">Not for manufacture</Badge>}
                  </td>
                  <td className="mono small">{entry.bomFingerprint}</td>
                </tr>
              ))}
              {exports.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <div className="empty">Nothing exported yet. Review the order above, then export it.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
