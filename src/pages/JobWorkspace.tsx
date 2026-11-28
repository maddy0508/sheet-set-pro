import { lazy, Suspense, useMemo } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useStore } from '@/data/store';
import { computeJob } from '@/lib/jobCalc';
import { jobCosting } from '@/lib/costing';
import { formatAreaM2, formatCents, formatMm } from '@/domain/units';
import { Badge, Card, Field, JobStatusBadge, Notice, SelectInput, SourceBadge, Stat, Tabs, TextArea } from '@/ui';
import { IconAlert, IconArrowLeft, IconCheck } from '@/ui/icons';
import type { JobStatus } from '@/data/types';
import { MeasureTab } from './job/MeasureTab';
import { RoofTab } from './job/RoofTab';
import { AerialTab } from './job/AerialTab';
import { LayoutTab } from './job/LayoutTab';
import { MaterialsTab } from './job/MaterialsTab';
import { OrderTab } from './job/OrderTab';
import { CommercialTab } from './job/CommercialTab';
import { BillingTab } from './job/BillingTab';

const ModelTab = lazy(() => import('./job/ModelTab').then((module) => ({ default: module.ModelTab })));

type TabId =
  | 'overview'
  | 'measure'
  | 'roof'
  | 'aerial'
  | 'model'
  | 'layout'
  | 'materials'
  | 'order'
  | 'commercial'
  | 'billing'
  | 'activity';

const TAB_IDS: TabId[] = [
  'overview',
  'measure',
  'roof',
  'aerial',
  'model',
  'layout',
  'materials',
  'order',
  'commercial',
  'billing',
  'activity',
];

