import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/data/store';
import {
  AiContractError,
  AiServiceUnavailable,
  analyseRoofImage,
  configuredAiServiceUrl,
  describeHealth,
  probeAiService,
  type AiHealth,
  type AnalysisResult,
  type Candidate,
} from '@/data/aiService';
import {
  assessAerialQuality,
  perimeterMm,
  planAreaMm2,
  transformFromDeclaredGsd,
  type PixelPoint,
} from '@/domain/geo';
import { formatAreaM2, formatMm } from '@/domain/units';
import { Badge, Card, Field, Notice, TextInput } from '@/ui';
import type { Job } from '@/data/types';

type LoadedImage = { file: File; url: string; width: number; height: number };

/**
 * Aerial capture: imagery in, AI proposals out, an operator decision, and an evidence record.
 *
 * Three things this screen refuses to do:
 *  - it never shows a proposal as if it were a measurement;
 *  - it never measures without a stated calibration, so the resolution has to be declared and
 *    a north-up orthophoto confirmed before any number appears;
 *  - it never calls the result order grade: aerial measurement stays estimate grade until an
 *    on-site measurement confirms it, which the existing measurement tab already enforces.
 */
export function AerialTab({ job }: { job: Job }) {
  const { actions } = useStore();
  const serviceUrl = configuredAiServiceUrl();
  const [health, setHealth] = useState<AiHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [gsdMm, setGsdMm] = useState('');
  const [northUp, setNorthUp] = useState(false);
  const [recorded, setRecorded] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const objectUrl = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);

  async function checkService() {
    if (!serviceUrl) return;
    setChecking(true);
    setHealthError(null);
    try {
      setHealth(await probeAiService(serviceUrl));
    } catch (caught) {
      setHealth(null);
      setHealthError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    void checkService();
  }, [serviceUrl]);

  function onPickFile(file: File | null) {
    setResult(null);
    setError(null);
    setSelectedIds([]);
    setRecorded(null);
    if (!file) return;
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    const url = URL.createObjectURL(file);
    objectUrl.current = url;
    const probe = new Image();
    probe.onload = () => setImage({ file, url, width: probe.naturalWidth, height: probe.naturalHeight });
    probe.onerror = () => setError('That file is not an image the browser can read.');
    probe.src = url;
  }

  async function loadFromUrl() {
    const url = imageUrl.trim();
    if (!url) return;
    setError(null);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`the server answered ${response.status}`);
      const blob = await response.blob();
      const name = url.split('/').pop() || 'aerial-image';
      onPickFile(new File([blob], name, { type: blob.type || 'image/jpeg' }));
    } catch (caught) {
      setError(`Could not load that image: ${caught instanceof Error ? caught.message : String(caught)}`);
    }
  }

  async function runAnalysis() {
    if (!image || !serviceUrl) return;
    setBusy(true);
    setError(null);
    setRecorded(null);
    try {
      const analysis = await analyseRoofImage({
        baseUrl: serviceUrl,
        jobId: job.id,
        file: image.file,
        fileName: image.file.name,
        stages: ['detect', 'segment', 'features', 'classify'],
      });
      setResult(analysis);
      setSelectedIds(analysis.candidates.length > 0 ? [analysis.candidates[0].id] : []);
    } catch (caught) {
      setResult(null);
      if (caught instanceof AiServiceUnavailable) {
        setError(`AI analysis is unavailable: ${caught.reason}. Trace the roof by hand in the Roof tab instead.`);
      } else if (caught instanceof AiContractError) {
        setError(`The AI service replied with something unusable: ${caught.message}`);
      } else {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    } finally {
      setBusy(false);
    }
  }

  const selected = useMemo(
    () => (result ? result.candidates.filter((candidate) => selectedIds.includes(candidate.id)) : []),
    [result, selectedIds],
  );

  const gsdValue = Number(gsdMm);
  const calibration = useMemo(() => {
    if (!northUp || !Number.isFinite(gsdValue) || gsdValue <= 0) return null;
    try {
      return transformFromDeclaredGsd(gsdValue);
    } catch {
      return null;
    }
  }, [northUp, gsdValue]);

  const measurements = useMemo(() => {
    if (!calibration) return [];
    return selected
      .filter((candidate) => candidate.outline !== null)
      .map((candidate) => {
        const polygon = (candidate.outline as [number, number][]).map(([x, y]) => ({ x, y }) as PixelPoint);
        return {
          candidate,
          perimeter: perimeterMm(calibration, polygon),
          areaMm2: planAreaMm2(calibration, polygon),
        };
      });
  }, [calibration, selected]);

  const quality = useMemo(() => {
    if (!calibration) return null;
    try {
      return assessAerialQuality({
        transform: calibration,
        residualRm: 0,
        groundSampleMmPerPx: gsdValue,
        rotationDeg: 0,
        controlPointCount: 0,
      });
    } catch {
      return null;
    }
  }, [calibration, gsdValue]);

  function recordEvidence() {
    if (!result || !image || measurements.length === 0 || !quality) return;
    const models = result.provenance.map((model) => `${model.name} ${model.version}`).join(', ') || 'no model recorded';
    const summary = measurements
      .map(
        (item) =>
          `${item.candidate.label} ${item.candidate.id}: ${formatAreaM2(item.areaMm2)} plan area, ${formatMm(item.perimeter)} perimeter`,
      )
      .join('; ');
    const evidence = actions.addEvidence(job.id, {
      sourceKind: 'aerial',
      note: [
        `Aerial image ${image.file.name} (${image.width}×${image.height} px), declared ${gsdValue} mm per pixel,`,
        `north-up orthophoto confirmed by the operator.`,
        `AI proposals from ${models}; outlines reviewed and accepted by the operator. ${summary}.`,
        `Plan area only: pitch is applied per plane in the Roof tab, not here.`,
      ].join(' '),
      accuracyClaimMm: gsdValue,
      accuracyBasis: 'operator_estimate',
      isVerified: false,
    });
    setRecorded(evidence.id);
  }

  const aiReady = health?.status === 'ready';

  return (
    <div className="grid" style={{ gap: 16 }}>
      <Card
        title="Aerial capture"
        subtitle="Load an aerial image, let the local AI propose roofs, choose the right one, then measure it"
        action={<Badge tone={aiReady ? 'ok' : 'warn'}>{aiReady ? 'AI service ready' : 'AI service unavailable'}</Badge>}
      >
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)' }}>
          <div>
            <Field label="Aerial image" hint="A file from a permitted imagery source, or a site photograph for reference">
              <input
                type="file"
                accept="image/*"
                onChange={(event) => onPickFile(event.target.files?.[0] ?? null)}
                data-testid="aerial-file"
              />
            </Field>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <TextInput
                value={imageUrl}
                onChange={(event) => setImageUrl(event.target.value)}
                placeholder="or paste an imagery export URL"
                data-testid="aerial-url"
              />
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadFromUrl()} disabled={!imageUrl.trim()}>
                Load
              </button>
            </div>
            {image && (
              <div style={{ position: 'relative', marginTop: 12, maxWidth: 560 }}>
                <img src={image.url} alt="Aerial imagery" style={{ width: '100%', borderRadius: 8, display: 'block' }} />
                {result && (
                  <svg
                    viewBox={`0 0 ${image.width} ${image.height}`}
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
                  >
                    {result.candidates.map((candidate) => (
                      <CandidateOverlay
                        key={candidate.id}
                        candidate={candidate}
                        selected={selectedIds.includes(candidate.id)}
                        onToggle={() =>
                          setSelectedIds((current) =>
                            current.includes(candidate.id)
                              ? current.filter((id) => id !== candidate.id)
                              : [...current, candidate.id],
                          )
                        }
                      />
                    ))}
                    {result.features
                      .filter((feature) => selectedIds.includes(feature.candidateId))
                      .map((feature) => (
                        <g key={feature.id}>
                          {feature.points.map(([x, y]) => (
                            <circle key={`${feature.id}-${x}-${y}`} cx={x} cy={y} r={5} fill="#f0b429" />
                          ))}
                        </g>
                      ))}
                  </svg>
                )}
              </div>
            )}
          </div>

          <div className="grid" style={{ gap: 12 }}>
            <div>
              <div className="small faint">AI service</div>
              <div className="small" data-testid="ai-status">
                {!serviceUrl
                  ? 'Not configured. Set VITE_AI_SERVICE_URL to the address of the local AI service.'
                  : healthError
                    ? healthError
                    : health
                      ? describeHealth(health)
                      : checking
                        ? 'Checking…'
                        : 'Not checked yet.'}
              </div>
              {serviceUrl && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void checkService()} disabled={checking}>
                  Check again
                </button>
              )}
            </div>

            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void runAnalysis()}
              disabled={!image || !serviceUrl || busy || !aiReady}
            >
              {busy ? 'Analysing…' : 'Detect roofs and outline'}
            </button>

            {error && <Notice tone="danger">{error}</Notice>}
            {result && result.warnings.length > 0 && (
              <Notice tone="warn">
                {result.warnings.map((warning) => (
                  <div key={warning}>· {warning}</div>
                ))}
              </Notice>
            )}

            {result && (
              <div>
                <div className="small faint">Candidates — choose the roof you are quoting</div>
                <ul className="plain" style={{ margin: '6px 0 0', padding: 0, listStyle: 'none' }}>
                  {result.candidates.map((candidate) => (
                    <li key={candidate.id} style={{ marginBottom: 6 }}>
                      <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(candidate.id)}
                          onChange={() =>
                            setSelectedIds((current) =>
                              current.includes(candidate.id)
                                ? current.filter((id) => id !== candidate.id)
                                : [...current, candidate.id],
                            )
                          }
                        />
                        <span>
                          <strong>{candidate.id}</strong> {candidate.label} · {Math.round(candidate.score * 100)}%
                          {candidate.outline === null && <span className="faint"> · no outline</span>}
                          {candidate.uncertain && <span className="faint"> · uncertain</span>}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card
        title="Calibration and measurement"
        subtitle="Plan area and perimeter, from a resolution you state — not from how large the roof looks"
      >
        <div className="grid two" style={{ gap: 16 }}>
          <div>
            <Field label="Image resolution (mm per pixel)" hint="From the imagery provider's published ground sample distance">
              <TextInput
                inputMode="decimal"
                value={gsdMm}
                onChange={(event) => setGsdMm(event.target.value)}
                placeholder="e.g. 150"
                data-testid="aerial-gsd"
              />
            </Field>
            <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 10 }}>
              <input type="checkbox" checked={northUp} onChange={(event) => setNorthUp(event.target.checked)} />
              <span>
                This image is a north-up orthorectified aerial image. (Without this the pixels have no reliable scale and
                no measurement is offered.)
              </span>
            </label>
            {quality && (
              <div className="small faint" style={{ marginTop: 10, lineHeight: 1.5 }}>
                <Badge tone="warn">ESTIMATE GRADE</Badge>
                <div style={{ marginTop: 6 }}>{quality.reasons.join(' · ')}</div>
              </div>
            )}
          </div>

          <div>
            {measurements.length === 0 ? (
              <div className="small faint">
                Select at least one candidate with an outline, and state the image resolution, to see measurements.
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Candidate</th>
                    <th>Plan area</th>
                    <th>Perimeter</th>
                  </tr>
                </thead>
                <tbody>
                  {measurements.map((item) => (
                    <tr key={item.candidate.id}>
                      <td>
                        {item.candidate.id} · {item.candidate.label}
                      </td>
                      <td>{formatAreaM2(item.areaMm2)}</td>
                      <td>{formatMm(item.perimeter)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="small faint" style={{ marginTop: 8 }}>
              Plan area only. Pitch is applied per plane in the Roof tab, so a hip and a gable on the same roof are
              never averaged together.
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ marginTop: 12 }}
              onClick={recordEvidence}
              disabled={measurements.length === 0}
            >
              Record as aerial evidence
            </button>
            {recorded && (
              <div className="small" style={{ marginTop: 8 }} data-testid="aerial-recorded">
                Recorded as unverified aerial evidence. It will not raise the measurement grade: only an on-site
                measurement can do that.
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

function CandidateOverlay({
  candidate,
  selected,
  onToggle,
}: {
  candidate: Candidate;
  selected: boolean;
  onToggle: () => void;
}) {
  const [x, y, width, height] = candidate.box;
  const stroke = selected ? '#35d0e4' : '#8a99a8';
  const points = candidate.outline ? candidate.outline.map(([px, py]) => `${px},${py}`).join(' ') : null;
  return (
    <g onClick={onToggle} style={{ cursor: 'pointer' }}>
      {points ? (
        <polygon
          points={points}
          fill={selected ? 'rgba(53,208,228,0.22)' : 'rgba(138,153,168,0.12)'}
          stroke={stroke}
          strokeWidth={selected ? 3 : 2}
        />
      ) : (
        <rect x={x} y={y} width={width} height={height} fill="none" stroke={stroke} strokeDasharray="6 4" strokeWidth={2} />
      )}
      <text x={x + 4} y={y + 16} fill={stroke} fontSize={16} style={{ fontWeight: 700 }}>
        {candidate.id}
      </text>
    </g>
  );
}
