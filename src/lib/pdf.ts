import { formatCents } from '@/domain/units';
import { documentFingerprint, type CommercialDocument } from '@/lib/document';

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BOTTOM_LIMIT = 96;

const COL_DESCRIPTION = MARGIN;
const COL_QTY = MARGIN + 268;
const COL_RATE = MARGIN + 372;
const COL_AMOUNT = MARGIN + CONTENT_WIDTH;

const INK = { r: 0.09, g: 0.12, b: 0.16 };
const MUTED = { r: 0.36, g: 0.42, b: 0.48 };
const RULE = { r: 0.82, g: 0.85, b: 0.88 };

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatQty(qtyMicro: number): string {
  return (qtyMicro / 1_000_000).toLocaleString('en-AU', { maximumFractionDigits: 2 });
}

/**
 * Renders a commercial document to PDF bytes. Text is wrapped by hand and pages are
 * added as needed, so a long bill of materials never runs off the page.
 */
export async function renderPdf(doc: CommercialDocument): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  pdf.setTitle(`${doc.heading} ${doc.number}`);
  pdf.setSubject(`${doc.job.title} — ${doc.job.site}`);
  pdf.setProducer('Sheet Set Pro');
  pdf.setCreator('Sheet Set Pro — Mitchell’s Metal Roofing');

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const ink = rgb(INK.r, INK.g, INK.b);
  const muted = rgb(MUTED.r, MUTED.g, MUTED.b);
  const rule = rgb(RULE.r, RULE.g, RULE.b);

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

  // Letterhead
  text(doc.business.name, { x: MARGIN, y: y - 16, size: 17, font: bold });
  let leftY = y - 34;
  for (const line of doc.business.detail) {
    text(line, { x: MARGIN, y: leftY, size: 9, colour: muted });
    leftY -= 12;
  }

  rightText(doc.heading, { xRight: MARGIN + CONTENT_WIDTH, y: y - 16, size: 15, font: bold });
  let rightY = y - 34;
  const meta: string[] = [doc.number];
  if (doc.issuedAt) meta.push(`Issued ${formatDate(doc.issuedAt)}`);
  if (doc.validUntil) meta.push(`Valid until ${formatDate(doc.validUntil)}`);
  if (doc.dueDate) meta.push(`Due ${formatDate(doc.dueDate)}`);
  for (const line of meta) {
    rightText(line, { xRight: MARGIN + CONTENT_WIDTH, y: rightY, size: 9, colour: muted });
    rightY -= 12;
  }
  if (doc.status.status === 'voided') {
    rightText('VOID', { xRight: MARGIN + CONTENT_WIDTH, y: rightY, size: 11, font: bold });
    rightY -= 12;
  }

  y = Math.min(leftY, rightY) - 12;
  ruleLine(y);
  y -= 24;

  // Parties
  text('PREPARED FOR', { x: MARGIN, y, size: 7.5, colour: muted });
  text('SITE', { x: MARGIN + 280, y, size: 7.5, colour: muted });
  y -= 14;
  text(doc.customer.name, { x: MARGIN, y, size: 10.5, font: bold });
  text(doc.job.title, { x: MARGIN + 280, y, size: 10.5, font: bold });
  y -= 12;
  let partyLeft = y;
  for (const line of doc.customer.detail) {
    text(line, { x: MARGIN, y: partyLeft, size: 9, colour: muted });
    partyLeft -= 11;
  }
  let partyRight = y;
  for (const line of [doc.job.site, `Job ${doc.job.number}`]) {
    for (const wrapped of wrap(line, CONTENT_WIDTH - 280, regular, 9)) {
      text(wrapped, { x: MARGIN + 280, y: partyRight, size: 9, colour: muted });
      partyRight -= 11;
    }
  }
  y = Math.min(partyLeft, partyRight) - 10;
  ruleLine(y);
  y -= 20;

  // Table header
  const tableHeader = () => {
    text('DESCRIPTION', { x: COL_DESCRIPTION, y, size: 7.5, colour: muted });
    rightText('QTY', { xRight: COL_QTY, y, size: 7.5, colour: muted });
    rightText('RATE', { xRight: COL_RATE, y, size: 7.5, colour: muted });
    rightText('AMOUNT', { xRight: COL_AMOUNT, y, size: 7.5, colour: muted });
    y -= 6;
    ruleLine(y);
    y -= 16;
  };

  const newPage = () => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
    text(`${doc.heading} ${doc.number} — continued`, { x: MARGIN, y: y - 10, size: 9, colour: muted });
    y -= 28;
    tableHeader();
  };

  tableHeader();

  for (const line of doc.lines) {
    const descriptionLines = wrap(line.description, COL_QTY - COL_DESCRIPTION - 90, regular, 9.5);
    const noteLines = line.unverified ? ['Unverified specification'] : [];
    const rowHeight = (descriptionLines.length + noteLines.length) * 12 + 6;
    if (y - rowHeight < BOTTOM_LIMIT) newPage();

    let rowY = y;
    for (const wrapped of descriptionLines) {
      text(wrapped, { x: COL_DESCRIPTION, y: rowY, size: 9.5 });
      rowY -= 12;
    }
    for (const note of noteLines) {
      text(note, { x: COL_DESCRIPTION, y: rowY, size: 8, colour: muted });
      rowY -= 12;
    }
    const baseline = y;
    rightText(`${formatQty(line.qtyMicro)} ${line.unit}`, { xRight: COL_QTY, y: baseline, size: 9.5 });
    rightText(formatCents(line.unitPriceCents), { xRight: COL_RATE, y: baseline, size: 9.5 });
    rightText(formatCents(line.amountCents), { xRight: COL_AMOUNT, y: baseline, size: 9.5 });
    y = rowY - 2;
  }

  ruleLine(y + 4);
  y -= 18;

  // Totals
  if (y < BOTTOM_LIMIT + 90) newPage();
  const totalsRows: [string, string, boolean][] = [
    ['Subtotal', formatCents(doc.totals.subtotalCents), false],
    [
      doc.totals.gstApplied ? `GST (${(doc.totals.gstRateBp / 100).toFixed(2)}%)` : 'GST (not applied)',
      formatCents(doc.totals.gstCents),
      false,
    ],
    ['Total', formatCents(doc.totals.totalCents), true],
  ];
  if (doc.balanceCents !== null && doc.balanceCents !== doc.totals.totalCents) {
    totalsRows.push(['Outstanding balance (current)', formatCents(doc.balanceCents), true]);
  }
  for (const [label, value, strong] of totalsRows) {
    const font = strong ? bold : regular;
    rightText(label, { xRight: COL_RATE, y, size: strong ? 11 : 9.5, font, colour: strong ? ink : muted });
    rightText(value, { xRight: COL_AMOUNT, y, size: strong ? 11 : 9.5, font });
    y -= strong ? 18 : 14;
  }

  // Notes and provenance: the frozen notes first, then anything that is true only now.
  y -= 8;
  const noteWidth = CONTENT_WIDTH;
  const currentNotes: string[] = [];
  if (doc.snapshot === 'legacy') {
    currentNotes.push(
      'This document was issued before snapshots were captured. It is rebuilt from the current records and may differ from the copy the customer received.',
    );
  }
  if (doc.status.status === 'voided') {
    currentNotes.push(
      `This invoice was voided${doc.status.voidReason ? `: ${doc.status.voidReason}` : ''}. It is retained for the record and is not payable.`,
    );
  }
  for (const note of [...doc.notes, ...currentNotes]) {
    for (const wrapped of wrap(note, noteWidth, regular, 8)) {
      if (y < BOTTOM_LIMIT) newPage();
      text(wrapped, { x: MARGIN, y, size: 8, colour: muted });
      y -= 10;
    }
  }

  // Footer on every page
  const pages = pdf.getPages();
  const stamp = documentFingerprint(doc);
  pages.forEach((current, index) => {
    current.drawLine({
      start: { x: MARGIN, y: 64 },
      end: { x: MARGIN + CONTENT_WIDTH, y: 64 },
      thickness: 0.7,
      color: rule,
    });
    current.drawText(`Document fingerprint ${stamp}`, { x: MARGIN, y: 52, size: 7, font: regular, color: muted });
    current.drawText(
      doc.snapshot === 'captured' ? `Stored fingerprint ${doc.fingerprint}` : 'Stored fingerprint: not captured at issue',
      { x: MARGIN, y: 43, size: 7, font: regular, color: muted },
    );
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

/** Builds the PDF and hands it to the browser as a download. */
export async function downloadPdf(doc: CommercialDocument): Promise<void> {
  const bytes = await renderPdf(doc);
  const buffer = bytes.slice().buffer as ArrayBuffer;
  const blob = new Blob([buffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${doc.number}-${doc.kind.toLowerCase()}.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