export function JobWorkspace() {
  const { jobId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { state, actions } = useStore();

  const job = state.jobs.find((j) => j.id === jobId) ?? null;
  const planes = useMemo(() => state.planes.filter((p) => p.jobId === jobId), [state.planes, jobId]);
  const flashings = useMemo(() => state.flashings.filter((f) => f.jobId === jobId), [state.flashings, jobId]);
  const evidence = useMemo(() => state.evidence.filter((e) => e.jobId === jobId), [state.evidence, jobId]);
  const measurements = useMemo(() => state.measurements.filter((m) => m.jobId === jobId), [state.measurements, jobId]);
  const profile = state.catalogue.find((p) => p.id === job?.profileId) ?? null;

  const computation = useMemo(
    () => (job ? computeJob({ job, planes, flashings, measurements, profile }) : null),
    [job, planes, flashings, measurements, profile],
  );

  const rawTab = params.get('tab') as TabId | null;
  const activeTab: TabId = rawTab && TAB_IDS.includes(rawTab) ? rawTab : 'overview';

  if (!job || !computation) {
    return (
      <div className="empty">
        <strong>Job not found</strong>
        <p>It may have been removed from this workspace.</p>
        <Link to="/jobs" className="btn btn-secondary btn-sm">
          Back to jobs
        </Link>
      </div>
    );
  }

  const customer = state.customers.find((c) => c.id === job.customerId);
  const quotes = state.quotes.filter((q) => q.jobId === job.id);
  const invoices = state.invoices.filter((i) => i.jobId === job.id);
  const estimates = state.estimates.filter((e) => e.jobId === job.id);
  const payments = state.payments.filter((p) => p.jobId === job.id);
  const jobActivity = state.activity.filter((event) => event.subjectId === job.id || (event.subjectType === 'job' && event.subjectId === job.id));

  const costing = jobCosting({
    areaMm2: computation.areaMm2,
    bomLines: computation.bom.lines,
    invoices,
    allocations: state.allocations,
    company: state.company,
  });

  const tabProps = { job, planes, flashings, evidence, measurements, profile, computation, costing };

  const nextStep = (() => {
    if (planes.length === 0) return { label: 'Capture the roof', tab: 'roof' as TabId, detail: 'Draw or enter the roof planes to begin.' };
    if (computation.blockingCount > 0) return { label: 'Resolve validation', tab: 'roof' as TabId, detail: `${computation.blockingCount} blocking check${computation.blockingCount === 1 ? '' : 's'} must be cleared.` };
    if (!computation.layout.ok) return { label: 'Complete the product rules', tab: 'layout' as TabId, detail: computation.layout.reason };
    if (estimates.length === 0) return { label: 'Build an estimate', tab: 'commercial' as TabId, detail: 'Turn the bill of materials into a priced revision.' };
    if (quotes.length === 0) return { label: 'Issue a quote', tab: 'commercial' as TabId, detail: 'Send the priced revision to the customer.' };
    if (invoices.length === 0) return { label: 'Raise an invoice', tab: 'billing' as TabId, detail: 'Invoice the accepted quote.' };
    return { label: 'Review the commercial position', tab: 'billing' as TabId, detail: 'Check outstanding balances and allocations.' };
  })();

  const setTab = (tab: TabId) => {
    const next = new URLSearchParams(params);
    next.set('tab', tab);
    setParams(next, { replace: true });
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/jobs')}>
          <IconArrowLeft size={13} />
          Jobs
        </button>
        <span className="faint small">/</span>
        <span className="small faint">{job.jobNumber}</span>
      </div>

      <div className="page-head" style={{ marginBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1>{job.title}</h1>
            <JobStatusBadge status={job.status} />
            {job.sourceType !== 'REAL' && <SourceBadge source={job.sourceType} />}
          </div>
          <p>
            {customer?.name ?? 'Customer removed'}
            {job.siteAddress ? ` · ${job.siteAddress}` : ''}
            {profile ? ` · ${profile.name}` : ' · No product selected'}
          </p>
        </div>
        <div className="toolbar">
          <SelectInput
            value={job.status}
            onChange={(e) => actions.updateJob(job.id, { status: e.target.value as JobStatus })}
            aria-label="Job status"
            style={{ maxWidth: 170 }}
          >
            {(['draft', 'measured', 'geometry_validated', 'calculated', 'quoted', 'won', 'invoiced', 'paid', 'lost'] as JobStatus[]).map((status) => (
              <option key={status} value={status}>
                {status.replace(/_/g, ' ')}
              </option>
            ))}
          </SelectInput>
        </div>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Roof area" value={computation.areaMm2 > 0 ? formatAreaM2(computation.areaMm2) : '—'} hint={`${planes.length} plane${planes.length === 1 ? '' : 's'}`} />
        <Stat
          label="Sheets"
          value={computation.layout.ok ? computation.layout.totalSheets : '—'}
          hint={computation.layout.ok ? `${formatMm(computation.layout.totalSheetLengthMm)} total cut` : 'Rules incomplete'}
        />
        <Stat
          label="Materials"
          value={
            computation.bom.lines.reduce((sum, line) => sum + Math.round((line.quantityMicro * line.unitPriceCents) / 1_000_000), 0) > 0
              ? formatCents(computation.bom.lines.reduce((sum, line) => sum + Math.round((line.quantityMicro * line.unitPriceCents) / 1_000_000), 0))
              : '—'
          }
          hint={computation.bom.incomplete ? 'Incomplete specification' : 'Costed from current rules'}
        />
        <Stat
          accent
          label="Order grade"
          value={computation.orderBlockers.length === 0 ? 'Ready' : 'Blocked'}
          hint={computation.orderBlockers.length === 0 ? 'All conditions satisfied' : `${computation.orderBlockers.length} condition${computation.orderBlockers.length === 1 ? '' : 's'} outstanding`}
        />
      </div>

      <Card tight>
        <Tabs
          active={activeTab}
          onChange={setTab}
          items={[
            { id: 'overview', label: 'Overview' },
            { id: 'measure', label: 'Measure', count: measurements.filter((m) => m.isActive).length },
            { id: 'roof', label: 'Roof', count: planes.length },
            { id: 'aerial', label: 'Aerial & AI' },
            { id: 'model', label: '3D model', count: planes.length },
            { id: 'layout', label: 'Sheet layout' },
            { id: 'materials', label: 'Materials', count: computation.bom.lines.length },
            {
              id: 'order',
              label: 'Supplier order',
              count: state.supplierExports.filter((entry) => entry.jobId === job.id).length,
            },
            { id: 'commercial', label: 'Estimate & quote', count: quotes.length },
            { id: 'billing', label: 'Invoice & payments', count: invoices.length },
            { id: 'activity', label: 'Activity' },
          ]}
        />
        <div style={{ padding: 18 }}>
          {activeTab === 'overview' && (
            <div className="grid grid-sidebar">
              <div className="grid" style={{ gap: 16 }}>
                <Card title="Next step" subtitle="Where this job needs attention now">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div className="cell-strong" style={{ fontSize: 15 }}>{nextStep.label}</div>
                      <div className="small muted" style={{ marginTop: 2 }}>{nextStep.detail}</div>
                    </div>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => setTab(nextStep.tab)}>
                      Open
                    </button>
                  </div>
                </Card>

                <Card title="Validation" subtitle="Geometry and specification checks">
                  {computation.issues.length === 0 ? (
                    <div className="notice notice-ok">
                      <IconCheck />
                      <div>All geometry and specification checks pass.</div>
                    </div>
                  ) : (
                    <div className="grid" style={{ gap: 8 }}>
                      {computation.issues.slice(0, 8).map((issue, index) => (
                        <div key={`${issue.ruleId}-${index}`} className={issue.severity === 'blocking' ? 'notice notice-danger' : 'notice notice-warn'}>
                          <IconAlert />
                          <div>
                            <strong>{issue.ruleId}</strong> · {issue.message}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                <Card title="Order-grade conditions" subtitle="Every condition must hold before manufacturing output is possible">
                  {computation.orderBlockers.length === 0 ? (
                    <div className="notice notice-ok">
                      <IconCheck />
                      <div>All order-grade conditions are satisfied for this revision.</div>
                    </div>
                  ) : (
                    <div className="grid" style={{ gap: 6 }}>
                      {computation.orderBlockers.map((blocker) => (
                        <div key={blocker} className="small" style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--warn-500)' }}>
                          <span style={{ width: 6, height: 6, borderRadius: 999, background: 'currentColor' }} />
                          {blocker}
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>

              <div className="grid" style={{ gap: 16 }}>
                <Card title="Job details">
                  <dl className="kv">
                    <dt>Customer</dt>
                    <dd>{customer?.name ?? '—'}</dd>
                    <dt>Job number</dt>
                    <dd className="mono">{job.jobNumber}</dd>
                    <dt>Site</dt>
                    <dd>{job.siteAddress || <span className="faint">Not recorded</span>}</dd>
                    <dt>Coordinate system</dt>
                    <dd>{job.crsEpsg ? `EPSG:${job.crsEpsg}` : <span className="faint">Not set</span>}</dd>
                    <dt>Product</dt>
                    <dd>
                      {profile?.name ?? <span className="faint">None</span>}
                      {profile && profile.verificationState !== 'VERIFIED' && (
                        <div style={{ marginTop: 4 }}>
                          <Badge tone="warn">Not verified</Badge>
                        </div>
                      )}
                    </dd>
                    <dt>Evidence</dt>
                    <dd>{evidence.length} record{evidence.length === 1 ? '' : 's'}</dd>
                  </dl>
                </Card>

                <Card title="Operator approval" subtitle="Required before any order-grade release">
                  <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={job.operatorApproved}
                      onChange={(e) => actions.updateJob(job.id, { operatorApproved: e.target.checked })}
                      style={{ width: 15, height: 15, marginTop: 2 }}
                    />
                    <span className="small">
                      I have reviewed this roof revision and accept the measurements.
                      <span className="faint"> Recorded against {new Date().toLocaleDateString('en-AU')}.</span>
                    </span>
                  </label>
                  <hr className="divider" />
                  <Field label="Job notes">
                    <TextArea
                      value={job.notes}
                      onChange={(e) => actions.updateJob(job.id, { notes: e.target.value })}
                      placeholder="Site access, colour selection, customer requests…"
                    />
                  </Field>
                </Card>

                <Card title="Commercial position">
                  <dl className="kv">
                    <dt>Estimates</dt>
                    <dd>{estimates.length}</dd>
                    <dt>Quotes</dt>
                    <dd>
                      {quotes.length > 0 ? formatCents(quotes[0].totals.totalCents) : <span className="faint">None issued</span>}
                    </dd>
                    <dt>Invoiced</dt>
                    <dd>
                      {invoices.length > 0
                        ? formatCents(invoices.filter((i) => i.status === 'issued').reduce((s, i) => s + i.totals.totalCents, 0))
                        : <span className="faint">None</span>}
                    </dd>
                    <dt>Payments</dt>
                    <dd>{payments.length}</dd>
                  </dl>
                </Card>

                <Card title="Job costing" subtitle="Cost against revenue, excluding GST">
                  <dl className="kv">
                    <dt>Material cost</dt>
                    <dd>{formatCents(costing.materialCostCents)}</dd>
                    <dt>Labour cost</dt>
                    <dd>{costing.labourCostCents === null ? <span className="faint">Rate not set</span> : formatCents(costing.labourCostCents)}</dd>
                    <dt>Revenue</dt>
                    <dd>{formatCents(costing.revenueCents)}</dd>
                    <dt>Gross profit</dt>
                    <dd>
                      {costing.profitCents === null ? (
                        <span className="faint">Unknown</span>
                      ) : (
                        <span style={{ fontWeight: 700 }}>
                          {formatCents(costing.profitCents)}
                          {costing.marginBp !== null && <span className="faint small"> · {(costing.marginBp / 100).toFixed(1)}%</span>}
                        </span>
                      )}
                    </dd>
                  </dl>
                  {costing.caveats.length > 0 && (
                    <div className="small faint" style={{ marginTop: 10, lineHeight: 1.5 }}>
                      {costing.caveats.map((caveat) => (
                        <div key={caveat}>· {caveat}</div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>
            </div>
          )}

          {activeTab === 'measure' && <MeasureTab {...tabProps} />}
          {activeTab === 'roof' && <RoofTab {...tabProps} />}
          {activeTab === 'aerial' && <AerialTab job={job} />}
          {activeTab === 'model' && (
            <Suspense fallback={<div className="empty">Loading the 3D model…</div>}>
              <ModelTab {...tabProps} />
            </Suspense>
          )}
          {activeTab === 'layout' && <LayoutTab {...tabProps} />}
          {activeTab === 'materials' && <MaterialsTab {...tabProps} />}
          {activeTab === 'order' && <OrderTab {...tabProps} />}
          {activeTab === 'commercial' && <CommercialTab {...tabProps} />}
          {activeTab === 'billing' && <BillingTab {...tabProps} />}

          {activeTab === 'activity' && (
            <Card title="Activity" subtitle="Append-only record of what happened to this job">
              {jobActivity.length === 0 ? (
                <div className="small muted">No activity recorded yet.</div>
              ) : (
                <ul className="timeline">
                  {jobActivity.map((event) => (
                    <li key={event.id}>
                      <div className="when">
                        {new Date(event.at).toLocaleString('en-AU', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                      <div className="what">{event.detail}</div>
                      <div className="small faint mono">{event.type}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      </Card>

      {job.sourceType !== 'REAL' && (
        <div style={{ marginTop: 14 }}>
          <Notice tone="warn" icon={<IconAlert />}>
            This job is labelled <Badge tone="warn">{job.sourceType}</Badge>. It demonstrates the workflow and is excluded
            from operational validation, which requires real reference jobs reviewed by the owner.
          </Notice>
        </div>
      )}
    </>
  );
}
