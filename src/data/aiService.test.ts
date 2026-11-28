import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AiContractError,
  AiServiceUnavailable,
  analyseRoofImage,
  describeHealth,
  parseAnalysisResult,
  probeAiService,
  type AiHealth,
} from './aiService';

/**
 * A real HTTP server stands in for the AI service, so the client's own fetch, timeout,
 * status handling and parsing are exercised rather than a mocked fetch.
 */

let server: Server;
let baseUrl = '';
const routes = new Map<string, (req: IncomingMessage, body: Buffer, res: ServerResponse) => void>();

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk as Buffer));
    req.on('end', () => {
      const handler = routes.get(`${req.method} ${req.url}`);
      if (!handler) {
        res.writeHead(404).end();
        return;
      }
      handler(req, Buffer.concat(chunks), res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function reply(body: unknown, status = 200) {
  return (_req: IncomingMessage, _body: Buffer, res: ServerResponse) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
}

const healthy: AiHealth = {
  status: 'ready',
  weightsDir: '/srv/ssp-ai/weights',
  providers: {
    detector: { available: true, reason: 'ready', provenance: { kind: 'detector', name: 'GroundingDINO', version: 'swint-ogc' } },
    segmenter: { available: true, reason: 'ready', provenance: { kind: 'segmenter', name: 'SAM 2.1', version: '2.1' } },
    vision: { available: false, reason: 'llama.cpp server is not reachable', provenance: { kind: 'vision', name: 'Qwen3-VL-8B-Instruct', version: '8B' } },
  },
};

const proposal = {
  status: 'PROPOSED',
  job_id: 'job-1',
  candidates: [
    {
      id: 'c1',
      kind: 'roof',
      score: 0.93,
      box: [10, 10, 120, 80],
      label: 'house',
      parent_id: null,
      area_px: 9612.5,
      outline: [
        [10, 10],
        [130, 10],
        [130, 90],
        [10, 90],
      ],
      uncertain: false,
    },
    {
      id: 'c2',
      kind: 'building',
      score: 0.61,
      box: [200, 30, 60, 40],
      label: 'shed',
      parent_id: null,
      area_px: null,
      outline: null,
      uncertain: true,
    },
  ],
  features: [{ id: 'f1', kind: 'penetration', points: [[60, 40]], confidence: 0.55, candidate_id: 'c1' }],
  planes: [{ proposal: 'roof_form', roof_form: 'hip' }],
  provenance: [{ kind: 'detector', name: 'GroundingDINO', version: 'swint-ogc' }],
  warnings: [],
  image: { width_px: 800, height_px: 600, source: 'aerial.jpg', ground_sample_mm_per_px: 150, crs_epsg: 7855 },
};

describe('service availability', () => {
  it('reads the health report and names what is missing', async () => {
    routes.set('GET /health', reply(healthy));
    const health = await probeAiService(baseUrl);
    expect(health.status).toBe('ready');
    expect(describeHealth(health)).toContain('vision: llama.cpp server is not reachable');
  });

  it('reports an unreachable service instead of pretending it is available', async () => {
    await expect(probeAiService('http://127.0.0.1:1', 300)).rejects.toBeInstanceOf(AiServiceUnavailable);
  });

  it('rejects a health reply that is not the agreed shape', async () => {
    routes.set('GET /health', reply({ status: 'ready' }));
    await expect(probeAiService(baseUrl)).rejects.toBeInstanceOf(AiContractError);
  });
});

describe('roof analysis', () => {
  it('posts the image and returns validated candidates', async () => {
    let received = '';
    routes.set('POST /v1/analyse', (req, body, res) => {
      received = body.toString('latin1');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(proposal));
    });

    const result = await analyseRoofImage({
      baseUrl,
      jobId: 'job-1',
      file: new Blob(['fake-jpeg-bytes'], { type: 'image/jpeg' }),
      stages: ['detect', 'segment', 'features'],
    });

    expect(received).toContain('name="job_id"');
    expect(received).toContain('detect,segment,features');
    expect(result.status).toBe('PROPOSED');
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0].outline).toHaveLength(4);
    expect(result.candidates[1].outline).toBeNull();
    expect(result.features[0].kind).toBe('penetration');
    expect(result.image?.groundSampleMmPerPx).toBe(150);
  });

  it('surfaces the reason when no model is running', async () => {
    routes.set(
      'POST /v1/analyse',
      reply({ status: 'UNAVAILABLE', job_id: 'job-1', unavailable_reason: 'GroundingDINO weights not found at /w/x.pth' }, 503),
    );
    await expect(
      analyseRoofImage({ baseUrl, jobId: 'job-1', file: new Blob(['x']) }),
    ).rejects.toThrow(/weights not found/);
  });

  it('refuses a feature whose candidate is missing', () => {
    const broken = {
      ...proposal,
      features: [{ id: 'f1', kind: 'ridge', points: [[1, 1]], confidence: 0.4, candidate_id: 'c9' }],
    };
    expect(() => parseAnalysisResult(broken)).toThrow(AiContractError);
  });

  it('refuses a proposal with no candidates', () => {
    expect(() => parseAnalysisResult({ ...proposal, candidates: [], features: [] })).toThrow(/no candidates/);
  });

  it('refuses an outline that is not a point list', () => {
    const broken = {
      ...proposal,
      candidates: [{ ...proposal.candidates[0], outline: [[1, 2, 3]] }],
      features: [],
    };
    expect(() => parseAnalysisResult(broken)).toThrow(/not \[x, y\]/);
  });

  it('refuses an image too large for the service rather than retrying forever', async () => {
    routes.set('POST /v1/analyse', reply({ detail: 'the uploaded image has too many pixels to analyse' }, 422));
    await expect(
      analyseRoofImage({ baseUrl, jobId: 'job-1', file: new Blob(['x']) }),
    ).rejects.toThrow(/too many pixels/);
  });
});
