import type { SupplierOrder, SupplierOrderLine } from '@/domain/supplier';

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BOTTOM_LIMIT = 96;

const COL_ITEM = MARGIN;
const COL_DETAIL = MARGIN + 150;
const COL_LENGTH = MARGIN + 372;
const COL_QTY = MARGIN + 444;
const COL_UNIT = MARGIN + CONTENT_WIDTH;

const INK = { r: 0.09, g: 0.12, b: 0.16 };
const MUTED = { r: 0.36, g: 0.42, b: 0.48 };
const RULE = { r: 0.82, g: 0.85, b: 0.88 };
const WARN = { r: 0.62, g: 0.22, b: 0.09 };

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
}

function lengthLabel(line: SupplierOrderLine): string {
  return line.lengthMm === null ? '—' : String(line.lengthMm);
}

/**
 * Renders the material order a supplier receives. There are no prices: this is a cutting
 * and supply instruction, and a price on it would invite the supplier to treat it as a
 * purchase order the business has committed to. A blocked order carries the NOT FOR
 * MANUFACTURE stamp on every page, so a printed copy cannot be mistaken for a release.
 */
export async function renderSupplierOrderPdf(order: SupplierOrder): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  pdf.setTitle(`${order.heading} ${order.number}`);
  pdf.setSubject(`${order.job.title} — ${order.job.site}`);
  pdf.setProducer('Sheet Set Pro');
  pdf.setCreator('Sheet Set Pro — Mitchell’s Metal Roofing');

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const ink = rgb(INK.r, INK.g, INK.b);
  const muted = rgb(MUTED.r, MUTED.g, MUTED.b);
  const rule = rgb(RULE.r, RULE.g, RULE.b);
  const warn = rgb(WARN.r, WARN.g, WARN.b);

  const text = (
    value: string,
    options: { x: number; y: number; size?: number; font?: typeof regular; colour?: typeof ink },
  ) => {
    page.drawText(value, {
      x: options.x,
      y: options.y,
      size: options.size ?? 10,
      font: options.font ?? regular,
      color: options.colour ?? ink,
    });
  };

  const rightText = (
    value: string,
    options: { xRight: number; y: number; size?: number; font?: typeof regular; colour?: typeof ink },
  ) => {
    const font = options.font ?? regular;
    const size = options.size ?? 10;
    text(value, { x: options.xRight - font.widthOfTextAtSize(value, size), y: options.y, size, font, colour: options.colour });
  };

  const ruleLine = (atY: number) => {
    page.drawLine({ start: { x: MARGIN, y: atY }, end: { x: MARGIN + CONTENT_WIDTH, y: atY }, thickness: 0.7, color: rule });
  };

  const wrap = (value: string, width: number, font: typeof regular, size: number): string[] => {
    const words = value.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    return lines.length > 0 ? lines : [''];
  };

  const newPage = () => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
    text(`${order.heading} ${order.number} — continued`, { x: MARGIN, y: y - 10, size: 9, colour: muted });
    if (order.status !== 'READY') {
      rightText('NOT FOR MANUFACTURE', { xRight: MARGIN + CONTENT_WIDTH, y: y - 10, size: 9, font: bold, colour: warn });
    }
    y -= 30;
  };

  const ensure = (height: number) => {
    if (y - height < BOTTOM_LIMIT) newPage();
  };

  // Letterhead
  text(order.heading, { x: MARGIN, y: y - 16, size: 15, font: bold, colour: order.status === 'READY' ? ink : warn });
  rightText(order.number, { xRight: MARGIN + CONTENT_WIDTH, y: y - 16, size: 15, font: bold });
  y -= 34;
  text(`Generated ${formatDate(order.generatedAt)}`, { x: MARGIN, y, size: 9, colour: muted });
  if (order.status !== 'READY') {
    rightText('NOT FOR MANUFACTURE', { xRight: MARGIN + CONTENT_WIDTH, y, size: 10, font: bold, colour: warn });
  }
  y -= 10;
  ruleLine(y);
  y -= 22;

  // Supplier and delivery
  text('SUPPLY TO', { x: MARGIN, y, size: 7.5, colour: muted });
  text('DELIVER TO', { x: MARGIN + 280, y, size: 7.5, colour: muted });
  y -= 14;
  text(order.supplier.name ?? 'Supplier not configured', { x: MARGIN, y, size: 10.5, font: bold });
  text(order.deliverTo.name, { x: MARGIN + 280, y, size: 10.5, font: bold });
  y -= 12;

  const supplierLines = [
    order.supplier.email,
    order.supplier.account ? `Account ${order.supplier.account}` : null,
    order.supplier.notes,
  ].filter((line): line is string => Boolean(line));
  const deliveryLines = [
    order.deliverTo.address,
    order.deliverTo.contact,
    order.deliverTo.phone,
    order.deliverTo.requiredBy ? `Required by ${formatDate(order.deliverTo.requiredBy)}` : 'Required by not recorded',
    `Job ${order.job.number}`,
  ].filter((line): line is string => Boolean(line));

  let leftY = y;
  for (const line of supplierLines) {
    for (const wrapped of wrap(line, 250, regular, 9)) {
      text(wrapped, { x: MARGIN, y: leftY, size: 9, colour: muted });
      leftY -= 11;
    }
  }
  let rightY = y;
  for (const line of deliveryLines) {
    for (const wrapped of wrap(line, CONTENT_WIDTH - 280, regular, 9)) {
      text(wrapped, { x: MARGIN + 280, y: rightY, size: 9, colour: muted });
      rightY -= 11;
    }
  }
  y = Math.min(leftY, rightY) - 6;
  ruleLine(y);
  y -= 20;

  // Product specification
  text('PRODUCT', { x: MARGIN, y, size: 7.5, colour: muted });
  y -= 14;
  text(`${order.product.manufacturer} ${order.product.profile}`, { x: MARGIN, y, size: 10.5, font: bold });
  rightText(
    order.product.verification === 'VERIFIED' ? 'VERIFIED SPECIFICATION' : `SPECIFICATION ${order.product.verification}`,
    {
      xRight: MARGIN + CONTENT_WIDTH,
      y,
      size: 8.5,
      font: bold,
      colour: order.product.verification === 'VERIFIED' ? muted : warn,
    },
  );
  y -= 14;

  const spec: [string, string | null][] = [
    ['Material', order.product.material],
    ['Thickness', order.product.thickness],
    ['Coating', order.product.coating],
    ['Colour', order.product.colour ?? 'Not recorded'],
    ['Cover', order.product.coverMm === null ? 'Not configured' : `${order.product.coverMm} mm`],
    ['Max length', order.product.maxLengthMm === null ? 'Not configured' : `${order.product.maxLengthMm} mm`],
    ['Catalogue revision', order.product.catalogueRevision],
  ];
  for (const [label, value] of spec) {
    text(label, { x: MARGIN, y, size: 9, colour: muted });
    text(value ?? 'Not configured', { x: MARGIN + 110, y, size: 9 });
    y -= 12;
  }
  text(`Source: ${order.product.sourceNote}`, { x: MARGIN, y, size: 8, colour: muted });
  y -= 18;

  // Lines
  const tableHeader = () => {
    text('ITEM', { x: COL_ITEM, y, size: 7.5, colour: muted });
    text('DESCRIPTION', { x: COL_DETAIL, y, size: 7.5, colour: muted });
    rightText('LENGTH (mm)', { xRight: COL_LENGTH, y, size: 7.5, colour: muted });
    rightText('QTY', { xRight: COL_QTY, y, size: 7.5, colour: muted });
    rightText('UNIT', { xRight: COL_UNIT, y, size: 7.5, colour: muted });
    y -= 6;
    ruleLine(y);
    y -= 16;
  };
  tableHeader();

  for (const line of order.lines) {
    const detail = line.detail.join(' · ') || '—';
    const detailLines = wrap(detail, COL_LENGTH - COL_DETAIL - 60, regular, 8.5);
    const noteLines = [line.verified ? null : 'Unverified specification', line.note].filter(
      (note): note is string => Boolean(note),
    );
    const rowHeight = Math.max(detailLines.length, 1) * 11 + noteLines.length * 10 + 6;
    if (y - rowHeight < BOTTOM_LIMIT) {
      newPage();
      tableHeader();
    }

    let rowY = y;
    text(line.item, { x: COL_ITEM, y: rowY, size: 9 });
    for (const wrapped of detailLines) {
      text(wrapped, { x: COL_DETAIL, y: rowY, size: 8.5, colour: muted });
      rowY -= 11;
    }
    rightText(lengthLabel(line), { xRight: COL_LENGTH, y, size: 9 });
    rightText(String(line.quantity), { xRight: COL_QTY, y, size: 9 });
    rightText(line.unit, { xRight: COL_UNIT, y, size: 9 });
    for (const note of noteLines) {
      text(note, { x: COL_DETAIL, y: rowY, size: 8, colour: note === line.note ? muted : warn });
      rowY -= 10;
    }
    y = rowY - 2;
  }
  ruleLine(y + 4);
  y -= 16;

  // What still has to be settled before this order means anything
  if (order.blockers.length > 0) {
    ensure(40);
    text('BEFORE THIS ORDER CAN BE MANUFACTURED', { x: MARGIN, y, size: 7.5, font: bold, colour: warn });
    y -= 14;
    for (const blocker of order.blockers) {
      for (const wrapped of wrap(`• ${blocker}`, CONTENT_WIDTH, regular, 8.5)) {
        ensure(14);
        text(wrapped, { x: MARGIN, y, size: 8.5, colour: warn });
        y -= 11;
      }
    }
    y -= 8;
  }

  if (order.placeholders.length > 0) {
    ensure(30);
    text('NOT RECORDED', { x: MARGIN, y, size: 7.5, font: bold, colour: muted });
    y -= 14;
    for (const placeholder of order.placeholders) {
      for (const wrapped of wrap(`• ${placeholder}`, CONTENT_WIDTH, regular, 8.5)) {
        ensure(14);
        text(wrapped, { x: MARGIN, y, size: 8.5, colour: muted });
        y -= 11;
      }
    }
    y -= 8;
  }

  // Provenance
  ensure(60);
  text('PROVENANCE', { x: MARGIN, y, size: 7.5, font: bold, colour: muted });
  y -= 13;
  const provenance: string[] = [
    `Bill of materials ${order.provenance.bomFingerprint}`,
    order.provenance.calcOutputFingerprint
      ? `Calculation ${order.provenance.calcOutputFingerprint} (engine ${order.provenance.engineVersion ?? 'unknown'})`
      : 'No calculation snapshot is stored for this revision.',
    `${order.provenance.totalSheets} sheets · ${order.provenance.totalSheetLengthMm} mm of sheet`,
    order.provenance.recordType === 'REAL'
      ? 'Real business record.'
      : `Record type ${order.provenance.recordType}: produced from test data, not a real customer record.`,
  ];
  for (const line of provenance) {
    for (const wrapped of wrap(line, CONTENT_WIDTH, regular, 8)) {
      ensure(12);
      text(wrapped, { x: MARGIN, y, size: 8, colour: muted });
      y -= 10;
    }
  }

  // Footer on every page
  const pages = pdf.getPages();
  pages.forEach((current, index) => {
    current.drawLine({
      start: { x: MARGIN, y: 64 },
      end: { x: MARGIN + CONTENT_WIDTH, y: 64 },
      thickness: 0.7,
      color: rule,
    });
    current.drawText(`Order fingerprint ${order.fingerprint}`, { x: MARGIN, y: 52, size: 7, font: regular, color: muted });
    current.drawText(`BOM ${order.provenance.bomFingerprint}`, { x: MARGIN, y: 43, size: 7, font: regular, color: muted });
    const label = `Page ${index + 1} of ${pages.length}`;
    current.drawText(label, {
      x: MARGIN + CONTENT_WIDTH - regular.widthOfTextAtSize(label, 7),
      y: 52,
      size: 7,
      font: regular,
      color: muted,
    });
    current.drawText('Sheet Set Pro', {
      x: MARGIN + CONTENT_WIDTH - regular.widthOfTextAtSize('Sheet Set Pro', 7),
      y: 43,
      size: 7,
      font: regular,
      color: muted,
    });
  });

  return pdf.save({ useObjectStreams: false });
}

/** Builds the order PDF and hands it to the browser as a download. */
export async function downloadSupplierOrderPdf(order: SupplierOrder): Promise<void> {
  const bytes = await renderSupplierOrderPdf(order);
  const buffer = bytes.slice().buffer as ArrayBuffer;
  const blob = new Blob([buffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${order.number}-material-order.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
