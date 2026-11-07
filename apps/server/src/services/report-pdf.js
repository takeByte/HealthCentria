import PDFDocument from 'pdfkit';

/**
 * Report PDFs are built server-side so every download has the same clinic
 * letterhead, period line and page footer — independent of the browser's
 * print dialog. Tables are paginated by hand: PDFKit's flow text would repeat
 * the header only when it feels like it, and a compliance report needs a
 * predictable table header on every page.
 */

const PAGE_WIDTH = 595.28; // A4, points
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 45;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;
const HEADER_LINE_Y = 96;
const CONTENT_TOP = 118;
const CONTENT_BOTTOM = PAGE_HEIGHT - 78;
const FOOTER_LINE_Y = PAGE_HEIGHT - 62;

const CLINIC_NAME = 'HealthCentria';
const CLINIC_SUBTITLE = 'Brgy. 11 Health Center';

const COLORS = {
  ink: '#0f3c5a',
  body: '#334155',
  muted: '#64748b',
  teal: '#0f766e',
  line: '#cbd5e1',
  headerBg: '#eef6fd',
  rowAlt: '#f8fafc',
  totalBg: '#eef6fd',
  summaryBg: '#f8fafc',
};

const STATUS_COLUMNS = [
  { key: 'pending', label: 'Pending', width: 50 },
  { key: 'confirmed', label: 'Confirmed', width: 58 },
  { key: 'declined', label: 'Declined', width: 52 },
  { key: 'completed', label: 'Completed', width: 60 },
  { key: 'cancelled', label: 'Cancelled', width: 60 },
  { key: 'total', label: 'Total', width: 56 },
];

function drawHeader(doc, meta) {
  doc
    .font('Helvetica-Bold')
    .fontSize(16)
    .fillColor(COLORS.ink)
    .text(CLINIC_NAME, MARGIN_X, 42, { lineBreak: false });

  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(COLORS.muted)
    .text(CLINIC_SUBTITLE, MARGIN_X, 62, { lineBreak: false });

  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(COLORS.teal)
    .text(meta.title, MARGIN_X, 44, {
      width: CONTENT_WIDTH,
      align: 'right',
      lineBreak: false,
    });

  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(COLORS.muted)
    .text(meta.period, MARGIN_X, 62, {
      width: CONTENT_WIDTH,
      align: 'right',
      lineBreak: false,
    });

  doc
    .fontSize(7.5)
    .text(`Generated ${meta.generatedAt}`, MARGIN_X, 76, {
      width: CONTENT_WIDTH,
      align: 'right',
      lineBreak: false,
    });

  doc
    .moveTo(MARGIN_X, HEADER_LINE_Y)
    .lineTo(PAGE_WIDTH - MARGIN_X, HEADER_LINE_Y)
    .lineWidth(0.75)
    .strokeColor(COLORS.line)
    .stroke();
}

function drawFooters(doc) {
  const range = doc.bufferedPageRange();
  const total = range.count;

  for (let index = range.start; index < range.start + total; index += 1) {
    doc.switchToPage(index);

    doc
      .moveTo(MARGIN_X, FOOTER_LINE_Y)
      .lineTo(PAGE_WIDTH - MARGIN_X, FOOTER_LINE_Y)
      .lineWidth(0.75)
      .strokeColor(COLORS.line)
      .stroke();

    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(COLORS.muted)
      .text(`${CLINIC_NAME} — ${CLINIC_SUBTITLE}`, MARGIN_X, FOOTER_LINE_Y + 8, {
        lineBreak: false,
      });

    doc.text(`Page ${index + 1} of ${total}`, MARGIN_X, FOOTER_LINE_Y + 8, {
      width: CONTENT_WIDTH,
      align: 'right',
      lineBreak: false,
    });
  }
}

function fitText(doc, value, width) {
  const text = String(value ?? '');
  if (!text) return '';
  if (doc.widthOfString(text) <= width) return text;

  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (doc.widthOfString(`${text.slice(0, mid)}…`) <= width) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low > 0 ? `${text.slice(0, low)}…` : '…';
}

function drawSummary(doc, items) {
  if (!items.length) return;

  const gap = 10;
  const boxWidth = (CONTENT_WIDTH - gap * (items.length - 1)) / items.length;
  const boxHeight = 40;
  let x = MARGIN_X;

  for (const item of items) {
    doc
      .roundedRect(x, CONTENT_TOP, boxWidth, boxHeight, 4)
      .fillAndStroke(COLORS.summaryBg, COLORS.line);

    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(COLORS.muted)
      .text(String(item.label).toUpperCase(), x + 9, CONTENT_TOP + 8, {
        width: boxWidth - 18,
        lineBreak: false,
      });

    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(COLORS.ink);
    doc.text(fitText(doc, item.value, boxWidth - 18), x + 9, CONTENT_TOP + 19, {
      width: boxWidth - 18,
      lineBreak: false,
    });

    x += boxWidth + gap;
  }

  doc.y = CONTENT_TOP + boxHeight + 14;
}

