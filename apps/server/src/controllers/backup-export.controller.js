import fsp from 'node:fs/promises';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { User } from '../models/user.model.js';
import { logActivity } from '../services/activity.js';
import { backupPath, isValidBackupName } from '../services/backup.js';
import { pdfColumns, readBackupTables, tableToCsv } from '../services/backup-tables.js';
import { deliverPdf, describeDelivery, recipientsSchema, sendPdfResponse } from '../services/export-delivery.js';
import { exportStamp, exportToSheet, footerTimestamp } from '../services/google-sheets.js';
import { buildReportPdf } from '../services/pdf-report.js';
import { createZip } from '../services/zip.js';

/**
 * Exports of one backup snapshot: CSV (a ZIP with one file per table), Google
 * Sheets (one tab per table) and PDF (with the optional Drive upload), the same
 * three options as the Activity log and Reports. The admin picks the tables.
 *
 * These copy patient data out of the system, so the routes sit behind the
 * superadmin PIN (see admin-settings.routes.js).
 */

const SHEETS_ROW_CAP = 10000;
const PDF_ROW_CAP = 500;

const tablesSchema = z.object({
  tables: z.array(z.string().min(1).max(80)).min(1, 'Pick at least one table.').max(40),
});

/** Finds the snapshot, reads its tables and sends the error response itself when it can't. */
async function openBackup(req, res) {
  const { name } = req.params;
  if (!isValidBackupName(name)) {
    res.status(404).json({ success: false, message: 'Backup file not found.' });
    return null;
  }
  const target = backupPath(name);
  try {
    await fsp.access(target);
  } catch {
    res.status(404).json({ success: false, message: 'Backup file not found.' });
    return null;
  }
  try {
    return { name, backup: await readBackupTables(target) };
  } catch {
    res.status(500).json({ success: false, message: 'Could not read this backup file.' });
    return null;
  }
}

/** The requested tables that exist and have records, in the order asked. */
function pickTables(req, res, backup) {
  const parsed = tablesSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: parsed.error.issues[0]?.message ?? 'Pick at least one table.',
    });
    return null;
  }
  const picked = [...new Set(parsed.data.tables)]
    .map((tableName) => [tableName, backup.tables.get(tableName)])
    .filter(([, table]) => table && table.rows.length > 0);
  if (!picked.length) {
    res.status(400).json({ success: false, message: 'None of the chosen tables have records.' });
    return null;
  }
  return picked;
}

/** GET /api/admin/settings/backup/:name/tables — what the export picker lists. */
export const listBackupTables = asyncHandler(async (req, res) => {
  const opened = await openBackup(req, res);
  if (!opened) return;
  res.json({
    success: true,
    createdAt: opened.backup.createdAt,
    tables: [...opened.backup.tables.entries()].map(([tableName, table]) => ({
      name: tableName,
      count: table.rows.length,
    })),
  });
});

/** POST .../backup/:name/export/csv — a ZIP with one CSV per chosen table. */
export const exportBackupCsv = asyncHandler(async (req, res) => {
  const opened = await openBackup(req, res);
  if (!opened) return;
  const picked = pickTables(req, res, opened.backup);
  if (!picked) return;

  const zip = createZip(
    picked.map(([tableName, table]) => ({ name: `${tableName}.csv`, data: Buffer.from(tableToCsv(table), 'utf8') })),
  );
  const records = picked.reduce((sum, [, table]) => sum + table.rows.length, 0);
  await logActivity({
    req,
    action: 'settings.backup.export_csv',
    target: { type: 'system', id: opened.name, label: 'Backup file' },
    detail: `Backup ${opened.name} exported as CSV: ${picked.map(([n]) => n).join(', ')} (${records} records).`,
  });
  const fileName = `${opened.name.replace(/\.json\.gz$/, '')}-csv.zip`;
  res.set({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${fileName}"`,
  });
  res.send(zip);
});

