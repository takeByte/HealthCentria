import mongoose from 'mongoose';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppSettings, SETTINGS_KEY } from '../models/app-settings.model.js';
import { logActivity } from '../services/activity.js';
import { extractSpreadsheetId, resolveSheetsConfig, testSheetsAccess } from '../services/google-sheets.js';

function requireDB(res) {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({ success: false, message: 'Database is not connected. Try again later.' });
    return false;
  }
  return true;
}

async function present() {
  const config = await resolveSheetsConfig();
  return {
    configured: Boolean(config.spreadsheetId && config.serviceAccountConfigured),
    spreadsheetId: config.spreadsheetId,
    spreadsheetUrl: config.spreadsheetId ? `https://docs.google.com/spreadsheets/d/${config.spreadsheetId}/edit` : '',
    source: config.source,
    defaultSet: config.defaultSet,
    serviceAccountEmail: config.serviceAccountEmail,
    serviceAccountConfigured: config.serviceAccountConfigured,
  };
}

/** GET /api/admin/settings/google-sheets */
export const getSheetsSettings = asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await present()) });
});

const updateSchema = z.object({
  spreadsheetId: z.string().trim().min(1, 'Paste the spreadsheet ID or link.').max(300),
});

/**
 * PUT /api/admin/settings/google-sheets — superadmin PIN required (route).
 * The new spreadsheet is tested (open + add/delete a tab) before it is saved,
 * so a typo or a missing share can't break exports.
 */
export const updateSheetsSettings = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }
  const spreadsheetId = extractSpreadsheetId(parsed.data.spreadsheetId);
  if (!spreadsheetId) {
    return res.status(400).json({
      success: false,
      message: 'That does not look like a spreadsheet ID or link.',
      errors: { spreadsheetId: ['Paste the ID between /d/ and /edit, or the whole spreadsheet link.'] },
    });
  }

  let tested;
  try {
    tested = await testSheetsAccess(spreadsheetId);
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : 'Could not open the spreadsheet.',
      errors: { spreadsheetId: [error instanceof Error ? error.message : 'Could not open the spreadsheet.'] },
    });
  }

  const before = await resolveSheetsConfig();
  await AppSettings.findOneAndUpdate(
    { key: SETTINGS_KEY },
    { $set: { googleSheetsSpreadsheetId: spreadsheetId } },
    { upsert: true, setDefaultsOnInsert: true },
  );
  await logActivity({
    req,
    action: 'settings.sheets.update',
    target: { type: 'settings', id: 'google-sheets', label: 'Google Sheets' },
    changes: [['spreadsheetId', before.spreadsheetId, spreadsheetId]],
    detail: `Export spreadsheet set to "${tested.title || spreadsheetId}" (tested before saving).`,
  });
  res.json({ success: true, ...(await present()) });
});

/** DELETE /api/admin/settings/google-sheets — back to the .env default. PIN required (route). */
export const resetSheetsSettings = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const before = await resolveSheetsConfig();
  await AppSettings.findOneAndUpdate({ key: SETTINGS_KEY }, { $set: { googleSheetsSpreadsheetId: '' } });
  const after = await present();
  await logActivity({
    req,
    action: 'settings.sheets.reset',
    target: { type: 'settings', id: 'google-sheets', label: 'Google Sheets' },
    changes: [['spreadsheetId', before.spreadsheetId, after.spreadsheetId]],
    detail: 'Export spreadsheet reset to the .env default.',
  });
  res.json({ success: true, ...after });
});

/** POST /api/admin/settings/google-sheets/test — read + write check, saves nothing. */
export const testSheetsSettings = asyncHandler(async (req, res) => {
  try {
    const tested = await testSheetsAccess();
    res.json({ success: true, title: tested.title, url: tested.url });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : 'Could not open the spreadsheet.',
    });
  }
});
