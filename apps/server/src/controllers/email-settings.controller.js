import mongoose from 'mongoose';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { EMAIL_SETTINGS_KEY, EmailSetting } from '../models/email-setting.model.js';
import { User } from '../models/user.model.js';
import { logActivity } from '../services/activity.js';
import { isSmtpConfigured, resolveEmailConfig } from '../utils/email-credentials.js';
import { sendTestEmail } from '../utils/email.js';
import { maskEmail } from '../utils/masking.js';
import { encryptSecret } from '../utils/secret-crypto.js';

function requireDB(res) {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({ success: false, message: 'Database is not connected. Try again later.' });
    return false;
  }
  return true;
}

function present(config, doc) {
  return {
    host: config.host,
    port: config.port,
    userMasked: maskEmail(config.user),
    passwordSet: Boolean(config.pass),
    fromAddress: config.from,
    source: config.source,
    configured: isSmtpConfigured(config),
    lastTestedAt: doc?.lastTestedAt ?? null,
    lastTestOk: doc?.lastTestOk ?? null,
    lastTestError: doc?.lastTestError ?? '',
  };
}

async function currentSettings() {
  const [config, doc] = await Promise.all([
    resolveEmailConfig(),
    EmailSetting.findOne({ key: EMAIL_SETTINGS_KEY }).lean(),
  ]);
  return { config, doc };
}

function validationError(res, field, message) {
  return res.status(400).json({ success: false, message: 'Validation failed.', errors: { [field]: [message] } });
}

/** GET /api/admin/settings/email — masked view of the active SMTP settings. */
export const getEmailSettings = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;
  const { config, doc } = await currentSettings();
  res.json({ success: true, ...present(config, doc) });
});

const updateSchema = z.object({
  host: z.string().trim().max(255).optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  user: z.string().trim().max(320).optional(),
  password: z.string().max(1024).optional(),
  fromAddress: z.string().trim().max(320).optional(),
});

/**
 * PUT /api/admin/settings/email — replace one or more SMTP values.
 *
 * Blank inputs (or the exact masked value shown in the UI) mean "keep the
 * current value", so the browser never needs the stored password.
 */
export const updateEmailSettings = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ success: false, message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors });
  }

  const { config: current, doc: stored } = await currentSettings();
  const submitted = parsed.data;

  const submittedUser = submitted.user ?? '';
  const submittedPassword = submitted.password ?? '';
  const submittedFrom = submitted.fromAddress ?? '';

  // A masked value means the admin did not retype it.
  const newUser = submittedUser && submittedUser !== maskEmail(current.user) ? submittedUser : '';
  const newPassword = submittedPassword || '';
  const newFrom = submittedFrom && submittedFrom !== current.from ? submittedFrom : '';

  const nextHost = (submitted.host ?? '').trim() || current.host;
  const nextPort = submitted.port ?? current.port;
  const nextUser = newUser || current.user;
  const nextPassword = newPassword || current.pass;
  const nextFrom = newFrom || stored?.fromAddress || '';

  if (!nextHost) return validationError(res, 'host', 'SMTP host is required.');
  if (!/^[a-z0-9.-]+$/i.test(nextHost)) {
    return validationError(res, 'host', 'Enter a hostname such as smtp-relay.brevo.com.');
  }
  if (!nextUser) return validationError(res, 'user', 'SMTP username is required.');
  if (!nextPassword) return validationError(res, 'password', 'SMTP password or API key is required.');
  if (newFrom && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newFrom)) {
    return validationError(res, 'fromAddress', 'Enter a valid sender address.');
  }

  let passwordEncrypted;
  try {
    passwordEncrypted = encryptSecret(nextPassword);
  } catch {
    return res.status(500).json({
      success: false,
      message:
        'SETTINGS_ENCRYPTION_KEY is missing or invalid. Add a 64-character hex key to apps/server/.env and restart the API.',
    });
  }

  const doc = await EmailSetting.findOneAndUpdate(
    { key: EMAIL_SETTINGS_KEY },
    {
      $set: {
        host: nextHost,
        port: nextPort,
        user: nextUser,
        passwordEncrypted,
        fromAddress: nextFrom,
        updatedBy: req.user.id,
        // A new configuration invalidates the previous test result.
        lastTestedAt: null,
        lastTestOk: null,
        lastTestError: '',
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
  ).lean();

  await logActivity({
    req,
    action: 'settings.email.update',
    target: { type: 'integration', id: EMAIL_SETTINGS_KEY, label: 'Email delivery' },
    changes: [
      ['source', current.source, 'custom'],
      ...(nextHost !== current.host ? [['host', current.host, nextHost]] : []),
      ...(nextPort !== current.port ? [['port', String(current.port), String(nextPort)]] : []),
      ...(nextUser !== current.user ? [['user', '', 'changed']] : []),
      // The value is never recorded — only that it was rotated.
      ...(newPassword ? [['password', '', 'changed']] : []),
      ...(newFrom ? [['fromAddress', current.from, newFrom]] : []),
    ],
    detail: `SMTP settings saved (source ${current.source} → custom).`,
  });

  res.json({
    success: true,
    ...present(
      {
        host: nextHost,
        port: nextPort,
        user: nextUser,
        pass: nextPassword,
        from: nextFrom || current.from,
        source: 'custom',
      },
      doc,
    ),
  });
});

