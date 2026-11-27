import { describe, expect, it } from 'vitest';
import { fingerprint } from '@/domain/units';
import { BOM, VERIFIED_PROFILE, orderInput } from './supplier.fixture';
import {
  SUPPLIER_ADAPTERS,
  adapterById,
  buildSupplierOrder,
  type SupplierOrderInput,
} from './supplier';

describe('building a supplier order', () => {
  it('turns the bill of materials into supplier lines', () => {
    const order = buildSupplierOrder(orderInput());
    expect(order.lines.map((line) => line.key)).toEqual(['sheet-3600', 'flashing-ridge', 'fasteners']);
    const sheet = order.lines[0];
    expect(sheet.lengthMm).toBe(3600);
    expect(sheet.quantity).toBe(16);
    expect(sheet.unit).toBe('ea');
    const flashing = order.lines[1];
    expect(flashing.lengthMm).toBeNull();
    expect(flashing.quantity).toBe(12);
    expect(flashing.unit).toBe('m');
  });

  it('states the product specification a supplier needs to fill the order', () => {
    const order = buildSupplierOrder(orderInput());
    expect(order.product).toMatchObject({
      manufacturer: 'Example Roofing',
      profile: 'Corrugated 0.42',
      material: 'Colorbond steel',
      thickness: '0.42 mm',
      coating: 'Colorbond',
      coverMm: 762,
      maxLengthMm: 6000,
      catalogueRevision: '4',
      verification: 'VERIFIED',
    });
  });

  it('never invents a colour or a required-by date', () => {
    const order = buildSupplierOrder(orderInput());
    expect(order.product.colour).toBeNull();
    expect(order.deliverTo.requiredBy).toBeNull();
    expect(order.placeholders).toContain('Colour is not recorded on this job.');
  });

  it('carries the colour once the operator records one', () => {
    const order = buildSupplierOrder(orderInput({ colour: 'Monument' }));
    expect(order.product.colour).toBe('Monument');
    expect(order.placeholders).not.toContain('Colour is not recorded on this job.');
  });

  it('labels an unconfigured supplier instead of guessing one', () => {
    const order = buildSupplierOrder(
      orderInput({
        company: { ...orderInput().company, supplierName: null, supplierEmail: null, supplierAccount: null },
      }),
    );
    expect(order.supplier.name).toBeNull();
    expect(order.placeholders).toContain('Supplier is not configured in settings.');
  });

  it('blocks the order while the specification is unverified', () => {
    const order = buildSupplierOrder(orderInput({ profile: { ...VERIFIED_PROFILE, verificationState: 'PARTIAL' } }));
    expect(order.status).toBe('BLOCKED');
    expect(order.blockers).toContain('Product specification is not verified.');
    expect(order.heading).toBe('MATERIAL ORDER — NOT FOR MANUFACTURE');
  });

  it('blocks the order while the bill of materials is incomplete', () => {
    const order = buildSupplierOrder(
      orderInput({ bom: { ...BOM, incomplete: true, warnings: ['Fixing rule is not configured.'] } }),
    );
    expect(order.status).toBe('BLOCKED');
    expect(order.blockers).toContain('Fixing rule is not configured.');
  });

  it('blocks the order while order-grade conditions are outstanding', () => {
    const order = buildSupplierOrder(orderInput({ orderBlockers: ['No verified control dimension.'] }));
    expect(order.status).toBe('BLOCKED');
    expect(order.blockers).toContain('No verified control dimension.');
  });

  it('is ready only when the specification, the BOM and the order-grade gates all pass', () => {
    const order = buildSupplierOrder(orderInput());
    expect(order.status).toBe('READY');
    expect(order.heading).toBe('MATERIAL ORDER');
    expect(order.blockers).toEqual([]);
  });

  it('carries the calculation revision the order was built from', () => {
    const order = buildSupplierOrder(orderInput());
    expect(order.provenance).toMatchObject({
      bomFingerprint: fingerprint(BOM.lines),
      calcInputFingerprint: 'in-abc',
      calcOutputFingerprint: 'out-def',
      engineVersion: '1.0.0',
      totalSheets: 16,
      totalSheetLengthMm: 57_600,
      recordType: 'TEST',
    });
  });

  it('fingerprints the content that is supplied, not the moment it was generated', () => {
    const first = buildSupplierOrder(orderInput());
    const second = buildSupplierOrder(orderInput({ number: 'SO-0002', generatedAt: '2027-01-01T00:00:00.000Z' }));
    expect(second.fingerprint).toBe(first.fingerprint);
  });

  it('changes the fingerprint when a supplied quantity changes', () => {
    const first = buildSupplierOrder(orderInput());
    const changed = buildSupplierOrder(
      orderInput({
        bom: { ...BOM, lines: [{ ...BOM.lines[0], quantityMicro: 17_000_000 }, ...BOM.lines.slice(1)] },
      }),
    );
    expect(changed.fingerprint).not.toBe(first.fingerprint);
  });

  it('changes the fingerprint when the product changes', () => {
    const first = buildSupplierOrder(orderInput());
    const changed = buildSupplierOrder(orderInput({ profile: { ...VERIFIED_PROFILE, revision: '5' } }));
    expect(changed.fingerprint).not.toBe(first.fingerprint);
  });

  it('refuses to build an order when the layout did not produce sheets', () => {
    const order = buildSupplierOrder(
      orderInput({ layout: { ok: false, code: 'RULE_MISSING', reason: 'Effective cover width is not configured.' } }),
    );
    expect(order.status).toBe('BLOCKED');
    expect(order.blockers).toContain('Effective cover width is not configured.');
    expect(order.lines.filter((line) => line.kind === 'sheet')).toEqual([]);
  });
});

