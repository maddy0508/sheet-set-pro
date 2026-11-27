import type { RoofEdgeKind } from '@/domain/roof3d';

/** One palette for every view of the roof, so an edge keeps its meaning across screens. */
export const ROOF_EDGE_CSS: Record<RoofEdgeKind, string> = {
  ridge: '#ffd166',
  hip: '#f4a261',
  valley: '#4ea8de',
  eave: '#8ac926',
  barge: '#c77dff',
  apron: '#adb5bd',
  seam: '#5b7085',
};

export const ROOF_EDGE_HEX: Record<RoofEdgeKind, number> = {
  ridge: 0xffd166,
  hip: 0xf4a261,
  valley: 0x4ea8de,
  eave: 0x8ac926,
  barge: 0xc77dff,
  apron: 0xadb5bd,
  seam: 0x5b7085,
};

export const ROOF_EDGE_LABEL: Record<RoofEdgeKind, string> = {
  ridge: 'Ridge',
  hip: 'Hip',
  valley: 'Valley',
  eave: 'Eave',
  barge: 'Barge / rake',
  apron: 'Apron / step',
  seam: 'Seam (no flashing)',
};
