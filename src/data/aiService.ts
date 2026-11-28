/**
 * Client for the local AI service (see `ai-service/`).
 *
 * The service is optional by design. When it is not running the application says so and the
 * operator traces the roof by hand; nothing here falls back to invented geometry. Everything
 * the service returns is validated before it reaches the UI, because a model reply is an
 * untrusted input like any other.
 */

export type ProviderHealth = {
  available: boolean;
  reason: string;
  provenance: { kind: string; name: string; version: string; quantisation?: string | null; runtime?: string | null };
};

export type AiHealth = {
  status: 'ready' | 'unavailable';
  providers: Record<string, ProviderHealth>;
  weightsDir: string;
};

export type Candidate = {
  id: string;
  kind: 'building' | 'roof' | 'roof_section' | 'roof_plane';
  score: number;
  /** [x, y, width, height] in image pixels. */
  box: [number, number, number, number];
  label: string;
  parentId: string | null;
  areaPx: number | null;
  /** Image-space outline in pixels; null when segmentation did not run. */
  outline: [number, number][] | null;
  uncertain: boolean;
};

export type FeatureKind =
  | 'ridge'
  | 'hip'
  | 'valley'
  | 'eave'
  | 'barge'
  | 'apron'
  | 'box_gutter'
  | 'flashing'
  | 'penetration'
  | 'obstruction';

export type FeatureProposal = {
  id: string;
  kind: FeatureKind;
  points: [number, number][];
  confidence: number;
  candidateId: string;
};

export type AnalysisResult = {
  status: 'PROPOSED' | 'PARTIAL';
  jobId: string;
  candidates: Candidate[];
  features: FeatureProposal[];
  planes: Record<string, unknown>[];
  provenance: { kind: string; name: string; version: string; quantisation?: string | null; runtime?: string | null }[];
  warnings: string[];
  image: {
    widthPx: number;
    heightPx: number;
    source: string;
    groundSampleMmPerPx: number | null;
    crsEpsg: number | null;
  } | null;
};

/** The service is not running, or is running without the models it needs. */
export class AiServiceUnavailable extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = 'AiServiceUnavailable';
    this.reason = reason;
  }
}

/** The service answered, but not in the agreed shape. Never rendered as a proposal. */
export class AiContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiContractError';
  }
}

export const DEFAULT_AI_SERVICE_URL = 'http://127.0.0.1:8090';

