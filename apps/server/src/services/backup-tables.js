import fsp from 'node:fs/promises';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';

const gunzipAsync = promisify(gunzip);

/**
 * Reads a backup snapshot (.json.gz) and turns each table into flat rows that
 * the CSV, Google Sheets and PDF exports share.
 *
 * Secrets (password hashes, tokens, encrypted keys, one-time codes) are shown
 * as "(hidden)". The rows still hold personal and medical data, so the exports
 * are gated by the superadmin PIN.
 */

const SENSITIVE_KEY = /hash|secret|token|password|apikey|private|credential|encrypted|iv$|tag$/i;
const MAX_CELL_CHARS = 32000;
const OBJECT_ID = /^[0-9a-f]{24}$/i;

function flatten(value, prefix, out) {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    if (value.every((v) => v === null || typeof v !== 'object')) {
      out[prefix] = value.join('; ');
    } else {
      out[prefix] = value
        .map((v) =>
          v && typeof v === 'object'
            ? Object.entries(v)
                .map(([k, x]) => `${k}: ${x && typeof x === 'object' ? JSON.stringify(x) : x}`)
                .join(', ')
            : String(v),
        )
        .join(' | ');
    }
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
    return;
  }
  out[prefix] = value;
}

function readable(value) {
  let s = String(value);
  // 2026-11-15T20:30:00.000Z -> 2026-11-15 20:30:00
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s)) {
    s = s.replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');
  }
  return s.length > MAX_CELL_CHARS ? `${s.slice(0, MAX_CELL_CHARS)}…` : s;
}

/** @returns {{ columns: string[], rows: Record<string, string>[] }} */
function toTable(docs) {
  const rows = docs.map((doc) => {
    const flat = {};
    flatten(doc, '', flat);
    const clean = {};
    for (const [key, value] of Object.entries(flat)) {
      if (key === '__v') continue;
      clean[key] = SENSITIVE_KEY.test(key) ? '(hidden)' : readable(value);
    }
    return clean;
  });
  const columns = [];
  const seen = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  return { columns, rows };
}

/**
 * @returns {Promise<{ createdAt: string, database: string, tables: Map<string, { columns: string[], rows: Record<string, string>[] }> }>}
 */
export async function readBackupTables(filePath) {
  const raw = await fsp.readFile(filePath);
  const data = JSON.parse((await gunzipAsync(raw)).toString('utf8'));
  const tables = new Map();
  for (const [name, docs] of Object.entries(data.collections ?? {})) {
    if (Array.isArray(docs)) tables.set(name, toTable(docs));
  }
  return { createdAt: data.createdAt ?? '', database: data.database ?? '', tables };
}

/** The handful of columns that read well in a PDF: skip ids and internals. */
export function pdfColumns(table, max = 8) {
  const useful = table.columns.filter((column) => {
    if (column === '_id' || column.endsWith('._id')) return false;
    const sample = table.rows.map((r) => r[column]).find((v) => v);
    return !(sample && OBJECT_ID.test(sample));
  });
  return useful.slice(0, max);
}

function csvCell(value) {
  const s = value === undefined || value === null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV text with a BOM so Excel reads accents correctly. */
export function tableToCsv(table) {
  const lines = [table.columns.map(csvCell).join(',')];
  for (const row of table.rows) lines.push(table.columns.map((c) => csvCell(row[c])).join(','));
  return `﻿${lines.join('\r\n')}`;
}