describe('supplier adapters', () => {
  it('offers more than one output shape', () => {
    expect(SUPPLIER_ADAPTERS.length).toBeGreaterThan(1);
    expect(adapterById('generic').id).toBe('generic');
    expect(adapterById('cut-list').id).toBe('cut-list');
  });

  it('falls back to the generic adapter for an unknown supplier format', () => {
    expect(adapterById('nope').id).toBe('generic');
  });

  it('writes a structured CSV with a header and one row per line', () => {
    const order = buildSupplierOrder(orderInput());
    const csv = adapterById('generic').csv(order);
    const rows = csv.trim().split('\n');
    expect(rows).toHaveLength(order.lines.length + 1);
    expect(rows[0]).toBe(
      '"Item","Description","Material","Thickness","Colour","Length (mm)","Quantity","Unit","Verified","Note"',
    );
    expect(rows[1]).toContain('"3600"');
    expect(rows[1]).toContain('"16"');
  });

  it('quotes and escapes cells that contain separators', () => {
    const order = buildSupplierOrder(
      orderInput({
        bom: {
          ...BOM,
          lines: [{ ...BOM.lines[0], description: 'Sheet, 0.42 "Colorbond"' }, ...BOM.lines.slice(1)],
        },
      }),
    );
    const csv = adapterById('generic').csv(order);
    expect(csv).toContain('"Sheet, 0.42 ""Colorbond"""');
  });

  it('writes a cut list a supplier can work from without reading prose', () => {
    const order = buildSupplierOrder(orderInput());
    const csv = adapterById('cut-list').csv(order);
    const rows = csv.trim().split('\n');
    expect(rows[0]).toBe('"Length (mm)","Quantity"');
    expect(rows.slice(1)).toEqual(['"3600","16"', '"","12"', '"","288"']);
  });

  it('stamps a blocked order in the CSV so it cannot pass as confirmed', () => {
    const order = buildSupplierOrder(orderInput({ profile: { ...VERIFIED_PROFILE, verificationState: 'PLACEHOLDER' } }));
    const csv = adapterById('generic').csv(order);
    expect(csv).toContain('NOT FOR MANUFACTURE');
  });
});
