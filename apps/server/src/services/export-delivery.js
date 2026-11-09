import mongoose from 'mongoose';
import { z } from 'zod';
import { env } from '../config/env.js';
import { User } from '../models/user.model.js';
import { sendEmail } from '../utils/email.js';
import { footerTimestamp } from './google-sheets.js';
import {
  getDriveRow,
  isDriveClientConfigured,
  isGoogleDriveEnabled,
  shareDriveFile,
  uploadToDrive,
} from './google-drive.js';

/**
 * After a PDF export: upload it to Google Drive, give the chosen people view
 * access, and email them the link. Recipients can only be active staff/admin
 * accounts picked by ID (never a typed address), plus SU_EMAIL, which is
 * always notified. Every step is best effort: the PDF download never fails
 * because Drive or email did.
 */

export const MAX_RECIPIENTS = 10;

export const recipientsSchema = z.object({
  recipients: z
    .array(z.string().refine((id) => mongoose.isValidObjectId(id), 'Invalid recipient.'))
    .max(MAX_RECIPIENTS, `Pick at most ${MAX_RECIPIENTS} people.`)
    .optional()
    .default([]),
  // Unticked in the export dialog: download only, no Drive upload or emails.
  uploadToDrive: z.boolean().optional().default(true),
});

function superadminEmail() {
  return String(env.SU_EMAIL ?? '').trim().toLowerCase();
}

/** Why Drive can't be used right now, or '' when it is ready. */
async function driveBlocker() {
  if (!(await isDriveClientConfigured())) return 'Google Drive is not set up on the server.';
  if (!(await isGoogleDriveEnabled())) return 'Google Drive uploads are turned off in Settings.';
  const row = await getDriveRow();
  if (!row?.refreshTokenEncrypted) return 'Google Drive is not connected.';
  if (row.needsReconnect) return 'The Google Drive connection expired. An admin needs to reconnect it.';
  return '';
}

/** People who can be picked as recipients: active staff and admins. */
export async function exportRecipientOptions() {
  const users = await User.find({ role: { $in: ['staff', 'admin'] }, active: true, deletedAt: null })
    .select('fullName email role')
    .sort({ role: 1, fullName: 1 })
    .lean();
  const blocker = await driveBlocker();
  const row = blocker ? null : await getDriveRow();
  return {
    recipients: users.map((u) => ({ id: String(u._id), name: u.fullName, email: u.email, role: u.role })),
    superadminNotified: Boolean(superadminEmail()),
    driveReady: !blocker,
    driveMessage: blocker,
    driveFolderName: row?.folderName ?? '',
  };
}

/** Validated recipient accounts (unknown, inactive or patient IDs are dropped). */
async function resolveRecipients(ids) {
  if (!ids.length) return [];
  return User.find({
    _id: { $in: ids },
    role: { $in: ['staff', 'admin'] },
    active: true,
    deletedAt: null,
  })
    .select('fullName email role')
    .lean();
}

/**
 * @returns {Promise<{
 *   drive: { status: 'uploaded' | 'skipped' | 'failed' | 'off', link: string, message: string },
 *   emailed: string[],
 *   recipientNames: string[],
 * }>}
 */
export async function deliverPdf({ req, buffer, fileName, reportTitle, details, recipientIds, upload = true }) {
  if (!upload) {
    return {
      drive: { status: 'off', link: '', message: 'Drive upload was not selected for this export.' },
      emailed: [],
      recipientNames: [],
    };
  }

  const [exporter, picked] = await Promise.all([
    User.findById(req.user.id).select('fullName email').lean(),
    resolveRecipients(recipientIds),
  ]);
  const exporterName = exporter?.fullName || 'A staff member';
  const recipientNames = picked.map((u) => u.fullName);

  const blocker = await driveBlocker();
  if (blocker) {
    return { drive: { status: 'skipped', link: '', message: blocker }, emailed: [], recipientNames };
  }

  let file;
  try {
    file = await uploadToDrive({
      name: fileName,
      mimeType: 'application/pdf',
      data: buffer,
      description: `${reportTitle}. ${details}. Exported by ${exporterName}.`,
    });
  } catch (error) {
    return {
      drive: { status: 'failed', link: '', message: error instanceof Error ? error.message : 'Upload failed.' },
      emailed: [],
      recipientNames,
    };
  }

  // Everyone who gets the email also needs view access to the file. The Drive
  // owner already has it; sharing failures don't stop the email.
  const row = await getDriveRow();
  const owner = String(row?.accountEmail ?? '').toLowerCase();
  const addresses = new Map();
  const su = superadminEmail();
  if (su) addresses.set(su, 'Superadmin');
  for (const u of picked) addresses.set(String(u.email).toLowerCase(), u.fullName);

  for (const email of addresses.keys()) {
    if (email === owner) continue;
    await shareDriveFile(file.id, email).catch((error) => {
      console.error('Drive share failed:', error instanceof Error ? error.message : 'unknown error');
    });
  }

  const when = footerTimestamp();
  const text = [
    `${exporterName} exported a report from HealthCentria.`,
    '',
    `Report: ${reportTitle}`,
    `Details: ${details}`,
    `Generated: ${when}`,
    '',
    `Open the PDF in Google Drive: ${file.webViewLink}`,
    '',
    'The file is private: it opens only for the Google account that matches this email address.',
    '— HealthCentria',
  ].join('\n');

  const emailed = [];
  for (const email of addresses.keys()) {
    // Sent directly (not notifyEmail): the exporter explicitly asked for it.
    sendEmail(email, `HealthCentria: ${reportTitle} PDF from ${exporterName}`, text).catch((error) => {
      console.error('Export email failed:', error instanceof Error ? error.message : 'unknown error');
    });
    emailed.push(email);
  }

  return {
    drive: { status: 'uploaded', link: file.webViewLink, message: '' },
    emailed,
    recipientNames,
  };
}

/** Sends the PDF with the delivery outcome in headers the web app reads. */
export function sendPdfResponse(res, { buffer, fileName, delivery }) {
  res.set('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('X-Drive-Status', delivery.drive.status);
  res.setHeader('X-Drive-Link', delivery.drive.link);
  res.setHeader('X-Drive-Message', encodeURIComponent(delivery.drive.message));
  res.setHeader('X-Emailed-Count', String(delivery.emailed.length));
  res.setHeader(
    'Access-Control-Expose-Headers',
    'Content-Disposition, X-Drive-Status, X-Drive-Link, X-Drive-Message, X-Emailed-Count',
  );
  res.send(buffer);
}

/** One line for the Activity log: Drive outcome and who was emailed. */
export function describeDelivery(delivery) {
  if (delivery.drive.status === 'off') return 'PDF exported (download only; not uploaded to Google Drive).';
  const drive =
    delivery.drive.status === 'uploaded'
      ? 'Uploaded to Google Drive'
      : delivery.drive.status === 'failed'
        ? `Drive upload failed (${delivery.drive.message})`
        : `Not uploaded to Drive (${delivery.drive.message})`;
  const to = delivery.recipientNames.length ? `; sent to ${delivery.recipientNames.join(', ')}` : '';
  const su = delivery.emailed.length ? ' and the superadmin' : '';
  return `PDF exported. ${drive}${delivery.drive.status === 'uploaded' ? `${to}${su}` : ''}.`;
}
