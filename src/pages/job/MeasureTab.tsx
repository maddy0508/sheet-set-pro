import { useMemo, useState } from 'react';
import { useStore } from '@/data/store';
import type { EvidenceKind } from '@/domain/types';
import { formatMm } from '@/domain/units';
import { Badge, Card, EmptyState, Field, Modal, Notice, SelectInput, TextArea, TextInput, UnitInput } from '@/ui';
import { IconAlert, IconCheck, IconPlus } from '@/ui/icons';
import type { JobTabProps } from './types';

const SOURCE_KINDS: { value: EvidenceKind; label: string; orderCapable: boolean }[] = [
  { value: 'manual', label: 'Manual measurement', orderCapable: true },
  { value: 'plan', label: 'Plan / drawing', orderCapable: true },
  { value: 'photograph', label: 'Photograph', orderCapable: false },
  { value: 'aerial', label: 'Aerial imagery', orderCapable: false },
  { value: 'lidar', label: 'LiDAR scan', orderCapable: true },
  { value: 'ar_depth', label: 'AR depth capture', orderCapable: false },
  { value: 'ai_assisted', label: 'AI-assisted interpretation', orderCapable: false },
];

const MEASUREMENT_KINDS = [
  { value: 'control_dimension', label: 'Control dimension' },
  { value: 'plane_width', label: 'Plane width' },
  { value: 'plane_length', label: 'Plane length' },
  { value: 'ridge', label: 'Ridge' },
  { value: 'valley', label: 'Valley' },
  { value: 'other', label: 'Other' },
] as const;