/** DELETE /api/admin/settings/email — drop custom settings and use .env again. */
export const deleteEmailSettings = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;

  const removed = await EmailSetting.findOneAndDelete({ key: EMAIL_SETTINGS_KEY });

  if (removed) {
    await logActivity({
      req,
      action: 'settings.email.reset',
      target: { type: 'integration', id: EMAIL_SETTINGS_KEY, label: 'Email delivery' },
      changes: [['source', 'custom', 'default']],
      detail: 'Custom SMTP settings removed; environment defaults are active again.',
    });
  }

  const { config } = await currentSettings();
  res.json({ success: true, ...present(config, null) });
});

const testSchema = z.object({
  to: z.string().trim().toLowerCase().email('Enter a valid email address.').optional(),
});

/** POST /api/admin/settings/email/test — verify the connection and send one message. */
export const testEmailSettings = asyncHandler(async (req, res) => {
  if (!requireDB(res)) return;

  const parsed = testSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed.',
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  // Default recipient: the signed-in admin, so nobody has to type their own address.
  let recipient = parsed.data.to ?? '';
  if (!recipient) {
    const admin = await User.findById(req.user.id).select('email').lean();
    recipient = String(admin?.email ?? '').trim().toLowerCase();
  }
  if (!recipient) {
    return res.status(400).json({ success: false, message: 'Enter an address to send the test to.' });
  }

  const { doc } = await currentSettings();

  try {
    const result = await sendTestEmail(recipient);
    if (doc) {
      await EmailSetting.updateOne(
        { key: EMAIL_SETTINGS_KEY },
        { $set: { lastTestedAt: new Date(), lastTestOk: true, lastTestError: '' } },
      );
    }
    await logActivity({
      req,
      action: 'settings.email.test',
      target: { type: 'integration', id: EMAIL_SETTINGS_KEY, label: 'Email delivery' },
      detail: `Test email sent to ${recipient} via ${result.source} SMTP.`,
    });
    return res.json({
      success: true,
      to: recipient,
      message: `Test email sent to ${recipient}. Check the inbox (and spam folder).`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error('SMTP test failed:', message);

    if (doc) {
      await EmailSetting.updateOne(
        { key: EMAIL_SETTINGS_KEY },
        { $set: { lastTestedAt: new Date(), lastTestOk: false, lastTestError: message.slice(0, 500) } },
      );
    }

    if (error?.code === 'SMTP_NOT_CONFIGURED') {
      return res.status(400).json({ success: false, message });
    }

    return res.status(502).json({
      success: false,
      message: `Could not send the test email: ${message}`,
    });
  }
});
