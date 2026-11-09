import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { AppSettings, SETTINGS_KEY, isGoogleSheetsEnabled } from '../models/app-settings.model.js';
import { getServiceAccountToken, isServiceAccountConfigured, serviceAccountConfig } from './google-service-account.js';

/**
 * Google Sheets export. One spreadsheet (owned by a person, shared with the
 * service account as Editor) receives every export as a new tab. The service
 * account cannot own files (it has no Drive storage), so it never creates
 * spreadsheets, only tabs inside this one.
 *
 * Spreadsheet ID: custom value saved in Settings (AppSettings) first, then
 * DEFAULT_GOOGLE_SHEETS_SPREADSHEET_ID from .env.
 */

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_TAB_TITLE = 90;

/** Accepts a bare ID or a full spreadsheet URL; returns the ID or ''. */
export function extractSpreadsheetId(value) {
  const text = String(value ?? '').trim();
  const fromUrl = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
  if (fromUrl) return fromUrl[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(text) ? text : '';
}

export async function resolveSheetsConfig() {
  let custom = '';
  if (mongoose.connection.readyState === 1) {
    const doc = await AppSettings.findOne({ key: SETTINGS_KEY }).select('googleSheetsSpreadsheetId').lean();
    custom = String(doc?.googleSheetsSpreadsheetId ?? '').trim();
  }
  const fallback = extractSpreadsheetId(env.GOOGLE_SHEETS_SPREADSHEET_ID);
  return {
    spreadsheetId: custom || fallback,
    source: custom ? 'custom' : 'default',
    defaultSet: Boolean(fallback),
    serviceAccountEmail: serviceAccountConfig().email,
    serviceAccountConfigured: isServiceAccountConfigured(),
  };
}

function spreadsheetUrl(spreadsheetId, sheetId) {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit${sheetId !== undefined ? `#gid=${sheetId}` : ''}`;
}

/** Turns Google's error into something an admin can act on. */
function explain(status, detail, serviceAccountEmail) {
  if (status === 403) {
    return `The service account can't edit this spreadsheet. Share it with ${serviceAccountEmail || 'the service account'} as Editor.`;
  }
  if (status === 404) return 'Spreadsheet not found. Check the spreadsheet ID.';
  return `Google Sheets request failed (${status})${detail ? `: ${detail.slice(0, 160)}` : '.'}`;
}

async function sheetsRequest(method, path, { body, query } = {}) {
  const serviceAccountEmail = serviceAccountConfig().email;
  const token = await getServiceAccountToken(SCOPE);
  const url = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`Could not reach Google Sheets (${error?.name === 'TimeoutError' ? 'timeout' : 'network error'}).`);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = String(data?.error?.message ?? '');
    // The API-disabled case also comes back as 403; check it first.
    if (/has not been used|is disabled/i.test(detail)) {
      throw new Error('The Google Sheets API is not enabled in the Google Cloud project. Enable it, wait a minute, and try again.');
    }
    throw new Error(explain(response.status, detail, serviceAccountEmail));
  }
  return data;
}

function requireConfigured(config) {
  if (!config.serviceAccountConfigured) {
    throw new Error('Google Sheets needs the Google service account (GOOGLE_SERVICE_ACCOUNT_EMAIL / _PRIVATE_KEY in .env).');
  }
  if (!config.spreadsheetId) {
    throw new Error('Google Sheets is not set up: no spreadsheet ID. Add one in Settings or in .env.');
  }
}