export function configuredAiServiceUrl(): string | null {
  const value = import.meta.env.VITE_AI_SERVICE_URL?.trim();
  return value ? value.replace(/\/+$/, '') : null;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function probeAiService(baseUrl: string, timeoutMs = 2500): Promise<AiHealth> {
  let response: Response;
  try {
    response = await fetchWithTimeout(`${baseUrl}/health`, { method: 'GET' }, timeoutMs);
  } catch (error) {
    throw new AiServiceUnavailable(
      `the AI service is not reachable at ${baseUrl}: ${error instanceof Error ? error.name : 'network error'}`,
    );
  }
  if (!response.ok) {
    throw new AiServiceUnavailable(`the AI service answered ${response.status}`);
  }
  const payload = (await response.json()) as Partial<AiHealth>;
  if (!payload || typeof payload.status !== 'string' || typeof payload.providers !== 'object' || payload.providers === null) {
    throw new AiContractError('/health did not return a status and a provider list');
  }
  return payload as AiHealth;
}

/** Which models are actually running, in the words a roofer can act on. */
export function describeHealth(health: AiHealth): string {
  const entries = Object.entries(health.providers);
  if (entries.length === 0) return 'The AI service reported no models.';
  return entries
    .map(([name, provider]) => `${name}: ${provider.available ? 'ready' : provider.reason}`)
    .join(' · ');
}

export type AnalyseOptions = {
  baseUrl: string;
  jobId: string;
  file: Blob;
  fileName?: string;
  stages?: ('detect' | 'segment' | 'outline' | 'features' | 'classify')[];
  timeoutMs?: number;
};

export async function analyseRoofImage(options: AnalyseOptions): Promise<AnalysisResult> {
  const form = new FormData();
  form.append('image', options.file, options.fileName ?? 'aerial.jpg');
  form.append('job_id', options.jobId);
  form.append('stages', (options.stages ?? ['detect', 'segment']).join(','));

  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${options.baseUrl}/v1/analyse`,
      { method: 'POST', body: form },
      options.timeoutMs ?? 180_000,
    );
  } catch (error) {
    throw new AiServiceUnavailable(
      `the AI service did not answer: ${error instanceof Error ? error.message : 'network error'}`,
    );
  }

  if (response.status === 503) {
    const body = await safeJson(response);
    const reason =
      body && typeof body.unavailable_reason === 'string'
        ? body.unavailable_reason
        : body && typeof body.detail === 'string'
          ? body.detail
          : 'no detection model is running on the AI service';
    throw new AiServiceUnavailable(reason);
  }
  if (!response.ok) {
    const body = await safeJson(response);
    const detail = body && typeof body.detail === 'string' ? body.detail : `status ${response.status}`;
    throw new AiContractError(`the AI service refused the image: ${detail}`);
  }

  const payload = await safeJson(response);
  return parseAnalysisResult(payload);
}

async function safeJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const value = await response.json();
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function asNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || Number.isNaN(value)) throw new AiContractError(`${label} is not a number`);
  return value;
}

function asPointList(value: unknown, label: string): [number, number][] {
  if (!Array.isArray(value) || value.length < 1) throw new AiContractError(`${label} is not a point list`);
  return value.map((point, index) => {
    if (!Array.isArray(point) || point.length !== 2) throw new AiContractError(`${label} point ${index} is not [x, y]`);
    return [asNumber(point[0], `${label} x`), asNumber(point[1], `${label} y`)] as [number, number];
  });
}

/**
 * Parse and validate the service payload. A feature whose parent candidate is missing, a
 * polygon with two points, or a score outside 0..1 is a contract error, not a proposal.
 */
export function parseAnalysisResult(payload: unknown): AnalysisResult {
  if (!payload || typeof payload !== 'object') throw new AiContractError('the analysis reply is not an object');
  const body = payload as Record<string, unknown>;
  if (body.status !== 'PROPOSED' && body.status !== 'PARTIAL') {
    throw new AiContractError(`unexpected analysis status: ${String(body.status)}`);
  }
  if (typeof body.job_id !== 'string' || body.job_id.length === 0) throw new AiContractError('the reply has no job id');

  const rawCandidates = Array.isArray(body.candidates) ? body.candidates : [];
  const candidates: Candidate[] = rawCandidates.map((item, index) => {
    if (!item || typeof item !== 'object') throw new AiContractError(`candidate ${index} is not an object`);
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.id !== 'string') throw new AiContractError(`candidate ${index} has no id`);
    const box = candidate.box;
    if (!Array.isArray(box) || box.length !== 4) throw new AiContractError(`candidate ${candidate.id} has no box`);
    const outline = candidate.outline;
    return {
      id: candidate.id,
      kind: (candidate.kind as Candidate['kind']) ?? 'building',
      score: asNumber(candidate.score, `candidate ${candidate.id} score`),
      box: [asNumber(box[0], 'box x'), asNumber(box[1], 'box y'), asNumber(box[2], 'box width'), asNumber(box[3], 'box height')],
      label: typeof candidate.label === 'string' ? candidate.label : 'structure',
      parentId: typeof candidate.parent_id === 'string' ? candidate.parent_id : null,
      areaPx: typeof candidate.area_px === 'number' ? candidate.area_px : null,
      outline: outline === null || outline === undefined ? null : asPointList(outline, `candidate ${candidate.id} outline`),
      uncertain: candidate.uncertain === true,
    };
  });

  const ids = new Set(candidates.map((candidate) => candidate.id));
  if (ids.size !== candidates.length) throw new AiContractError('the reply contains duplicate candidate ids');

  const rawFeatures = Array.isArray(body.features) ? body.features : [];
  const features: FeatureProposal[] = rawFeatures.map((item, index) => {
    if (!item || typeof item !== 'object') throw new AiContractError(`feature ${index} is not an object`);
    const feature = item as Record<string, unknown>;
    const candidateId = typeof feature.candidate_id === 'string' ? feature.candidate_id : '';
    if (!ids.has(candidateId)) throw new AiContractError(`feature ${index} refers to unknown candidate ${candidateId}`);
    return {
      id: typeof feature.id === 'string' ? feature.id : `f${index + 1}`,
      kind: feature.kind as FeatureKind,
      points: asPointList(feature.points, `feature ${index} points`),
      confidence: asNumber(feature.confidence, `feature ${index} confidence`),
      candidateId,
    };
  });

  if (body.status === 'PROPOSED' && candidates.length === 0) {
    throw new AiContractError('a proposed result came back with no candidates');
  }

  const image = body.image && typeof body.image === 'object' ? (body.image as Record<string, unknown>) : null;

  return {
    status: body.status,
    jobId: body.job_id,
    candidates,
    features,
    planes: Array.isArray(body.planes) ? (body.planes as Record<string, unknown>[]) : [],
    provenance: Array.isArray(body.provenance) ? (body.provenance as AnalysisResult['provenance']) : [],
    warnings: Array.isArray(body.warnings) ? body.warnings.map(String) : [],
    image: image
      ? {
          widthPx: asNumber(image.width_px, 'image width'),
          heightPx: asNumber(image.height_px, 'image height'),
          source: typeof image.source === 'string' ? image.source : 'unknown',
          groundSampleMmPerPx: typeof image.ground_sample_mm_per_px === 'number' ? image.ground_sample_mm_per_px : null,
          crsEpsg: typeof image.crs_epsg === 'number' ? image.crs_epsg : null,
        }
      : null,
  };
}
