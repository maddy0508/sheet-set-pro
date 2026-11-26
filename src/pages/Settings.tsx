import { useState } from 'react';
import { useStore } from '@/data/store';
import { formatCents } from '@/domain/units';
import { Badge, Card, Field, Notice, PageHead, SelectInput, TextInput, UnitInput } from '@/ui';
import { IconAlert } from '@/ui/icons';

export function SettingsPage() {
  const { state, actions, sync } = useStore();
  const company = state.company;
  const [draft, setDraft] = useState({
    displayName: company.displayName,
    legalName: company.legalName ?? '',
    abn: company.abn ?? '',
    address: company.address ?? '',
    email: company.email ?? '',
    phone: company.phone ?? '',
    gstRegistered: company.gstRegistered === null ? 'unknown' : company.gstRegistered ? 'yes' : 'no',
    gstRateBp: String(company.gstRateBp),
    gstRateConfirmed: company.gstRateConfirmed,
    labourRate: String(company.labourRateCentsPerM2),
    defaultMarginBp: String(company.defaultMarginBp),
  });

  const save = () => {
    actions.updateCompany({
      displayName: draft.displayName.trim() || company.displayName,
      legalName: draft.legalName.trim() || null,
      abn: draft.abn.trim() || null,
      address: draft.address.trim() || null,
      email: draft.email.trim() || null,
      phone: draft.phone.trim() || null,
      gstRegistered: draft.gstRegistered === 'unknown' ? null : draft.gstRegistered === 'yes',
      gstRateBp: Number(draft.gstRateBp) || 0,
      gstRateConfirmed: draft.gstRateConfirmed,
      labourRateCentsPerM2: Number(draft.labourRate) || 0,
      defaultMarginBp: Number(draft.defaultMarginBp) || 0,
    });
  };

  const unconfirmed = [
    company.legalName === null ? 'legal name' : null,
    company.abn === null ? 'ABN' : null,
    company.gstRegistered === null ? 'GST registration' : null,
    !company.gstRateConfirmed ? 'GST rate' : null,
    company.address === null ? 'business address' : null,
  ].filter(Boolean) as string[];

  return (
    <>
      <PageHead
        eyebrow="Setup"
        title="Settings"
        description="Business identity and commercial defaults. Anything the business has not confirmed stays visibly unconfirmed everywhere it appears."
      />

      {unconfirmed.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Notice tone="warn" icon={<IconAlert />}>
            <strong>Unconfirmed business details: {unconfirmed.join(', ')}.</strong> These are placeholders, not facts.
            Tax documents will not use &ldquo;tax invoice&rdquo; wording until GST registration and the rate are confirmed.
          </Notice>
        </div>
      )}

      <div className="grid grid-sidebar">
        <div className="grid" style={{ gap: 16 }}>
          <Card
            title="Business identity"
            subtitle="Entered by the owner. The application never infers these values."
            action={
              <button type="button" className="btn btn-primary btn-sm" onClick={save}>
                Save changes
              </button>
            }
          >
            <div className="grid" style={{ gap: 14 }}>
              <div className="form-row">
                <Field label="Trading name">
                  <TextInput value={draft.displayName} onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} />
                </Field>
                <Field label="Legal name" hint={company.legalName === null ? 'Not confirmed' : undefined}>
                  <TextInput
                    value={draft.legalName}
                    onChange={(e) => setDraft({ ...draft, legalName: e.target.value })}
                    placeholder="Not confirmed"
                  />
                </Field>
              </div>
              <div className="form-row">
                <Field label="ABN" hint={company.abn === null ? 'Not confirmed' : undefined}>
                  <TextInput value={draft.abn} onChange={(e) => setDraft({ ...draft, abn: e.target.value })} placeholder="Not confirmed" />
                </Field>
                <Field label="Business address">
                  <TextInput
                    value={draft.address}
                    onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                    placeholder="Not confirmed"
                  />
                </Field>
              </div>
              <div className="form-row">
                <Field label="Email">
                  <TextInput value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
                </Field>
                <Field label="Phone">
                  <TextInput value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
                </Field>
              </div>
            </div>
          </Card>

          <Card title="Tax" subtitle="GST treatment is a business fact, not a default.">
            <div className="grid" style={{ gap: 14 }}>
              <div className="form-row">
                <Field label="GST registration">
                  <SelectInput
                    value={draft.gstRegistered}
                    onChange={(e) => setDraft({ ...draft, gstRegistered: e.target.value })}
                  >
                    <option value="unknown">Not confirmed</option>
                    <option value="yes">Registered for GST</option>
                    <option value="no">Not registered for GST</option>
                  </SelectInput>
                </Field>
                <Field label="GST rate" hint="Basis points: 1000 = 10.00%">
                  <UnitInput unit="bp" value={draft.gstRateBp} onChange={(e) => setDraft({ ...draft, gstRateBp: e.target.value })} />
                </Field>
              </div>
              <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={draft.gstRateConfirmed}
                  onChange={(e) => setDraft({ ...draft, gstRateConfirmed: e.target.checked })}
                  style={{ width: 15, height: 15, marginTop: 2 }}
                />
                <span className="small">
                  I confirm the GST rate is correct for this business.
                  <span className="faint"> Until ticked, documents show &ldquo;GST rate not confirmed&rdquo;.</span>
                </span>
              </label>
              <div className="small faint">
                Invoices store the GST setting that applied when they were issued, so a later change never rewrites history.
                BAS preparation and ATO lodgement are out of scope.
              </div>
            </div>
          </Card>

          <Card title="Commercial defaults" subtitle="Used to seed estimates. Every revision records what it used.">
            <div className="form-row">
              <Field label="Labour rate" hint="Cents per square metre.">
                <UnitInput unit="c/m²" value={draft.labourRate} onChange={(e) => setDraft({ ...draft, labourRate: e.target.value })} />
              </Field>
              <Field label="Default margin" hint="Basis points: 2500 = 25%">
                <UnitInput
                  unit="bp"
                  value={draft.defaultMarginBp}
                  onChange={(e) => setDraft({ ...draft, defaultMarginBp: e.target.value })}
                />
              </Field>
            </div>
            <div className="small faint" style={{ marginTop: 10 }}>
              Current labour rate: {formatCents(company.labourRateCentsPerM2)}/m² · margin{' '}
              {(company.defaultMarginBp / 100).toFixed(2)}%
            </div>
          </Card>
        </div>

        <div className="grid" style={{ gap: 16 }}>
          <Card title="Storage" subtitle="Where this workspace lives">
            <div className="small muted" style={{ lineHeight: 1.6 }}>
              {sync.mode === 'remote'
                ? 'Records are stored in this workspace’s Supabase Postgres database and reachable from any signed-in device. Access is limited to workspace members by row level security; anonymous requests are refused.'
                : 'This build keeps records in this browser only. It is a development workspace, not a shared database: data is not visible to another device and is not backed up.'}
            </div>
            <hr className="divider" />
            <dl className="kv">
              <dt>Records</dt>
              <dd>
                {state.jobs.length} job{state.jobs.length === 1 ? '' : 's'} · {state.customers.length} customer
                {state.customers.length === 1 ? '' : 's'}
              </dd>
              <dt>Snapshots</dt>
              <dd>{state.snapshots.length} calculations</dd>
              <dt>Activity</dt>
              <dd>{state.activity.length} events</dd>
            </dl>
          </Card>

          <Card title="Data provenance">
            <div className="grid" style={{ gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="small muted">Synthetic products</span>
                <Badge tone="warn">{state.catalogue.filter((p) => p.priceBasis === 'SYNTHETIC').length}</Badge>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="small muted">Verified products</span>
                <Badge tone={state.catalogue.some((p) => p.verificationState === 'VERIFIED') ? 'ok' : 'neutral'}>
                  {state.catalogue.filter((p) => p.verificationState === 'VERIFIED').length}
                </Badge>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="small muted">Synthetic jobs</span>
                <Badge tone="warn">{state.jobs.filter((j) => j.sourceType !== 'REAL').length}</Badge>
              </div>
            </div>
          </Card>

          <Card title="Reset workspace" subtitle="Irreversible">
            <div className="small muted" style={{ marginBottom: 12, lineHeight: 1.6 }}>
              Clears every record in this browser and restores the starting state. Use it before handing the device to
              someone else, or to clear demonstration data.
            </div>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => {
                if (confirm('Reset the workspace? All records in this browser will be removed.')) {
                  actions.resetWorkspace();
                }
              }}
            >
              Reset all data
            </button>
          </Card>
        </div>
      </div>
    </>
  );
}
