import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useStore } from '@/data/store';
import type { JobStatus } from '@/data/types';
import { formatAreaM2 } from '@/domain/units';
import { computeJob } from '@/lib/jobCalc';
import { Card, EmptyState, Field, JobStatusBadge, Modal, PageHead, SelectInput, SourceBadge, TextArea, TextInput, Badge } from '@/ui';
import { IconPlus } from '@/ui/icons';

const STATUSES: { value: JobStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'measured', label: 'Measured' },
  { value: 'geometry_validated', label: 'Validated' },
  { value: 'calculated', label: 'Calculated' },
  { value: 'quoted', label: 'Quoted' },
  { value: 'won', label: 'Won' },
  { value: 'invoiced', label: 'Invoiced' },
  { value: 'paid', label: 'Paid' },
  { value: 'lost', label: 'Lost' },
];

export function Jobs() {
  const { state, actions } = useStore();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<JobStatus | 'all'>('all');
  const [customerFilter, setCustomerFilter] = useState(params.get('customer') ?? 'all');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({
    customerId: '',
    title: '',
    siteAddress: '',
    notes: '',
    profileId: '',
    sourceType: 'REAL' as 'REAL' | 'SYNTHETIC' | 'TEST',
    crsEpsg: '7855',
  });
  const [error, setError] = useState('');

  useEffect(() => {
    if (params.get('new') === '1') {
      setCreating(true);
      const next = new URLSearchParams(params);
      next.delete('new');
      setParams(next, { replace: true });
    }
  }, [params, setParams]);

  useEffect(() => {
    if (creating && !draft.customerId && state.customers.length > 0) {
      setDraft((d) => ({ ...d, customerId: d.customerId || state.customers[0].id, profileId: d.profileId || state.catalogue[0]?.id || '' }));
    }
  }, [creating, draft.customerId, state.customers, state.catalogue]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return state.jobs
      .filter((job) => (status === 'all' ? true : job.status === status))
      .filter((job) => (customerFilter === 'all' ? true : job.customerId === customerFilter))
      .filter((job) => {
        if (!term) return true;
        const customer = state.customers.find((c) => c.id === job.customerId);
        return [job.title, job.jobNumber, job.siteAddress, customer?.name ?? ''].some((value) =>
          value.toLowerCase().includes(term),
        );
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [state.jobs, state.customers, status, customerFilter, query]);

  const createJob = () => {
    if (!draft.title.trim()) return setError('A job title is required.');
    if (!draft.customerId) return setError('Select a customer.');
    const job = actions.saveJob({
      customerId: draft.customerId,
      title: draft.title,
      siteAddress: draft.siteAddress,
      notes: draft.notes,
      profileId: draft.profileId || null,
      sourceType: draft.sourceType,
      crsEpsg: draft.crsEpsg ? Number(draft.crsEpsg) : null,
      status: 'draft',
    });
    setCreating(false);
    setError('');
    setDraft({ customerId: '', title: '', siteAddress: '', notes: '', profileId: '', sourceType: 'REAL', crsEpsg: '7855' });
    navigate(`/jobs/${job.id}`);
  };

  return (
    <>
      <PageHead
        eyebrow="Operations"
        title="Jobs"
        description="Each job is one site and one scope of work: measurement, geometry, materials and the commercial trail all attach here."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <IconPlus size={14} />
            New job
          </button>
        }
      />

      <Card
        tight
        title={`${filtered.length} ${filtered.length === 1 ? 'job' : 'jobs'}`}
        action={
          <div className="toolbar">
            <input
              className="input"
              placeholder="Search jobs…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ maxWidth: 200 }}
              aria-label="Search jobs"
            />
            <SelectInput
              value={customerFilter}
              onChange={(e) => setCustomerFilter(e.target.value)}
              aria-label="Filter by customer"
              style={{ maxWidth: 180 }}
            >
              <option value="all">All customers</option>
              {state.customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </SelectInput>
            <SelectInput
              value={status}
              onChange={(e) => setStatus(e.target.value as JobStatus | 'all')}
              aria-label="Filter by status"
              style={{ maxWidth: 160 }}
            >
              {STATUSES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectInput>
          </div>
        }
      >
        {filtered.length === 0 ? (
          <EmptyState
            title={state.jobs.length === 0 ? 'No jobs yet' : 'No jobs match'}
            description={
              state.jobs.length === 0
                ? 'Create a job to capture measurements, lay out sheets and produce a quote.'
                : 'Clear the filters to see all jobs.'
            }
            action={
              state.jobs.length === 0 ? (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCreating(true)}>
                  Create the first job
                </button>
              ) : undefined
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
                  <th>Sheets</th>
                  <th>Status</th>
                  <th>Type</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((job) => {
                  const customer = state.customers.find((c) => c.id === job.customerId);
                  const planes = state.planes.filter((p) => p.jobId === job.id);
                  const computation = computeJob({
                    job,
                    planes,
                    flashings: state.flashings.filter((f) => f.jobId === job.id),
                    measurements: state.measurements.filter((m) => m.jobId === job.id),
                    profile: state.catalogue.find((p) => p.id === job.profileId) ?? null,
                  });
                  return (
                    <tr key={job.id} className="row-clickable" onClick={() => navigate(`/jobs/${job.id}`)}>
                      <td>
                        <span className="cell-strong">{job.title}</span>
                        <span className="cell-sub">{job.jobNumber}</span>
                      </td>
                      <td>{customer?.name ?? <span className="faint">Deleted customer</span>}</td>
                      <td className="num">{planes.length}</td>
                      <td className="num">{computation.areaMm2 > 0 ? formatAreaM2(computation.areaMm2) : '—'}</td>
                      <td className="num">
                        {computation.layout.ok ? computation.layout.totalSheets : <span className="faint">—</span>}
                      </td>
                      <td>
                        <JobStatusBadge status={job.status} />
                      </td>
                      <td>{job.sourceType === 'REAL' ? <span className="faint small">Real</span> : <SourceBadge source={job.sourceType} />}</td>
                      <td className="small faint">
                        {new Date(job.updatedAt).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={creating}
        title="New job"
        subtitle="A job holds one roof, its measurement evidence and its commercial trail."
        onClose={() => setCreating(false)}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={createJob} disabled={state.customers.length === 0}>
              Create job
            </button>
          </>
        }
      >
        {state.customers.length === 0 ? (
          <div className="grid" style={{ gap: 12 }}>
            <p className="muted">A job must belong to a customer. Add a customer first.</p>
            <button type="button" className="btn btn-secondary" onClick={() => navigate('/customers')}>
              Go to customers
            </button>
          </div>
        ) : (
          <div className="grid" style={{ gap: 14 }}>
            <Field label="Customer">
              <SelectInput value={draft.customerId} onChange={(e) => setDraft({ ...draft, customerId: e.target.value })}>
                {state.customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Job title" error={error || undefined}>
              <TextInput
                autoFocus
                value={draft.title}
                invalid={Boolean(error)}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="e.g. 42 Oceanview Crescent — re-roof"
              />
            </Field>
            <Field label="Site address">
              <TextInput value={draft.siteAddress} onChange={(e) => setDraft({ ...draft, siteAddress: e.target.value })} />
            </Field>
            <div className="form-row">
              <Field label="Product" hint="Synthetic specifications are labelled in the catalogue.">
                <SelectInput value={draft.profileId} onChange={(e) => setDraft({ ...draft, profileId: e.target.value })}>
                  {state.catalogue.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <Field label="Coordinate system" hint="GDA2020 / MGA zone 55 suits Bendigo.">
                <SelectInput value={draft.crsEpsg} onChange={(e) => setDraft({ ...draft, crsEpsg: e.target.value })}>
                  <option value="7855">EPSG:7855 — MGA zone 55</option>
                  <option value="7854">EPSG:7854 — MGA zone 54</option>
                  <option value="7856">EPSG:7856 — MGA zone 56</option>
                  <option value="">Not set</option>
                </SelectInput>
              </Field>
            </div>
            <Field label="Record type" hint="Synthetic and test jobs are excluded from real reporting.">
              <SelectInput
                value={draft.sourceType}
                onChange={(e) => setDraft({ ...draft, sourceType: e.target.value as typeof draft.sourceType })}
              >
                <option value="REAL">Real</option>
                <option value="TEST">Test</option>
                <option value="SYNTHETIC">Synthetic</option>
              </SelectInput>
            </Field>
            <Field label="Notes">
              <TextArea value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
            </Field>
            {draft.sourceType !== 'REAL' && (
              <div className="small faint">
                Tagged <Badge tone="warn">{draft.sourceType}</Badge> — never counted as operational validation.
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
