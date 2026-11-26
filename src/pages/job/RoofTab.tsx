import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/data/store';
import { roofExtent } from '@/domain/geometry';
import { degToMicro, formatAreaM2, formatMm, microToDeg } from '@/domain/units';
import type { FlashingKind } from '@/domain/types';
import { labelForFlashing } from '@/domain/material';
import { Badge, Card, Field, Notice, SelectInput, TextInput, UnitInput } from '@/ui';
import { IconAlert, IconCheck, IconPlus, IconRuler } from '@/ui/icons';
import type { JobTabProps } from './types';

type Transform = { scale: number; offsetX: number; offsetY: number };

const SNAP_MM = 100;
const MIN_EXTENT_MM = 9000;

export function RoofTab({ job, planes, flashings, computation }: JobTabProps) {
  const { actions } = useStore();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ width: 800, height: 420 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [manual, setManual] = useState({ width: '6000', length: '3600', pitch: '22.5' });
  const [flashingDraft, setFlashingDraft] = useState<{ kind: FlashingKind; length: string }>({ kind: 'ridge', length: '6000' });

  const extent = useMemo(() => {
    const raw = roofExtent(planes);
    return {
      widthMm: Math.max(raw.widthMm, MIN_EXTENT_MM),
      heightMm: Math.max(raw.heightMm, MIN_EXTENT_MM * 0.55),
    };
  }, [planes]);

  const transform: Transform = useMemo(() => {
    const padding = 54;
    const scale = Math.min((size.width - padding * 2) / extent.widthMm, (size.height - padding * 2) / extent.heightMm);
    return {
      scale,
      offsetX: padding + (size.width - padding * 2 - extent.widthMm * scale) / 2,
      offsetY: padding + (size.height - padding * 2 - extent.heightMm * scale) / 2,
    };
  }, [size, extent]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0) setSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);

    const toPx = (mm: number) => mm * transform.scale;

    // 1 m grid
    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.lineWidth = 1;
    for (let mm = 0; mm <= extent.widthMm + 1000; mm += 1000) {
      const x = transform.offsetX + toPx(mm);
      ctx.beginPath();
      ctx.moveTo(x, transform.offsetY);
      ctx.lineTo(x, transform.offsetY + toPx(extent.heightMm));
      ctx.stroke();
    }
    for (let mm = 0; mm <= extent.heightMm + 1000; mm += 1000) {
      const y = transform.offsetY + toPx(mm);
      ctx.beginPath();
      ctx.moveTo(transform.offsetX, y);
      ctx.lineTo(transform.offsetX + toPx(extent.widthMm), y);
      ctx.stroke();
    }

    for (const plane of planes) {
      const x = transform.offsetX + toPx(plane.xMm);
      const y = transform.offsetY + toPx(plane.yMm);
      const w = toPx(plane.widthMm);
      const h = toPx(plane.lengthMm);
      const isSelected = plane.id === selectedId;

      const gradient = ctx.createLinearGradient(x, y, x + w, y + h);
      gradient.addColorStop(0, isSelected ? 'rgba(53,208,228,0.30)' : 'rgba(88,120,150,0.26)');
      gradient.addColorStop(1, isSelected ? 'rgba(53,208,228,0.12)' : 'rgba(50,74,96,0.20)');
      ctx.fillStyle = gradient;
      ctx.fillRect(x, y, w, h);

      ctx.strokeStyle = isSelected ? '#55dcee' : 'rgba(198,209,220,0.55)';
      ctx.lineWidth = isSelected ? 2 : 1.2;
      ctx.strokeRect(x, y, w, h);

      ctx.fillStyle = isSelected ? '#d9fbff' : '#cfdae4';
      ctx.font = '600 12px Inter, system-ui, sans-serif';
      ctx.fillText(plane.ref, x + 8, y + 17);
      ctx.fillStyle = 'rgba(190,205,218,0.72)';
      ctx.font = '11px Inter, system-ui, sans-serif';
      if (h > 26) ctx.fillText(`${microToDeg(plane.pitchMicrodeg).toFixed(1)}°`, x + 8, y + 32);
    }

    if (draft) {
      const x = transform.offsetX + toPx(Math.min(draft.x1, draft.x2));
      const y = transform.offsetY + toPx(Math.min(draft.y1, draft.y2));
      const w = toPx(Math.abs(draft.x2 - draft.x1));
      const h = toPx(Math.abs(draft.y2 - draft.y1));
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = '#35d0e4';
      ctx.lineWidth = 1.6;
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(53,208,228,0.10)';
      ctx.fillRect(x, y, w, h);
    }
  }, [planes, selectedId, draft, size, transform, extent]);

  const toMm = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const snap = (value: number) => Math.max(0, Math.round(value / SNAP_MM) * SNAP_MM);
    return {
      x: snap((px - transform.offsetX) / transform.scale),
      y: snap((py - transform.offsetY) / transform.scale),
    };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = toMm(event.clientX, event.clientY);
    dragStart.current = point;
    setDraft({ x1: point.x, y1: point.y, x2: point.x, y2: point.y });
    (event.target as HTMLCanvasElement).setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragStart.current) return;
    const point = toMm(event.clientX, event.clientY);
    setDraft({ x1: dragStart.current.x, y1: dragStart.current.y, x2: point.x, y2: point.y });
  };

  const onPointerUp = () => {
    if (draft) {
      const widthMm = Math.abs(draft.x2 - draft.x1);
      const lengthMm = Math.abs(draft.y2 - draft.y1);
      if (widthMm >= 500 && lengthMm >= 500) {
        actions.addPlane(job.id, {
          ref: `P${planes.length + 1}`,
          xMm: Math.min(draft.x1, draft.x2),
          yMm: Math.min(draft.y1, draft.y2),
          widthMm,
          lengthMm,
          pitchMicrodeg: degToMicro(Number(manual.pitch) || 22.5),
        });
      }
    }
    dragStart.current = null;
    setDraft(null);
  };

  const addManual = () => {
    const widthMm = Number(manual.width);
    const lengthMm = Number(manual.length);
    if (!Number.isFinite(widthMm) || !Number.isFinite(lengthMm) || widthMm < 500 || lengthMm < 500) return;
    const raw = roofExtent(planes);
    actions.addPlane(job.id, {
      ref: `P${planes.length + 1}`,
      xMm: raw.widthMm === 0 ? 0 : raw.widthMm + 300,
      yMm: 0,
      widthMm: Math.round(widthMm),
      lengthMm: Math.round(lengthMm),
      pitchMicrodeg: degToMicro(Number(manual.pitch) || 22.5),
    });
  };

  const selected = planes.find((p) => p.id === selectedId) ?? null;
  const blocking = computation.issues.filter((i) => i.severity === 'blocking');
  const warnings = computation.issues.filter((i) => i.severity !== 'blocking');

  return (
    <div className="grid grid-sidebar">
      <div className="grid" style={{ gap: 16 }}>
        <Card
          title="Roof plan"
          subtitle="Drag on the grid to draw a plane. Dimensions snap to 100 mm."
          tight
          action={
            <div className="toolbar">
              <Badge tone={planes.length > 0 ? 'cyan' : 'neutral'}>{planes.length} planes</Badge>
              <button type="button" className="btn btn-secondary btn-sm" onClick={addManual}>
                <IconPlus size={13} />
                Enter dimensions
              </button>
            </div>
          }
        >
          <div ref={containerRef} style={{ height: 430 }}>
            <canvas
              ref={canvasRef}
              className="roof-canvas"
              style={{ width: '100%', height: '100%' }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
          </div>
          <div className="card-foot">
            <span className="small faint">
              {planes.length === 0 ? 'Nothing captured yet.' : `${formatAreaM2(computation.areaMm2)} across ${planes.length} planes`}
            </span>
            <span className="small faint">1 m grid · local metric frame</span>
          </div>
        </Card>

        <Card title="Planes" subtitle="Select a plane to edit its dimensions or pitch" tight>
          {planes.length === 0 ? (
            <div className="empty">
              <strong>No roof captured</strong>
              <p>Drag on the plan to draw the first plane, or enter dimensions directly.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Ref</th>
                    <th className="num">Width</th>
                    <th className="num">Slope length</th>
                    <th className="num">Pitch</th>
                    <th className="num">Area</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {planes.map((plane) => (
                    <tr
                      key={plane.id}
                      className="row-clickable"
                      onClick={() => setSelectedId(plane.id)}
                      style={selectedId === plane.id ? { background: 'rgba(53,208,228,0.06)' } : undefined}
                    >
                      <td className="cell-strong">{plane.ref}</td>
                      <td className="num">{plane.widthMm} mm</td>
                      <td className="num">{plane.lengthMm} mm</td>
                      <td className="num">{microToDeg(plane.pitchMicrodeg).toFixed(1)}°</td>
                      <td className="num">{formatAreaM2(plane.widthMm * plane.lengthMm)}</td>
                      <td className="actions">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={(event) => {
                            event.stopPropagation();
                            actions.deletePlane(plane.id);
                            if (selectedId === plane.id) setSelectedId(null);
                          }}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card
          title="Flashing runs"
          subtitle="Measured on site. Eave length is derived from the planes."
          tight
          action={
            <div className="toolbar">
              <SelectInput
                value={flashingDraft.kind}
                onChange={(e) => setFlashingDraft({ ...flashingDraft, kind: e.target.value as FlashingKind })}
                style={{ maxWidth: 150 }}
                aria-label="Flashing type"
              >
                {(['ridge', 'hip', 'valley', 'barge', 'apron', 'box_gutter', 'eave'] as FlashingKind[]).map((kind) => (
                  <option key={kind} value={kind}>
                    {labelForFlashing(kind)}
                  </option>
                ))}
              </SelectInput>
              <input
                className="input"
                style={{ maxWidth: 110 }}
                value={flashingDraft.length}
                onChange={(e) => setFlashingDraft({ ...flashingDraft, length: e.target.value })}
                aria-label="Flashing length in millimetres"
                placeholder="mm"
              />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  const lengthMm = Number(flashingDraft.length);
                  if (Number.isFinite(lengthMm) && lengthMm > 0) {
                    actions.upsertFlashing(job.id, flashingDraft.kind, Math.round(lengthMm));
                  }
                }}
              >
                Set
              </button>
            </div>
          }
        >
          {flashings.length === 0 ? (
            <div className="empty">
              <strong>No flashing measured</strong>
              <p>Ridge, hip, valley, barge and apron runs are measured on site; they cannot be inferred reliably.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th className="num">Length</th>
                    <th>Source</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {flashings.map((flashing) => (
                    <tr key={flashing.id}>
                      <td className="cell-strong">{labelForFlashing(flashing.kind)}</td>
                      <td className="num">{formatMm(flashing.lengthMm)}</td>
                      <td>
                        <Badge tone={flashing.source === 'DERIVED' ? 'info' : 'neutral'}>
                          {flashing.source === 'DERIVED' ? 'Derived' : 'Measured'}
                        </Badge>
                      </td>
                      <td className="actions">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => actions.deleteFlashing(flashing.id)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="grid" style={{ gap: 16 }}>
        <Card title="Selected plane">
          {selected ? (
            <div className="grid" style={{ gap: 12 }}>
              <Field label="Reference">
                <TextInput value={selected.ref} onChange={(e) => actions.updatePlane(selected.id, { ref: e.target.value })} />
              </Field>
              <div className="form-row">
                <Field label="Width across slope">
                  <UnitInput
                    unit="mm"
                    value={selected.widthMm}
                    onChange={(e) => actions.updatePlane(selected.id, { widthMm: Math.max(0, Number(e.target.value) || 0) })}
                  />
                </Field>
                <Field label="Slope length">
                  <UnitInput
                    unit="mm"
                    value={selected.lengthMm}
                    onChange={(e) => actions.updatePlane(selected.id, { lengthMm: Math.max(0, Number(e.target.value) || 0) })}
                  />
                </Field>
              </div>
              <Field label="Pitch" hint="Drives the minimum-pitch check against the product.">
                <UnitInput
                  unit="deg"
                  value={microToDeg(selected.pitchMicrodeg)}
                  onChange={(e) =>
                    actions.updatePlane(selected.id, { pitchMicrodeg: degToMicro(Math.min(90, Math.max(0, Number(e.target.value) || 0))) })
                  }
                />
              </Field>
              <div className="small faint">
                Area {formatAreaM2(selected.widthMm * selected.lengthMm)} · measured along the slope.
              </div>
            </div>
          ) : (
            <div className="small muted">Select a plane in the plan or the table to edit it.</div>
          )}
        </Card>

        <Card title="Checks" subtitle="Blocking checks must be cleared before approval">
          {blocking.length === 0 && warnings.length === 0 ? (
            <div className="notice notice-ok">
              <IconCheck />
              <div>No issues found.</div>
            </div>
          ) : (
            <div className="grid" style={{ gap: 8 }}>
              {blocking.map((issue, index) => (
                <div key={`b-${index}`} className="notice notice-danger">
                  <IconAlert />
                  <div>
                    <strong>{issue.ruleId}</strong> · {issue.message}
                  </div>
                </div>
              ))}
              {warnings.map((issue, index) => (
                <div key={`w-${index}`} className="notice notice-warn">
                  <IconAlert />
                  <div>
                    <strong>{issue.ruleId}</strong> · {issue.message}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="New plane" subtitle="Precise entry alternative to drawing">
          <div className="grid" style={{ gap: 12 }}>
            <div className="form-row">
              <Field label="Width">
                <UnitInput unit="mm" value={manual.width} onChange={(e) => setManual({ ...manual, width: e.target.value })} />
              </Field>
              <Field label="Slope length">
                <UnitInput unit="mm" value={manual.length} onChange={(e) => setManual({ ...manual, length: e.target.value })} />
              </Field>
            </div>
            <Field label="Pitch">
              <UnitInput unit="deg" value={manual.pitch} onChange={(e) => setManual({ ...manual, pitch: e.target.value })} />
            </Field>
            <button type="button" className="btn btn-secondary" onClick={addManual}>
              <IconRuler size={14} />
              Add plane
            </button>
          </div>
        </Card>

        {!computation.layout.ok && (
          <Notice tone="warn" icon={<IconAlert />}>
            Sheet layout is unavailable: {computation.layout.reason}
          </Notice>
        )}
      </div>
    </div>
  );
}
