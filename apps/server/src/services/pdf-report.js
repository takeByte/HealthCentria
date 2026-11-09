import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PdfPrinter from 'pdfmake';
import { clinicName, footerTimestamp } from './google-sheets.js';

/**
 * Branded PDF reports (pdfmake, built on PDFKit). Every page has:
 *
 *   Header ─ logo, clinic name, report title (repeated on every page)
 *   Body   ─ details line, optional summary, then the table (its column
 *            header row repeats when the table continues on the next page)
 *   Footer ─ "Generated: <timestamp>" on the left, "Page X of Y" on the right
 *
 * Uses the PDF standard Helvetica fonts, so no font files are bundled. Those
 * fonts only cover Western characters; `clean()` swaps the few symbols they
 * lack (arrows, smart punctuation is fine) for plain text.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.resolve(here, '../../assets/healthcentria-logo.png');

const printer = new PdfPrinter({
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
});

const TEAL = '#0d7570';
const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#cbd5e1';

let logoDataUrl = null;
function logo() {
  if (logoDataUrl === null) {
    try {
      logoDataUrl = `data:image/png;base64,${fs.readFileSync(LOGO_PATH).toString('base64')}`;
    } catch {
      logoDataUrl = '';
    }
  }
  return logoDataUrl;
}

/** Helvetica (WinAnsi) has no arrows; keep everything else as typed. */
function clean(value) {
  return String(value ?? '')
    .replace(/→/g, '->')
    .replace(/←/g, '<-')
    .replace(/[^\u0000-ÿ–—‘’“”•…€]/g, '?');
}

/**
 * @param {{
 *   title: string,
 *   details: string,
 *   summary?: Array<{ label: string, value: string | number }>,
 *   columns: Array<{ header: string, width?: number | string, align?: 'left' | 'right' | 'center' }>,
 *   rows: unknown[][],
 *   totalRow?: unknown[],
 *   note?: string,
 *   landscape?: boolean,
 * }} input
 * @returns {Promise<Buffer>}
 */
export function buildReportPdf({ title, details, summary = [], columns, rows, totalRow, note, landscape = false }) {
  const generated = footerTimestamp();
  const clinic = clean(clinicName());
  const image = logo();

  const headerRow = columns.map((c) => ({
    text: clean(c.header),
    style: 'th',
    alignment: c.align ?? 'left',
  }));
  const bodyRows = rows.map((r) =>
    r.map((cell, i) => ({ text: clean(cell), alignment: columns[i]?.align ?? 'left' })),
  );
  if (totalRow) {
    bodyRows.push(
      totalRow.map((cell, i) => ({ text: clean(cell), bold: true, alignment: columns[i]?.align ?? 'left' })),
    );
  }
  if (bodyRows.length === 0) {
    bodyRows.push([
      { text: 'No records for this period.', colSpan: columns.length, italics: true, color: MUTED },
      ...columns.slice(1).map(() => ({})),
    ]);
  }

  const docDefinition = {
    info: { title: `${clinic} - ${clean(title)}`, author: 'HealthCentria', creator: 'HealthCentria' },
    // Registered once and referenced by name, so it is embedded only once.
    images: image ? { logo: image } : {},
    pageSize: 'A4',
    pageOrientation: landscape ? 'landscape' : 'portrait',
    pageMargins: [36, 92, 36, 52],
    defaultStyle: { font: 'Helvetica', fontSize: 9, color: INK, lineHeight: 1.15 },

    // Header: logo + clinic + report title on every page, with a teal rule.
    header: (currentPage, pageCount, pageSize) => ({
      margin: [36, 24, 36, 0],
      stack: [
        {
          columns: [
            ...(image ? [{ image: 'logo', width: 40, height: 40 }] : []),
            {
              width: '*',
              margin: [image ? 10 : 0, 2, 0, 0],
              stack: [
                { text: clinic, bold: true, fontSize: 13, color: TEAL },
                { text: clean(title), bold: true, fontSize: 11, margin: [0, 2, 0, 0] },
              ],
            },
            {
              width: 'auto',
              text: 'HealthCentria',
              color: MUTED,
              fontSize: 8,
              alignment: 'right',
              margin: [0, 4, 0, 0],
            },
          ],
        },
        {
          canvas: [
            { type: 'line', x1: 0, y1: 8, x2: pageSize.width - 72, y2: 8, lineWidth: 1.2, lineColor: TEAL },
          ],
        },
      ],
    }),

    // Footer: generated timestamp + "Page X of Y".
    footer: (currentPage, pageCount, pageSize) => ({
      margin: [36, 14, 36, 0],
      stack: [
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: pageSize.width - 72, y2: 0, lineWidth: 0.5, lineColor: LINE }] },
        {
          margin: [0, 6, 0, 0],
          columns: [
            { text: `Generated: ${clean(generated)}`, fontSize: 8, color: MUTED },
            { text: `Page ${currentPage} of ${pageCount}`, fontSize: 8, color: MUTED, alignment: 'right' },
          ],
        },
      ],
    }),

    content: [
      { text: clean(details), color: MUTED, margin: [0, 0, 0, 10] },
      ...(summary.length
        ? [
            {
              columns: summary.map((s) => ({
                width: 'auto',
                margin: [0, 0, 18, 0],
                stack: [
                  { text: clean(s.label).toUpperCase(), fontSize: 7, bold: true, color: MUTED, characterSpacing: 0.4 },
                  { text: clean(s.value), fontSize: 14, bold: true, color: TEAL, margin: [0, 2, 0, 0] },
                ],
              })),
              margin: [0, 0, 0, 12],
            },
          ]
        : []),
      {
        table: {
          headerRows: 1, // repeats on every page the table continues to
          dontBreakRows: true,
          widths: columns.map((c) => c.width ?? '*'),
          body: [headerRow, ...bodyRows],
        },
        layout: {
          fillColor: (rowIndex) => (rowIndex === 0 ? TEAL : rowIndex % 2 === 0 ? '#f1f5f9' : null),
          hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 0 : 0.5),
          vLineWidth: () => 0,
          hLineColor: () => '#e2e8f0',
          paddingTop: () => 4,
          paddingBottom: () => 4,
          paddingLeft: () => 5,
          paddingRight: () => 5,
        },
      },
      ...(note ? [{ text: clean(note), italics: true, color: MUTED, fontSize: 8, margin: [0, 10, 0, 0] }] : []),
    ],
    styles: {
      th: { bold: true, color: '#ffffff', fontSize: 8.5 },
    },
  };

  return new Promise((resolve, reject) => {
    try {
      const doc = printer.createPdfKitDocument(docDefinition);
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