/** Sheet titles can't contain these, and must be unique within the spreadsheet. */
function safeTabTitle(title, existing) {
  const base = title.replace(/[[\]:*?/\\']/g, '-').slice(0, MAX_TAB_TITLE).trim() || 'Export';
  let candidate = base;
  for (let n = 2; existing.has(candidate.toLowerCase()); n += 1) candidate = `${base} (${n})`;
  return candidate;
}

/**
 * Proves the service account can open and edit the spreadsheet: reads its
 * title, then adds and deletes a temporary tab.
 */
export async function testSheetsAccess(spreadsheetId) {
  const config = await resolveSheetsConfig();
  const id = spreadsheetId ?? config.spreadsheetId;
  requireConfigured({ ...config, spreadsheetId: id });
  const meta = await sheetsRequest('GET', `/${id}`, { query: { fields: 'properties.title' } });
  const added = await sheetsRequest('POST', `/${id}:batchUpdate`, {
    body: { requests: [{ addSheet: { properties: { title: `HealthCentria test ${Date.now()}` } } }] },
  });
  const sheetId = added?.replies?.[0]?.addSheet?.properties?.sheetId;
  if (sheetId !== undefined) {
    await sheetsRequest('POST', `/${id}:batchUpdate`, { body: { requests: [{ deleteSheet: { sheetId } }] } });
  }
  return { spreadsheetId: id, title: meta?.properties?.title ?? '', url: spreadsheetUrl(id) };
}

/** Clinic name printed in the header of every export (and later every PDF). */
export function clinicName() {
  return (
    String(env.CLINIC_NAME ?? '').trim() ||
    String(env.GOOGLE_CALENDAR_LOCATION ?? '').trim() ||
    'Barangay 11 Health Center'
  );
}

/** "November 9, 2026, 2:32 PM (Asia/Manila)" for the footer. */
export function footerTimestamp(date = new Date()) {
  const timeZone = env.GOOGLE_CALENDAR_TIMEZONE || 'Asia/Manila';
  const text = new Intl.DateTimeFormat('en-PH', {
    timeZone,
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(date);
  return `${text} (${timeZone})`;
}

const TEAL = { red: 0.05, green: 0.46, blue: 0.43 };
const GRAY = { red: 0.4, green: 0.45, blue: 0.5 };
const HEADER_ROWS = 3; // clinic name, report title, details

/**
 * Writes one export as a new tab laid out like a printed report:
 *
 *   Header  ─ clinic name / report title / details (merged across the columns)
 *   Columns ─ teal, bold, frozen with the header so it stays visible on scroll
 *   Body    ─ the data rows
 *   Footer  ─ "Generated: <timestamp>" under a blank spacer row
 *
 * Returns a link straight to the new tab.
 *
 * @param {{ tabTitle: string, title: string, details: string, header: string[], rows: unknown[][] }} input
 */
export async function exportToSheet({ tabTitle, title, details, header, rows }) {
  if (!(await isGoogleSheetsEnabled())) {
    throw new Error('Google Sheets export is turned off by an admin. Use Export CSV instead.');
  }
  const config = await resolveSheetsConfig();
  requireConfigured(config);
  const id = config.spreadsheetId;

  const meta = await sheetsRequest('GET', `/${id}`, { query: { fields: 'sheets.properties.title' } });
  const existing = new Set((meta?.sheets ?? []).map((s) => String(s.properties?.title ?? '').toLowerCase()));
  const tab = safeTabTitle(tabTitle, existing);
  const columnCount = Math.max(header.length, 1);

  // Row positions (0-based): header block, column row, body, spacer, footer.
  const columnRow = HEADER_ROWS;
  const bodyStart = columnRow + 1;
  const footerRow = bodyStart + rows.length + 1;
  const totalRows = footerRow + 1;

  const added = await sheetsRequest('POST', `/${id}:batchUpdate`, {
    body: {
      requests: [
        {
          addSheet: {
            properties: {
              title: tab,
              gridProperties: { rowCount: totalRows, columnCount, frozenRowCount: bodyStart },
            },
          },
        },
      ],
    },
  });
  const sheetId = added?.replies?.[0]?.addSheet?.properties?.sheetId;

  const cell = (v) => (v === null || v === undefined ? '' : typeof v === 'number' ? v : String(v));
  await sheetsRequest('PUT', `/${id}/values/${encodeURIComponent(`'${tab}'!A1`)}`, {
    query: { valueInputOption: 'RAW' },
    body: {
      values: [
        [clinicName()],
        [title],
        [details],
        header.map(cell),
        ...rows.map((r) => r.map(cell)),
        [],
        [`Generated: ${footerTimestamp()}`],
      ],
    },
  });

  const fullRow = (row) => ({
    sheetId,
    startRowIndex: row,
    endRowIndex: row + 1,
    startColumnIndex: 0,
    endColumnIndex: columnCount,
  });
  const text = (row, textFormat, extra = {}) => ({
    repeatCell: {
      range: fullRow(row),
      cell: { userEnteredFormat: { textFormat, ...extra } },
      fields: `userEnteredFormat(textFormat${Object.keys(extra).length ? `,${Object.keys(extra).join(',')}` : ''})`,
    },
  });
  // Merging needs at least two columns; single-column reports just skip it.
  const merge = (row) =>
    columnCount > 1 ? [{ mergeCells: { range: fullRow(row), mergeType: 'MERGE_ALL' } }] : [];

  // Formatting is cosmetic: if it fails, the data is already written.
  await sheetsRequest('POST', `/${id}:batchUpdate`, {
    body: {
      requests: [
        // Header block
        ...merge(0),
        ...merge(1),
        ...merge(2),
        text(0, { bold: true, fontSize: 14, foregroundColor: TEAL }),
        text(1, { bold: true, fontSize: 12 }),
        text(2, { italic: true, foregroundColor: GRAY }),
        // Column header row
        text(
          columnRow,
          { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
          { backgroundColor: TEAL },
        ),
        // Footer: separated from the data by a top border on the spacer row.
        ...merge(footerRow),
        text(footerRow, { italic: true, fontSize: 9, foregroundColor: GRAY }),
        {
          updateBorders: {
            range: fullRow(footerRow - 1),
            top: { style: 'SOLID', color: { red: 0.8, green: 0.83, blue: 0.86 } },
          },
        },
        {
          autoResizeDimensions: {
            dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: columnCount },
          },
        },
      ],
    },
  }).catch(() => {});

  return { url: spreadsheetUrl(id, sheetId), tab, rows: rows.length };
}

/** "Visits 2026-11-09 14.32" in the clinic's timezone (colons aren't allowed in tab titles). */
export function exportStamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: env.GOOGLE_CALENDAR_TIMEZONE || 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}.${get('minute')}`;
}