function drawTable(doc, meta, columns, rows, totals) {
  const headerHeight = 21;
  const rowHeight = 19;
  let y = doc.y;

  const startPage = () => {
    doc.addPage();
    drawHeader(doc, meta);
    y = CONTENT_TOP;
  };

  const drawHeaderRow = () => {
    doc.rect(MARGIN_X, y, CONTENT_WIDTH, headerHeight).fill(COLORS.headerBg);

    let x = MARGIN_X;
    doc.font('Helvetica-Bold').fontSize(7.2).fillColor(COLORS.muted);
    for (const column of columns) {
      doc.text(column.label.toUpperCase(), x + 6, y + 7, {
        width: column.width - 12,
        align: column.align ?? 'left',
        lineBreak: false,
      });
      x += column.width;
    }
    y += headerHeight;
  };

  if (y + headerHeight + rowHeight > CONTENT_BOTTOM) {
    startPage();
  }
  drawHeaderRow();

  if (rows.length === 0) {
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(COLORS.muted)
      .text('No data for this period.', MARGIN_X + 6, y + 8, { lineBreak: false });
    y += rowHeight + 8;
  }

  rows.forEach((row, index) => {
    if (y + rowHeight > CONTENT_BOTTOM) {
      startPage();
      drawHeaderRow();
    }

    if (index % 2 === 1) {
      doc.rect(MARGIN_X, y, CONTENT_WIDTH, rowHeight).fill(COLORS.rowAlt);
    }

    let x = MARGIN_X;
    for (const column of columns) {
      doc.font('Helvetica').fontSize(8).fillColor(COLORS.body);
      const text = fitText(doc, column.value(row), column.width - 12);
      doc.text(text, x + 6, y + 5.5, {
        width: column.width - 12,
        align: column.align ?? 'left',
        lineBreak: false,
      });
      x += column.width;
    }

    y += rowHeight;
  });

  if (totals) {
    if (y + rowHeight + 4 > CONTENT_BOTTOM) {
      startPage();
      drawHeaderRow();
    }

    doc
      .moveTo(MARGIN_X, y)
      .lineTo(PAGE_WIDTH - MARGIN_X, y)
      .lineWidth(0.9)
      .strokeColor(COLORS.ink)
      .stroke();
    doc.rect(MARGIN_X, y + 0.9, CONTENT_WIDTH, rowHeight).fill(COLORS.totalBg);

    let x = MARGIN_X;
    for (const column of columns) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.ink);
      const text = fitText(doc, column.value(totals), column.width - 12);
      doc.text(text, x + 6, y + 6, {
        width: column.width - 12,
        align: column.align ?? 'left',
        lineBreak: false,
      });
      x += column.width;
    }

    y += rowHeight;
  }

  doc.y = y + 12;
}

function columnsFor(report, rows, totals) {
  if (report === 'visits') {
    const total = totals.total || 0;
    return [
      { label: 'Service', width: 285, value: (row) => row.serviceName },
      { label: 'Visits', width: 90, align: 'right', value: (row) => row.count },
      {
        label: 'Share',
        width: 130,
        align: 'right',
        value: (row) => (total > 0 ? `${((row.count / total) * 100).toFixed(1)}%` : '0%'),
      },
    ];
  }

  if (report === 'status') {
    return [
      { label: 'Service', width: 169, value: (row) => row.serviceName },
      ...STATUS_COLUMNS.map((column) => ({
        label: column.label,
        width: column.width,
        align: 'right',
        value: (row) => row[column.key] ?? 0,
      })),
    ];
  }

  return [
    { label: 'Patient', width: 120, value: (row) => row.name },
    { label: 'Age / sex', width: 52, value: (row) => row.ageSex },
    { label: 'Address', width: 127, value: (row) => row.address },
    { label: 'Contact', width: 80, value: (row) => row.contactNumber },
    { label: 'Household #', width: 66, value: (row) => row.householdNumber },
    { label: 'Last visit', width: 60, value: (row) => row.lastVisit },
  ];
}

function summaryFor(report, rows, totals) {
  if (report === 'visits') {
    const busiest = rows[0];
    return [
      { label: 'Total visits', value: totals.total ?? 0 },
      { label: 'Services used', value: rows.length },
      { label: 'Busiest service', value: busiest ? busiest.serviceName : '—' },
    ];
  }

  if (report === 'status') {
    return [
      { label: 'Appointments', value: totals.total ?? 0 },
      { label: 'Completed', value: totals.completed ?? 0 },
      { label: 'Pending review', value: totals.pending ?? 0 },
    ];
  }

  return [
    { label: 'Patients', value: totals.total ?? 0 },
    { label: 'New in period', value: totals.newInPeriod ?? 0 },
    { label: 'Seen in period', value: totals.seenInPeriod ?? 0 },
  ];
}

export function streamReportPdf(res, { report, meta, rows, totals }) {
  const doc = new PDFDocument({
    size: 'A4',
    bufferPages: true,
    margins: { top: 40, bottom: 60, left: MARGIN_X, right: MARGIN_X },
    info: {
      Title: meta.title,
      Author: CLINIC_NAME,
      Subject: `${meta.title} — ${meta.period}`,
      Creator: `${CLINIC_NAME} reports`,
    },
  });

  doc.pipe(res);

  drawHeader(doc, meta);
  doc.y = CONTENT_TOP;
  drawSummary(doc, summaryFor(report, rows, totals));

  const columns = columnsFor(report, rows, totals);
  drawTable(doc, meta, columns, rows, totals);
  drawFooters(doc);

  doc.end();
}
