import { useMemo } from 'react';
import { useStore } from '@/data/store';
import { formatAreaM2, formatMm, fingerprint } from '@/domain/units';
import { Badge, Card, Notice, Stat } from '@/ui';
import { IconAlert, IconCheck } from '@/ui/icons';
import type { JobTabProps } from './types';

export function LayoutTab({ job, computation, profile }: JobTabProps) {
  const { state, actions } = useStore();
  const snapshots = useMemo(() => state.snapshots.filter((s) => s.jobId === job.id), [state.snapshots, job.id]);

  const record = () => {
    if (!computation.layout.ok) return;
    actions.recordSnapshot({
      jobId: job.id,
      inputFingerprint: fingerprint({
        planes: job.id,
        planeCount: computation.layout.planes.length,
        profile: profile?.id ?? null,
        revision: profile?.revision ?? null,
      }),
      outputFingerprint: fingerprint(computation.layout.planes),
      engineVersion: 'engine-0.1.0',
      totalSheets: computation.layout.totalSheets,
      totalSheetLengthMm: computation.layout.totalSheetLengthMm,
      areaMm2: computation.areaMm2,
      blockingIssues: computation.blockingCount,
      executedIn: 'client',
      isAuthoritative: false,
    });
  };

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="grid grid-4">
        <Stat label="Total sheets" value={computation.layout.ok ? computation.layout.totalSheets : '—'} hint="Across all planes" />
        <Stat label="Total cut length" value={computation.layout.ok ? formatMm(computation.layout.totalSheetLengthMm) : '—'} hint="Includes laps and allowances" />
        <Stat label="Effective cover" value={profile?.effectiveCoverMm ? `${profile.effectiveCoverMm} mm` : '—'} hint="Never the nominal width" />
        <Stat label="Max sheet length" value={profile?.maxLengthMm ? `${profile.maxLengthMm} mm` : '—'} hint="Drives splitting" />
      </div>

      {!computation.layout.ok ? (
        <Notice tone="danger" icon={<IconAlert />}>
          <strong>Layout cannot be computed.</strong> {computation.layout.reason} The calculation fails explicitly rather
          than substituting a default, because a guessed cover width produces a roof that is short.
        </Notice>
      ) : (
        <Card title="Sheet layout by plane" subtitle="Courses use effective cover width; segments respect maximum sheet length">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Plane</th>
                  <th className="num">Courses</th>
                  <th className="num">Segments</th>
                  <th>Cut lengths</th>
                  <th className="num">Sheets</th>
                  <th className="num">Coverage</th>
                  <th className="num">Overhang</th>
                </tr>
              </thead>
              <tbody>
                {computation.layout.planes.map((plane) => (
                  <tr key={plane.ref}>
                    <td className="cell-strong">{plane.ref}</td>
                    <td className="num">{plane.courses}</td>
                    <td className="num">{plane.segmentsPerCourse}</td>
                    <td className="mono">{plane.segments.map((segment) => `${segment.lengthMm}`).join(' + ')} mm</td>
                    <td className="num">{plane.sheetCount}</td>
                    <td className="num">{formatMm(plane.coveredWidthMm)}</td>
                    <td className="num">{plane.overhangMm} mm</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card-foot" style={{ margin: '14px -18px -18px' }}>
            <span className="small faint">
              60 mm eave and 40 mm top allowances included · transverse lap{' '}
              {profile?.lapTransverseMm ?? 0} mm
            </span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={record}>
              Record calculation
            </button>
          </div>
        </Card>
      )}

      <div className="grid grid-2">
        <Card title="Calculation snapshots" subtitle="Every run is recorded; nothing overwrites history">
          {snapshots.length === 0 ? (
            <div className="small muted">No snapshot recorded for this job yet.</div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>When</th>
                    <th className="num">Sheets</th>
                    <th>Authority</th>
                    <th className="mono">Fingerprint</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.slice(0, 6).map((snapshot) => (
                    <tr key={snapshot.id}>
                      <td className="small">
                        {new Date(snapshot.createdAt).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="num">{snapshot.totalSheets}</td>
                      <td>
                        <Badge tone={snapshot.isAuthoritative ? 'ok' : 'neutral'}>
                          {snapshot.isAuthoritative ? 'Server' : 'Draft'}
                        </Badge>
                      </td>
                      <td className="mono">{snapshot.outputFingerprint.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Rounding and rules" subtitle="How the numbers are produced">
          <dl className="kv">
            <dt>Units</dt>
            <dd>Integer millimetres</dd>
            <dt>Cover</dt>
            <dd>Effective cover width only</dd>
            <dt>Splitting</dt>
            <dd>Max length less transverse lap</dd>
            <dt>Waste</dt>
            <dd>Reported separately from lap</dd>
            <dt>Slope factor</dt>
            <dd>Not used — lengths are measured along the slope</dd>
          </dl>
          <hr className="divider" />
          {computation.layout.ok ? (
            <div className="notice notice-ok">
              <IconCheck />
              <div>Layout is internally consistent and reproducible from the recorded inputs.</div>
            </div>
          ) : (
            <div className="notice notice-warn">
              <IconAlert />
              <div>Layout is blocked by a missing rule.</div>
            </div>
          )}
        </Card>
      </div>

      {computation.bom.incomplete && (
        <Notice tone="warn" icon={<IconAlert />}>
          The bill of materials is incomplete because a rule or price is missing. Quantities that could not be derived
          have been left out rather than estimated.
        </Notice>
      )}

      <div className="small faint">
        Area check: {formatAreaM2(computation.areaMm2)} measured on the roof surface.
      </div>
    </div>
  );
}