/** POST .../backup/:name/export/sheets — one tab per chosen table in the export spreadsheet. */
export const exportBackupSheets = asyncHandler(async (req, res) => {
  const opened = await openBackup(req, res);
  if (!opened) return;
  const picked = pickTables(req, res, opened.backup);
  if (!picked) return;

  const actor = await User.findById(req.user.id).select('fullName').lean();
  const stamp = exportStamp();
  const tabs = [];
  let url = '';
  let total = 0;
  try {
    for (const [tableName, table] of picked) {
      const rows = table.rows.slice(0, SHEETS_ROW_CAP).map((r) => table.columns.map((c) => r[c] ?? ''));
      const result = await exportToSheet({
        tabTitle: `Backup ${tableName} ${stamp}`,
        title: `HealthCentria — Backup: ${tableName}`,
        details: `From ${opened.name} · ${rows.length} records${
          table.rows.length > rows.length ? ` (capped at ${SHEETS_ROW_CAP.toLocaleString('en-PH')})` : ''
        } · Exported by ${actor?.fullName || 'admin'}`,
        header: table.columns,
        rows,
      });
      tabs.push(result.tab);
      url = result.url;
      total += rows.length;
    }
  } catch (error) {
    return res.status(502).json({
      success: false,
      message: error instanceof Error ? error.message : 'Could not export to Google Sheets.',
    });
  }

  await logActivity({
    req,
    action: 'settings.backup.export_sheets',
    target: { type: 'system', id: opened.name, label: 'Backup file' },
    detail: `Backup ${opened.name} exported to Google Sheets: ${tabs.join(', ')} (${total} records).`,
  });
  res.json({ success: true, url, tab: tabs.join(', '), rows: total });
});

/** POST .../backup/:name/export/pdf — the chosen tables in one PDF; optional Drive upload and email. */
export const exportBackupPdf = asyncHandler(async (req, res) => {
  const opened = await openBackup(req, res);
  if (!opened) return;
  const recipients = recipientsSchema.safeParse(req.body ?? {});
  if (!recipients.success) return res.status(400).json({ success: false, message: 'Invalid recipients.' });
  const picked = pickTables(req, res, opened.backup);
  if (!picked) return;

  const actor = await User.findById(req.user.id).select('fullName').lean();
  const records = picked.reduce((sum, [, table]) => sum + table.rows.length, 0);
  const sections = picked.map(([tableName, table]) => {
    const columns = pdfColumns(table);
    const shown = table.rows.slice(0, PDF_ROW_CAP);
    const notes = [];
    if (table.rows.length > shown.length) notes.push(`Showing the first ${shown.length} of ${table.rows.length} records.`);
    if (columns.length < table.columns.length) {
      notes.push(`Showing ${columns.length} of ${table.columns.length} columns. Use CSV or Google Sheets for everything.`);
    }
    return {
      heading: `${tableName} (${table.rows.length} records)`,
      columns,
      rows: shown.map((r) => columns.map((c) => r[c] ?? '')),
      note: notes.join(' '),
    };
  });

  const details = `From ${opened.name} · Tables: ${picked.map(([n]) => n).join(', ')} · Exported by ${actor?.fullName || 'admin'}`;
  const buffer = await buildReportPdf({
    title: 'Backup data',
    details,
    summary: [
      { label: 'Tables', value: picked.length },
      { label: 'Records', value: records },
    ],
    sections,
    landscape: true,
  });

  const stamp = new Date().toISOString().slice(0, 10);
  const fileName = `healthcentria-backup-data-${stamp}.pdf`;
  const delivery = await deliverPdf({
    req,
    buffer,
    fileName,
    reportTitle: 'Backup data',
    details: `${details} · Generated ${footerTimestamp()}`,
    recipientIds: recipients.data.recipients,
    upload: recipients.data.uploadToDrive,
  });

  await logActivity({
    req,
    action: 'settings.backup.export_pdf',
    target: { type: 'system', id: opened.name, label: 'Backup file' },
    detail: `Backup ${opened.name} exported as PDF: ${picked.map(([n]) => n).join(', ')}. ${describeDelivery(delivery)}`,
  });
  sendPdfResponse(res, { buffer, fileName, delivery });
});
