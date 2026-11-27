import { PDFDocument, PDFRawStream } from 'pdf-lib';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { CatalogueProfile } from '@/data/types';
import { buildSupplierOrder } from '@/domain/supplier';
import { renderSupplierOrderPdf } from './supplierPdf';
import { orderInput } from '@/domain/supplier.fixture';

const base = orderInput();
const profile: CatalogueProfile = base.profile as CatalogueProfile;

function pdfText(document: PDFDocument): string {
  const decoder = new TextDecoder('latin1');
  const parts: string[] = [];
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    if (object instanceof PDFRawStream) {
      try {
        parts.push(decoder.decode(inflateSync(object.contents)));
      } catch {
        // Fonts are not Flate-encoded text streams.
      }
    }
  }
  const raw = parts.join('\n');
  // pdf-lib writes text either as a hex string or as a literal string.
  return raw
    .replace(/<([0-9A-Fa-f\s]+)>\s*Tj/g, (_match, hex: string) =>
      Buffer.from(hex.replace(/\s+/g, ''), 'hex').toString('latin1'),
    )
    .replace(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g, (_match, body: string) =>
      body.replace(/\\([()\\])/g, '$1'),
    );
}

async function textOf(order: ReturnType<typeof buildSupplierOrder>): Promise<string> {
  return pdfText(await PDFDocument.load(await renderSupplierOrderPdf(order)));
}

describe('supplier order PDF', () => {
  it('is a readable PDF that names the order, the product and the cut lengths', async () => {
    const order = buildSupplierOrder({ ...base, profile });
    const text = await textOf(order);
    expect(text).toContain('MATERIAL ORDER');
    expect(text).toContain('SO-0001');
    expect(text).toContain('Corrugated 0.42');
    expect(text).toContain('0.42 mm');
    expect(text).toContain('3600');
    expect(text).toContain('DELIVER TO');
    expect(text).toContain('1 Test Street, Bendigo VIC 3550');
  });

  it('stamps an unverified specification so a printed copy cannot pass as a release', async () => {
    const order = buildSupplierOrder({
      ...base,
      profile: { ...profile, verificationState: 'PARTIAL' },
    });
    const text = await textOf(order);
    expect(text).toContain('NOT FOR MANUFACTURE');
    expect(text).toContain('BEFORE THIS ORDER CAN BE MANUFACTURED');
    expect(text).toContain('Product specification is not verified.');
  });

  it('prints the provenance a supplier query can be answered from', async () => {
    const order = buildSupplierOrder({ ...base, profile });
    const text = await textOf(order);
    expect(text).toContain(`Order fingerprint ${order.fingerprint}`);
    expect(text).toContain(`BOM ${order.provenance.bomFingerprint}`);
    expect(text).toContain('Calculation out-def');
    expect(text).toContain('Record type TEST');
  });

  it('lists the business facts nobody has recorded instead of inventing them', async () => {
    const order = buildSupplierOrder({ ...base, profile, colour: null });
    const text = await textOf(order);
    expect(text).toContain('Colour is not recorded on this job.');
    expect(text).toContain('Not recorded');
  });

  it('carries a blocked order across pages, not just the first', async () => {
    const many = Array.from({ length: 80 }, (_, index) => ({
      key: `sheet-${3000 + index * 10}`,
      description: `Corrugated 0.42 sheet — ${3000 + index * 10} mm`,
      category: 'sheet' as const,
      lengthMm: 3000 + index * 10,
      quantityMicro: 4_000_000,
      unit: 'ea',
      unitPriceCents: 0,
      isPlaceholder: false,
    }));
    const order = buildSupplierOrder({
      ...base,
      profile: { ...profile, verificationState: 'PLACEHOLDER' },
      bom: { lines: many, warnings: [], incomplete: false },
    });
    const parsed = await PDFDocument.load(await renderSupplierOrderPdf(order));
    expect(parsed.getPageCount()).toBeGreaterThan(1);
    const text = pdfText(parsed);
    expect(text.match(/NOT FOR MANUFACTURE/g)?.length ?? 0).toBeGreaterThan(1);
  });
});
