import { useState } from 'react';
import { formatCents } from '@/domain/units';
import { mulDivRound } from '@/domain/units';
import { Badge, Card, Notice, Stat } from '@/ui';
import { IconAlert, IconCheck } from '@/ui/icons';
import type { JobTabProps } from './types';

const CATEGORY_LABEL: Record<string, string> = {
  sheet: 'Sheets',
  flashing: 'Flashings',
  fastener: 'Fasteners',
  accessory: 'Accessories',
  consumable: 'Consumables',
};

export function MaterialsTab({ job, computation, profile }: JobTabProps) {
  const [exported, setExported] = useState(false);
  const lines = computation.bom.lines;

  const lineTotals = lines.map((line) => mulDivRound(line.quantityMicro, line.unitPriceCents, 1_000_000));
  const totalCents = lineTotals.reduce((sum, value) => sum + value, 0);
  const placeholderCount = lines.filter((line) => line.isPlaceholder).length;
  const canExport = !computation.bom.incomplete && placeholderCount === 0;

  const download = () => {
    const rows = [
      ['Category', 'Description', 'Quantity', 'Unit', 'Unit price (cents)', 'Line total (cents)'],
      ...lines.map((line, index) => [
        line.category,
        line.description,
        (line.quantityMicro / 1_000_000).toFixed(4),
        line.unit,
        String(line.unitPriceCents),
        String(lineTotals[index]),
      ]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${job.jobNumber}-bom.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    setExported(true);
  };

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="grid grid-4">
        <Stat label="Line items" value={lines.length} hint="Grouped by cut length and type" />
        <Stat label="Material cost" value={formatCents(totalCents)} hint="At current synthetic rates" />
        <Stat label="Placeholder lines" value={placeholderCount} hint="Blocked from ordering" />
        <Stat
          accent
          label="Supplier export"
          value={canExport ? 'Available' : 'Locked'}
          hint={canExport ? 'Order-grade conditions met' : 'Requires verified specification'}
        />
      </div>

      {computation.bom.warnings.length > 0 && (
        <Card title="Not calculated" subtitle="Reported, never guessed">
          <div className="grid" style={{ gap: 8 }}>
            {computation.bom.warnings.map((warning) => (
              <div key={warning} className="notice notice-warn">
                <IconAlert />
                <div>{warning}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card
        title="Bill of materials"
        subtitle={`${profile?.name ?? 'No product'} · quantities derive from the recorded roof and product rules`}
        tight
        action={
          <button type="button" className="btn btn-secondary btn-sm" onClick={download} disabled={!canExport}>
            Export CSV
          </button>
        }
      >
        {lines.length === 0 ? (
          <div className="empty">
            <strong>Nothing to list yet</strong>
            <p>Capture the roof and complete the product specification to produce materials.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Item</th>
                  <th className="num">Quantity</th>
                  <th className="num">Unit price</th>
                  <th className="num">Line total</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <tr key={line.key}>
                    <td className="small faint">{CATEGORY_LABEL[line.category] ?? line.category}</td>
                    <td>
                      <span className="cell-strong">{line.description}</span>
                      {line.note && <span className="cell-sub">{line.note}</span>}
                    </td>
                    <td className="num">
                      {(line.quantityMicro / 1_000_000).toLocaleString('en-AU', { maximumFractionDigits: 2 })} {line.unit}
                    </td>
                    <td className="num">{line.unitPriceCents > 0 ? formatCents(line.unitPriceCents) : <span className="faint">—</span>}</td>
                    <td className="num">{formatCents(lineTotals[index])}</td>
                    <td>
                      {line.isPlaceholder ? <Badge tone="warn">Unverified</Badge> : <Badge tone="ok">Priced</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="card-foot">
          <span className="small faint">
            {canExport
              ? 'Every line is priced and the specification is verified.'
              : 'Export stays locked while any line is a placeholder or a rule is missing.'}
          </span>
          <span className="nums" style={{ fontWeight: 600 }}>{formatCents(totalCents)}</span>
        </div>
      </Card>

      {canExport ? (
        <Notice tone="ok" icon={<IconCheck />}>
          Materials are qualified for a supplier cut-to-length order. The adapter produces a byte-stable CSV so the
          order can be reconciled later.
        </Notice>
      ) : (
        <Notice tone="warn" icon={<IconAlert />}>
          <strong>Order-grade release is locked.</strong> A supplier cannot be asked to cut sheets from a specification
          the business has not verified. Complete the product catalogue and record operator approval first.
        </Notice>
      )}

      {exported && <div className="small faint">CSV exported.</div>}
    </div>
  );
}
