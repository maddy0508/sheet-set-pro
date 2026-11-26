import { useState } from 'react';
import { useStore } from '@/data/store';
import type { CatalogueProfile } from '@/data/types';
import { formatCents } from '@/domain/units';
import { Badge, Card, Field, Modal, Notice, PageHead, SelectInput, TextArea, TextInput, UnitInput } from '@/ui';
import { IconAlert, IconPlus } from '@/ui/icons';

function numOrNull(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const blank: CatalogueProfile = {
  id: '',
  manufacturer: '',
  name: '',
  material: '',
  thicknessMm: null,
  coating: '',
  effectiveCoverMm: null,
  minPitchDeg: null,
  maxLengthMm: null,
  lapLongitudinalMm: null,
  lapTransverseMm: null,
  sheetPriceCentsPerM: null,
  fixingPerSheet: null,
  flashingGirthMm: null,
  verificationState: 'PLACEHOLDER',
  priceBasis: 'ENTERED',
  sourceNote: '',
  revision: '1',
  effectiveFrom: new Date().toISOString().slice(0, 10),
};

export function CataloguePage() {
  const { state, actions } = useStore();
  const [editing, setEditing] = useState<CatalogueProfile | null>(null);
  const [confirmVerify, setConfirmVerify] = useState(false);

  const startNew = () => {
    setEditing({ ...blank, id: `cat-${Date.now()}` });
    setConfirmVerify(false);
  };

  const save = () => {
    if (!editing) return;
    if (!editing.name.trim() || !editing.manufacturer.trim()) return;
    const next = { ...editing };
    if (confirmVerify) {
      next.verificationState = 'VERIFIED';
    }
    actions.saveProfile(next);
    setEditing(null);
    setConfirmVerify(false);
  };

  const missingFields = (profile: CatalogueProfile) =>
    [
      profile.effectiveCoverMm === null ? 'effective cover width' : null,
      profile.minPitchDeg === null ? 'minimum pitch' : null,
      profile.maxLengthMm === null ? 'maximum sheet length' : null,
      profile.lapTransverseMm === null ? 'transverse lap' : null,
      profile.lapLongitudinalMm === null ? 'longitudinal lap' : null,
      profile.fixingPerSheet === null ? 'fixing rule' : null,
      profile.sheetPriceCentsPerM === null ? 'sheet price' : null,
      !profile.sourceNote.trim() ? 'source note' : null,
    ].filter(Boolean) as string[];

  return (
    <>
      <PageHead
        eyebrow="Setup"
        title="Product catalogue"
        description="Product specifications drive every quantity the system produces. Values must come from the manufacturer or a recorded owner statement — the application never supplies them."
        actions={
          <button type="button" className="btn btn-primary" onClick={startNew}>
            <IconPlus size={14} />
            New product
          </button>
        }
      />

      <div style={{ marginBottom: 16 }}>
        <Notice tone="warn" icon={<IconAlert />}>
          <strong>No manufacturer data is bundled with this build.</strong> The two entries below are clearly marked
          synthetic development records. Order-grade output, supplier export and manufacturing release stay locked
          until a real specification is entered and verified by the business.
        </Notice>
      </div>

      <div className="grid" style={{ gap: 14 }}>
        {state.catalogue.map((profile) => {
          const missing = missingFields(profile);
          return (
            <Card
              key={profile.id}
              title={
                <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  {profile.name}
                  {profile.verificationState === 'VERIFIED' ? (
                    <Badge tone="ok">Verified</Badge>
                  ) : profile.verificationState === 'PARTIAL' ? (
                    <Badge tone="warn">Partial</Badge>
                  ) : (
                    <Badge tone="neutral">Placeholder</Badge>
                  )}
                  {profile.priceBasis === 'SYNTHETIC' && <Badge tone="warn">Synthetic data</Badge>}
                </span>
              }
              subtitle={`${profile.manufacturer} · revision ${profile.revision} · effective ${profile.effectiveFrom}`}
              action={
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setEditing(profile);
                    setConfirmVerify(false);
                  }}
                >
                  Edit
                </button>
              }
            >
              <div className="grid grid-4" style={{ gap: 14 }}>
                <div>
                  <div className="stat-label">Effective cover</div>
                  <div className="nums" style={{ fontSize: 16, marginTop: 4 }}>
                    {profile.effectiveCoverMm === null ? <span className="faint">Not set</span> : `${profile.effectiveCoverMm} mm`}
                  </div>
                </div>
                <div>
                  <div className="stat-label">Minimum pitch</div>
                  <div className="nums" style={{ fontSize: 16, marginTop: 4 }}>
                    {profile.minPitchDeg === null ? <span className="faint">Not set</span> : `${profile.minPitchDeg}°`}
                  </div>
                </div>
                <div>
                  <div className="stat-label">Max sheet length</div>
                  <div className="nums" style={{ fontSize: 16, marginTop: 4 }}>
                    {profile.maxLengthMm === null ? <span className="faint">Not set</span> : `${profile.maxLengthMm} mm`}
                  </div>
                </div>
                <div>
                  <div className="stat-label">Sheet rate</div>
                  <div className="nums" style={{ fontSize: 16, marginTop: 4 }}>
                    {profile.sheetPriceCentsPerM === null ? (
                      <span className="faint">Not set</span>
                    ) : (
                      `${formatCents(profile.sheetPriceCentsPerM)}/m`
                    )}
                  </div>
                </div>
              </div>
              <hr className="divider" />
              <div className="small muted" style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                <span>Material: {profile.material || '—'}</span>
                <span>Thickness: {profile.thicknessMm === null ? '—' : `${profile.thicknessMm} mm`}</span>
                <span>Coating: {profile.coating || '—'}</span>
                <span>Fixings: {profile.fixingPerSheet === null ? '—' : `${profile.fixingPerSheet} per sheet`}</span>
              </div>
              {missing.length > 0 && (
                <div className="notice notice-warn" style={{ marginTop: 12 }}>
                  <IconAlert />
                  <div>
                    Order-grade unavailable. Missing: {missing.join(', ')}.
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <Modal
        open={editing !== null}
        title={editing?.verificationState === 'VERIFIED' ? 'Edit product' : 'Product specification'}
        subtitle="Enter values exactly as supplied. Leave a field empty rather than guessing."
        onClose={() => setEditing(null)}
        wide
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={save}>
              Save product
            </button>
          </>
        }
      >
        {editing && (
          <div className="grid" style={{ gap: 14 }}>
            <div className="form-row">
              <Field label="Manufacturer">
                <TextInput
                  value={editing.manufacturer}
                  onChange={(e) => setEditing({ ...editing, manufacturer: e.target.value })}
                  placeholder="Exactly as it appears on the source document"
                />
              </Field>
              <Field label="Product / profile name">
                <TextInput value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </Field>
            </div>
            <div className="form-row three">
              <Field label="Material">
                <TextInput value={editing.material} onChange={(e) => setEditing({ ...editing, material: e.target.value })} />
              </Field>
              <Field label="Thickness">
                <UnitInput
                  unit="mm"
                  value={editing.thicknessMm ?? ''}
                  onChange={(e) => setEditing({ ...editing, thicknessMm: numOrNull(e.target.value) })}
                />
              </Field>
              <Field label="Coating">
                <TextInput value={editing.coating} onChange={(e) => setEditing({ ...editing, coating: e.target.value })} />
              </Field>
            </div>
            <div className="form-row three">
              <Field label="Effective cover width">
                <UnitInput
                  unit="mm"
                  value={editing.effectiveCoverMm ?? ''}
                  onChange={(e) => setEditing({ ...editing, effectiveCoverMm: numOrNull(e.target.value) })}
                />
              </Field>
              <Field label="Minimum pitch">
                <UnitInput
                  unit="deg"
                  value={editing.minPitchDeg ?? ''}
                  onChange={(e) => setEditing({ ...editing, minPitchDeg: numOrNull(e.target.value) })}
                />
              </Field>
              <Field label="Maximum sheet length">
                <UnitInput
                  unit="mm"
                  value={editing.maxLengthMm ?? ''}
                  onChange={(e) => setEditing({ ...editing, maxLengthMm: numOrNull(e.target.value) })}
                />
              </Field>
            </div>
            <div className="form-row three">
              <Field label="Longitudinal lap">
                <UnitInput
                  unit="mm"
                  value={editing.lapLongitudinalMm ?? ''}
                  onChange={(e) => setEditing({ ...editing, lapLongitudinalMm: numOrNull(e.target.value) })}
                />
              </Field>
              <Field label="Transverse lap">
                <UnitInput
                  unit="mm"
                  value={editing.lapTransverseMm ?? ''}
                  onChange={(e) => setEditing({ ...editing, lapTransverseMm: numOrNull(e.target.value) })}
                />
              </Field>
              <Field label="Fixings per sheet">
                <UnitInput
                  unit="ea"
                  value={editing.fixingPerSheet ?? ''}
                  onChange={(e) => setEditing({ ...editing, fixingPerSheet: numOrNull(e.target.value) })}
                />
              </Field>
            </div>
            <div className="form-row three">
              <Field label="Sheet rate" hint="Cents per lineal metre.">
                <UnitInput
                  unit="c/m"
                  value={editing.sheetPriceCentsPerM ?? ''}
                  onChange={(e) => setEditing({ ...editing, sheetPriceCentsPerM: numOrNull(e.target.value) })}
                />
              </Field>
              <Field label="Flashing girth">
                <UnitInput
                  unit="mm"
                  value={editing.flashingGirthMm ?? ''}
                  onChange={(e) => setEditing({ ...editing, flashingGirthMm: numOrNull(e.target.value) })}
                />
              </Field>
              <Field label="Revision">
                <TextInput value={editing.revision} onChange={(e) => setEditing({ ...editing, revision: e.target.value })} />
              </Field>
            </div>
            <Field label="Source" hint="Document reference, or the owner statement this data came from.">
              <TextArea
                value={editing.sourceNote}
                onChange={(e) => setEditing({ ...editing, sourceNote: e.target.value })}
                placeholder="e.g. Manufacturer technical manual rev 4, received 12 Nov 2026"
              />
            </Field>
            <Field label="Price basis">
              <SelectInput
                value={editing.priceBasis}
                onChange={(e) => setEditing({ ...editing, priceBasis: e.target.value as CatalogueProfile['priceBasis'] })}
              >
                <option value="ENTERED">Entered by the business</option>
                <option value="SYNTHETIC">Synthetic development pricing</option>
              </SelectInput>
            </Field>

            <div className="notice notice-warn">
              <IconAlert />
              <div>
                <strong>Verification is a business statement.</strong> Marking a product verified asserts that every value
                came from the manufacturer or a recorded owner statement. Order-grade output becomes possible only after
                that.
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 9, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={confirmVerify}
                    onChange={(e) => setConfirmVerify(e.target.checked)}
                    style={{ width: 15, height: 15 }}
                  />
                  I confirm these values are sourced, not estimated.
                </label>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