export function MeasureTab({ job, evidence, measurements, computation }: JobTabProps) {
  const { actions } = useStore();
  const [showEvidence, setShowEvidence] = useState(false);
  const [showMeasurement, setShowMeasurement] = useState(false);
  const [error, setError] = useState('');

  const [evidenceDraft, setEvidenceDraft] = useState<{
    sourceKind: EvidenceKind;
    note: string;
    accuracyClaimMm: string;
    accuracyBasis: 'unknown' | 'operator_estimate' | 'manufacturer_spec' | 'verified_by_test';
    isVerified: boolean;
  }>({ sourceKind: 'manual', note: '', accuracyClaimMm: '', accuracyBasis: 'operator_estimate', isVerified: false });

  const [measurementDraft, setMeasurementDraft] = useState({
    evidenceId: '',
    kind: 'control_dimension' as (typeof MEASUREMENT_KINDS)[number]['value'],
    label: '',
    valueMm: '',
    toleranceMm: '',
    grade: 'ESTIMATE_GRADE' as 'ESTIMATE_GRADE' | 'ORDER_GRADE',
  });

  const active = useMemo(() => measurements.filter((m) => m.isActive), [measurements]);
  const superseded = useMemo(() => measurements.filter((m) => !m.isActive), [measurements]);
  const evidenceById = useMemo(() => new Map(evidence.map((e) => [e.id, e])), [evidence]);

  const selectedEvidence = measurementDraft.evidenceId ? evidenceById.get(measurementDraft.evidenceId) : undefined;
  const evidenceOrderCapable = selectedEvidence ? SOURCE_KINDS.find((k) => k.value === selectedEvidence.sourceKind)?.orderCapable : false;
  const orderGradeAllowed =
    Boolean(selectedEvidence?.isVerified) && Boolean(evidenceOrderCapable) && Number(measurementDraft.toleranceMm) > 0;

  const saveEvidence = () => {
    if (!evidenceDraft.note.trim()) {
      setError('Describe where this measurement came from.');
      return;
    }
    actions.addEvidence(job.id, {
      sourceKind: evidenceDraft.sourceKind,
      note: evidenceDraft.note,
      accuracyClaimMm: evidenceDraft.accuracyClaimMm ? Number(evidenceDraft.accuracyClaimMm) : null,
      accuracyBasis: evidenceDraft.accuracyBasis,
      isVerified: evidenceDraft.isVerified,
    });
    setShowEvidence(false);
    setError('');
    setEvidenceDraft({ sourceKind: 'manual', note: '', accuracyClaimMm: '', accuracyBasis: 'operator_estimate', isVerified: false });
  };

  const saveMeasurement = () => {
    if (!measurementDraft.evidenceId) return setError('Attach the evidence this measurement came from.');
    if (!measurementDraft.label.trim()) return setError('Give the measurement a label.');
    const value = Number(measurementDraft.valueMm);
    if (!Number.isFinite(value) || value <= 0) return setError('Enter a positive length in millimetres.');
    if (measurementDraft.grade === 'ORDER_GRADE' && !orderGradeAllowed) {
      return setError('Order grade needs verified evidence, an order-capable source and a declared tolerance.');
    }
    actions.addMeasurement(job.id, {
      evidenceId: measurementDraft.evidenceId,
      kind: measurementDraft.kind,
      label: measurementDraft.label,
      valueMm: Math.round(value),
      toleranceMm: measurementDraft.toleranceMm ? Math.round(Number(measurementDraft.toleranceMm)) : null,
      grade: measurementDraft.grade,
    });
    setShowMeasurement(false);
    setError('');
    setMeasurementDraft({ evidenceId: '', kind: 'control_dimension', label: '', valueMm: '', toleranceMm: '', grade: 'ESTIMATE_GRADE' });
  };

  return (
    <div className="grid grid-sidebar">
      <div className="grid" style={{ gap: 16 }}>
        <Card
          title="Measurements"
          subtitle="Integer millimetres. Corrections supersede; nothing is overwritten."
          tight
          action={
            <div className="toolbar">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowEvidence(true)}>
                <IconPlus size={13} />
                Evidence
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  setError('');
                  setMeasurementDraft((d) => ({ ...d, evidenceId: d.evidenceId || evidence[0]?.id || '' }));
                  setShowMeasurement(true);
                }}
                disabled={evidence.length === 0}
              >
                <IconPlus size={13} />
                Measurement
              </button>
            </div>
          }
        >
          {active.length === 0 ? (
            <EmptyState
              title="No measurements recorded"
              description="Record the evidence first (how the number was obtained), then attach measurements to it. Provenance is the point."
              action={
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowEvidence(true)}>
                  Add evidence
                </button>
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Measurement</th>
                    <th className="num">Value</th>
                    <th className="num">Tolerance</th>
                    <th>Grade</th>
                    <th>Evidence</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {active.map((measurement) => {
                    const source = evidenceById.get(measurement.evidenceId);
                    return (
                      <tr key={measurement.id}>
                        <td>
                          <span className="cell-strong">{measurement.label}</span>
                          <span className="cell-sub">{measurement.kind.replace(/_/g, ' ')}</span>
                        </td>
                        <td className="num">{formatMm(measurement.valueMm)}</td>
                        <td className="num">{measurement.toleranceMm === null ? <span className="faint">—</span> : `±${measurement.toleranceMm} mm`}</td>
                        <td>
                          <Badge tone={measurement.grade === 'ORDER_GRADE' ? 'ok' : 'neutral'}>
                            {measurement.grade === 'ORDER_GRADE' ? 'Order' : 'Estimate'}
                          </Badge>
                        </td>
                        <td className="small">
                          {source ? (
                            <>
                              {SOURCE_KINDS.find((k) => k.value === source.sourceKind)?.label ?? source.sourceKind}
                              {source.isVerified || <Badge tone="warn">Unverified</Badge>}
                            </>
                          ) : (
                            <span className="faint">Missing</span>
                          )}
                        </td>
                        <td className="actions">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => actions.deactivateMeasurement(measurement.id)}
                          >
                            Supersede
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Evidence records" subtitle="What supports each number, and how good it actually is" tight>
          {evidence.length === 0 ? (
            <EmptyState title="No evidence attached" description="A measurement without evidence cannot exceed estimate grade." />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Note</th>
                    <th className="num">Claimed accuracy</th>
                    <th>Basis</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {evidence.map((record) => (
                    <tr key={record.id}>
                      <td className="cell-strong">{SOURCE_KINDS.find((k) => k.value === record.sourceKind)?.label ?? record.sourceKind}</td>
                      <td className="small muted" style={{ maxWidth: 280 }}>
                        {record.note}
                      </td>
                      <td className="num">
                        {record.accuracyClaimMm === null ? <span className="faint">Not stated</span> : `±${record.accuracyClaimMm} mm`}
                      </td>
                      <td className="small faint">{record.accuracyBasis.replace(/_/g, ' ')}</td>
                      <td>
                        {record.isVerified ? <Badge tone="ok">Verified</Badge> : <Badge tone="warn">Unverified</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {superseded.length > 0 && (
          <Card title="Superseded measurements" subtitle="Retained for history" tight>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Measurement</th>
                    <th className="num">Value</th>
                    <th>Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {superseded.map((measurement) => (
                    <tr key={measurement.id} style={{ opacity: 0.62 }}>
                      <td>{measurement.label}</td>
                      <td className="num">{formatMm(measurement.valueMm)}</td>
                      <td>
                        <Badge tone="neutral">Superseded</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      <div className="grid" style={{ gap: 16 }}>
        <Card title="Grade readiness" subtitle="Why order grade is or is not available">
          <div className="grid" style={{ gap: 8 }}>
            <Row ok={evidence.length > 0} label="Evidence recorded" />
            <Row ok={active.some((m) => m.kind === 'control_dimension')} label="Control dimension identified" />
            <Row ok={computation.verifiedControlDimensions > 0} label="Verified order-grade control dimension" />
            <Row ok={active.every((m) => m.toleranceMm !== null) && active.length > 0} label="Tolerance declared on every measurement" />
            <Row ok={job.operatorApproved} label="Operator approval recorded" />
            <Row ok={computation.orderBlockers.length === 0} label="All order-grade conditions met" />
          </div>
          <hr className="divider" />
          <div className="small faint" style={{ lineHeight: 1.55 }}>
            Confidence and accuracy are separate values. A source that claims ±20 mm is not the same as one verified to
            ±2 mm, and neither is the same as an operator&apos;s confidence in the number.
          </div>
        </Card>

        <Notice tone="info" icon={<IconAlert />}>
          AI-assisted and photographic sources can never carry order grade, regardless of how the numbers were produced.
          This is a product rule, not a setting.
        </Notice>
      </div>

      <Modal
        open={showEvidence}
        title="Add evidence"
        subtitle="Where did this measurement come from?"
        onClose={() => setShowEvidence(false)}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setShowEvidence(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={saveEvidence}>
              Save evidence
            </button>
          </>
        }
      >
        <div className="grid" style={{ gap: 14 }}>
          <Field label="Source">
            <SelectInput
              value={evidenceDraft.sourceKind}
              onChange={(e) => setEvidenceDraft({ ...evidenceDraft, sourceKind: e.target.value as EvidenceKind })}
            >
              {SOURCE_KINDS.map((kind) => (
                <option key={kind.value} value={kind.value}>
                  {kind.label}
                  {kind.orderCapable ? '' : ' — estimate grade only'}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Description" error={error || undefined}>
            <TextArea
              value={evidenceDraft.note}
              onChange={(e) => setEvidenceDraft({ ...evidenceDraft, note: e.target.value })}
              placeholder="e.g. Tape measure, existing roof, measured 14 Nov by owner"
            />
          </Field>
          <div className="form-row">
            <Field label="Claimed accuracy" hint="A claim, not a verified figure.">
              <UnitInput
                unit="±mm"
                value={evidenceDraft.accuracyClaimMm}
                onChange={(e) => setEvidenceDraft({ ...evidenceDraft, accuracyClaimMm: e.target.value })}
              />
            </Field>
            <Field label="Basis for the claim">
              <SelectInput
                value={evidenceDraft.accuracyBasis}
                onChange={(e) => setEvidenceDraft({ ...evidenceDraft, accuracyBasis: e.target.value as typeof evidenceDraft.accuracyBasis })}
              >
                <option value="unknown">Unknown</option>
                <option value="operator_estimate">Operator estimate</option>
                <option value="manufacturer_spec">Manufacturer specification</option>
                <option value="verified_by_test">Verified by test</option>
              </SelectInput>
            </Field>
          </div>
          <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={evidenceDraft.isVerified}
              onChange={(e) => setEvidenceDraft({ ...evidenceDraft, isVerified: e.target.checked })}
              style={{ width: 15, height: 15, marginTop: 2 }}
            />
            <span className="small">This evidence has been checked against the site or source document.</span>
          </label>
        </div>
      </Modal>

      <Modal
        open={showMeasurement}
        title="Add measurement"
        subtitle="Recorded in millimetres, attached to an evidence record."
        onClose={() => setShowMeasurement(false)}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setShowMeasurement(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={saveMeasurement}>
              Save measurement
            </button>
          </>
        }
      >
        <div className="grid" style={{ gap: 14 }}>
          <Field label="Evidence">
            <SelectInput
              value={measurementDraft.evidenceId}
              onChange={(e) => setMeasurementDraft({ ...measurementDraft, evidenceId: e.target.value })}
            >
              <option value="">Select evidence…</option>
              {evidence.map((record) => (
                <option key={record.id} value={record.id}>
                  {SOURCE_KINDS.find((k) => k.value === record.sourceKind)?.label} — {record.note.slice(0, 40)}
                </option>
              ))}
            </SelectInput>
          </Field>
          <div className="form-row">
            <Field label="Label" error={error || undefined}>
              <TextInput
                value={measurementDraft.label}
                onChange={(e) => setMeasurementDraft({ ...measurementDraft, label: e.target.value })}
                placeholder="e.g. Ridge to eave — north"
              />
            </Field>
            <Field label="Type">
              <SelectInput
                value={measurementDraft.kind}
                onChange={(e) => setMeasurementDraft({ ...measurementDraft, kind: e.target.value as typeof measurementDraft.kind })}
              >
                {MEASUREMENT_KINDS.map((kind) => (
                  <option key={kind.value} value={kind.value}>
                    {kind.label}
                  </option>
                ))}
              </SelectInput>
            </Field>
          </div>
          <div className="form-row">
            <Field label="Value">
              <UnitInput unit="mm" value={measurementDraft.valueMm} onChange={(e) => setMeasurementDraft({ ...measurementDraft, valueMm: e.target.value })} />
            </Field>
            <Field label="Tolerance" hint="Required for order grade.">
              <UnitInput
                unit="±mm"
                value={measurementDraft.toleranceMm}
                onChange={(e) => setMeasurementDraft({ ...measurementDraft, toleranceMm: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Grade">
            <SelectInput
              value={measurementDraft.grade}
              onChange={(e) => setMeasurementDraft({ ...measurementDraft, grade: e.target.value as typeof measurementDraft.grade })}
            >
              <option value="ESTIMATE_GRADE">Estimate grade</option>
              <option value="ORDER_GRADE" disabled={!orderGradeAllowed}>
                Order grade{orderGradeAllowed ? '' : ' — requirements not met'}
              </option>
            </SelectInput>
          </Field>
          {selectedEvidence && !selectedEvidence.isVerified && (
            <div className="notice notice-warn">
              <IconAlert />
              <div>This evidence is unverified, so the measurement can only be estimate grade.</div>
            </div>
          )}
          {selectedEvidence?.sourceKind === 'ai_assisted' && (
            <div className="notice notice-warn">
              <IconAlert />
              <div>AI-assisted evidence never qualifies as order grade.</div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

function Row({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="small" style={{ display: 'flex', gap: 8, alignItems: 'center', color: ok ? 'var(--ok-500)' : 'var(--text-faint)' }}>
      {ok ? <IconCheck size={13} /> : <span style={{ width: 6, height: 6, borderRadius: 999, background: 'currentColor' }} />}
      {label}
    </div>
  );
}
