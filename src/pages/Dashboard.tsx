import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '@/data/store';
import { computeJob } from '@/lib/jobCalc';
import { formatAreaM2, formatCents } from '@/domain/units';
import { Card, EmptyState, JobStatusBadge, PageHead, Stat, Badge, Notice } from '@/ui';
import { IconAlert, IconArrowRight, IconPlus, IconSpark } from '@/ui/icons';

export function Dashboard() {
  const { state, actions } = useStore();
  const navigate = useNavigate();

  const activeJobs = state.jobs.filter((j) => j.status !== 'paid' && j.status !== 'lost');
  const pipelineCents = state.quotes
    .filter((q) => q.status === 'issued' || q.status === 'accepted')
    .filter((q) => {
      const job = state.jobs.find((j) => j.id === q.jobId);
      return job && job.status !== 'paid' && job.status !== 'lost';
    })
    .reduce((sum, q) => sum + q.totals.totalCents, 0);

  const invoicedCents = state.invoices.filter((i) => i.status === 'issued').reduce((s, i) => s + i.totals.totalCents, 0);
  const unpaidCents =
    invoicedCents -
    state.allocations
      .filter((a) => state.invoices.some((i) => i.id === a.invoiceId && i.status === 'issued'))
      .reduce((s, a) => s + a.amountCents, 0);

  const totalArea = state.jobs.reduce((sum, job) => {
    const planes = state.planes.filter((p) => p.jobId === job.id);
    return sum + computeJob({
      job,
      planes,
      flashings: state.flashings.filter((f) => f.jobId === job.id),
      measurements: state.measurements.filter((m) => m.jobId === job.id),
      profile: state.catalogue.find((p) => p.id === job.profileId) ?? null,
    }).areaMm2;
  }, 0);

  const attention = activeJobs
    .map((job) => {
      const computation = computeJob({
        job,
        planes: state.planes.filter((p) => p.jobId === job.id),
        flashings: state.flashings.filter((f) => f.jobId === job.id),
        measurements: state.measurements.filter((m) => m.jobId === job.id),
        profile: state.catalogue.find((p) => p.id === job.profileId) ?? null,
      });
      return { job, blocking: computation.blockingCount, unknowns: computation.bom.warnings.length + computation.orderBlockers.length };
    })
    .filter((row) => row.blocking > 0 || row.unknowns > 0);

  const recentJobs = [...state.jobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6);
  const catalogueVerified = state.catalogue.some((p) => p.verificationState === 'VERIFIED');
  const gstUnconfirmed = state.company.gstRegistered === null || !state.company.gstRateConfirmed;

  return (
    <>
      <PageHead
        eyebrow="Operations"
        title="Dashboard"
        description="The operational picture for Mitchell's Metal Roofing: what is in progress, what is quoted, and what is waiting on you."
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={actions.loadSampleJob}>
              <IconSpark size={14} />
              Add sample job
            </button>
            <button type="button" className="btn btn-primary" onClick={() => navigate('/jobs?new=1')}>
              <IconPlus size={14} />
              New job
            </button>
          </>
        }
      />

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat accent label="Active jobs" value={activeJobs.length} hint={`${state.jobs.length} total on record`} />
        <Stat label="Quoted pipeline" value={formatCents(pipelineCents)} hint="Issued quotes not yet closed" />
        <Stat label="Unpaid invoices" value={formatCents(unpaidCents)} hint={`${state.invoices.filter((i) => i.status === 'issued').length} issued`} />
        <Stat label="Roof measured" value={formatAreaM2(totalArea)} hint="Across all captured planes" />
      </div>

      {(gstUnconfirmed || !catalogueVerified) && (
        <div className="grid grid-2" style={{ marginBottom: 16 }}>
          {gstUnconfirmed && (
            <Notice tone="warn" icon={<IconAlert />}>
              <strong>GST details are not confirmed.</strong> Invoices can be drafted, but the tax treatment and
              &ldquo;tax invoice&rdquo; wording stay disabled until the business settings are completed.
              <Link to="/settings" style={{ marginLeft: 6 }}>Open settings</Link>
            </Notice>
          )}
          {!catalogueVerified && (
            <Notice tone="info" icon={<IconAlert />}>
              <strong>No verified product specification.</strong> Quantities are computed from synthetic development
              data, so order-grade output and supplier export remain locked.
              <Link to="/catalogue" style={{ marginLeft: 6 }}>Open catalogue</Link>
            </Notice>
          )}
        </div>
      )}

      <div className="grid grid-sidebar">
        <div className="grid" style={{ gap: 16 }}>
          <Card
            title="Recent jobs"
            subtitle="Most recently updated first"
            tight
            action={
              <Link to="/jobs" className="btn btn-ghost btn-sm">
                All jobs <IconArrowRight size={13} />
              </Link>
            }
          >
            {recentJobs.length === 0 ? (
              <EmptyState
                title="No jobs yet"
                description="Create a job to begin measuring a roof, or load a synthetic sample to explore the workflow."
                action={
                  <button type="button" className="btn btn-secondary btn-sm" onClick={actions.loadSampleJob}>
                    Load sample job
                  </button>
                }
              />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Job</th>
                      <th>Customer</th>
                      <th>Planes</th>
                      <th>Area</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {recentJobs.map((job) => {
                      const customer = state.customers.find((c) => c.id === job.customerId);
                      const planes = state.planes.filter((p) => p.jobId === job.id);
                      const area = computeJob({
                        job,
                        planes,
                        flashings: state.flashings.filter((f) => f.jobId === job.id),
                        measurements: state.measurements.filter((m) => m.jobId === job.id),
                        profile: state.catalogue.find((p) => p.id === job.profileId) ?? null,
                      }).areaMm2;
                      return (
                        <tr key={job.id} className="row-clickable" onClick={() => navigate(`/jobs/${job.id}`)}>
                          <td>
                            <span className="cell-strong">{job.title}</span>
                            <span className="cell-sub">
                              {job.jobNumber} {job.sourceType !== 'REAL' && `· ${job.sourceType}`}
                            </span>
                          </td>
                          <td>{customer?.name ?? '—'}</td>
                          <td className="num">{planes.length}</td>
                          <td className="num">{area > 0 ? formatAreaM2(area) : '—'}</td>
                          <td>
                            <JobStatusBadge status={job.status} />
                          </td>
                          <td className="actions">
                            <IconArrowRight size={14} className="faint" />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Needs attention" subtitle="Jobs with blocking conditions or unresolved unknowns">
            {attention.length === 0 ? (
              <div className="small muted" style={{ padding: '4px 0 2px' }}>
                Nothing is blocking. Jobs that develop blocking geometry or missing specifications appear here.
              </div>
            ) : (
              <div className="grid" style={{ gap: 9 }}>
                {attention.slice(0, 6).map(({ job, blocking, unknowns }) => (
                  <div
                    key={job.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
                    onClick={() => navigate(`/jobs/${job.id}`)}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="cell-strong" style={{ fontSize: 13 }}>{job.title}</div>
                      <div className="cell-sub">
                        {blocking > 0 ? `${blocking} blocking check${blocking === 1 ? '' : 's'}` : 'No blocking checks'}
                        {unknowns > 0 ? ` · ${unknowns} unresolved item${unknowns === 1 ? '' : 's'}` : ''}
                      </div>
                    </div>
                    {blocking > 0 ? <Badge tone="danger">Blocked</Badge> : <Badge tone="warn">Review</Badge>}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="grid" style={{ gap: 16 }}>
          <Card title="Activity" subtitle="Most recent 8 events">
            {state.activity.length === 0 ? (
              <div className="small muted">No activity yet.</div>
            ) : (
              <ul className="timeline">
                {state.activity.slice(0, 8).map((event) => (
                  <li key={event.id}>
                    <div className="when">
                      {new Date(event.at).toLocaleString('en-AU', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                    <div className="what">{event.detail}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Workspace" subtitle="Data and provenance status">
            <dl className="kv">
              <dt>Records</dt>
              <dd>
                {state.jobs.length} job{state.jobs.length === 1 ? '' : 's'} · {state.customers.length} customer
                {state.customers.length === 1 ? '' : 's'}
              </dd>
              <dt>Real data</dt>
              <dd>{state.jobs.filter((j) => j.sourceType === 'REAL').length} jobs</dd>
              <dt>Synthetic</dt>
              <dd>{state.jobs.filter((j) => j.sourceType !== 'REAL').length} jobs</dd>
              <dt>Storage</dt>
              <dd className="small">This browser only</dd>
            </dl>
            <hr className="divider" />
            <div className="small faint" style={{ lineHeight: 1.55 }}>
              Development workspace: records are kept in this browser, not in a shared database. Nothing here is
              presented as verified manufacturer data.
            </div>
          </Card>
        </div>
      </div>

      {state.customers.length === 0 && (
        <div style={{ marginTop: 16 }}>
          <Notice tone="neutral" icon={<IconAlert />}>
            Start with a <Link to="/customers">customer</Link>, then create a job. Sample records are tagged{' '}
            <Badge tone="warn">Synthetic</Badge> and are never counted as real business data.
          </Notice>
        </div>
      )}
    </>
  );
}
