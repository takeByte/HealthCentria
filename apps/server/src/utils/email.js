import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import { env } from '../config/env.js';
import { isSmtpConfigured, resolveEmailConfig } from './email-credentials.js';

let resendClient = null;

function getResend() {
  if (!env.RESEND_API_KEY) return null;
  if (!resendClient) resendClient = new Resend(env.RESEND_API_KEY);
  return resendClient;
}

/**
 * Build a transport for one message. Creating it per send keeps admin changes
 * in Settings effective immediately and avoids a stale pooled connection.
 */
export function createSmtpTransport(config) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    // Port 465 is implicit TLS; 587 (and friends) upgrade with STARTTLS.
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

function errorMessage(err) {
  return err instanceof Error ? err.message : String(err ?? 'unknown error');
}

/**
 * Sends a plain-text email through SMTP when it is configured, otherwise
 * through Resend when RESEND_API_KEY is set.
 *
 * Kept readable on phones and old clients. Never throws — callers must not fail
 * a request on email errors (a reset code is still valid in the database).
 */
export async function sendEmail(to, subject, text) {
  const config = await resolveEmailConfig();

  if (isSmtpConfigured(config)) {
    try {
      await createSmtpTransport(config).sendMail({
        from: config.from,
        to: Array.isArray(to) ? to.join(', ') : to,
        subject,
        text,
      });
      return { sent: true, transport: 'smtp', source: config.source };
    } catch (err) {
      console.error('SMTP send failed:', errorMessage(err));
      return { failed: true, error: errorMessage(err) };
    }
  }

  const resend = getResend();
  if (!resend) {
    console.warn(
      `Email skipped (no SMTP_* or RESEND_API_KEY): "${subject}" → ${Array.isArray(to) ? to.length : 1} recipient(s).`,
    );
    return { skipped: true };
  }

  try {
    await resend.emails.send({ from: config.from, to, subject, text });
    return { sent: true, transport: 'resend', source: 'resend' };
  } catch (err) {
    console.error('Resend send failed:', errorMessage(err));
    return { failed: true, error: errorMessage(err) };
  }
}

/**
 * Verify the resolved SMTP connection and send one test message. Throws with
 * the provider's message so the admin UI can show something actionable.
 */
export async function sendTestEmail(to) {
  const config = await resolveEmailConfig();
  if (!isSmtpConfigured(config)) {
    const err = new Error('SMTP is not configured. Save a host, username, and password first.');
    err.code = 'SMTP_NOT_CONFIGURED';
    throw err;
  }

  const transport = createSmtpTransport(config);
  await transport.verify();
  const info = await transport.sendMail({
    from: config.from,
    to,
    subject: 'E-Kalinga email test',
    text: [
      'This is a test message from your E-Kalinga server.',
      '',
      'If you received it, password reset codes and announcements will be delivered.',
      '',
      '— E-Kalinga Barangay Health Center',
    ].join('\n'),
  });

  return {
    accepted: Array.isArray(info.accepted) ? info.accepted.map(String) : [],
    messageId: info.messageId ?? '',
    source: config.source,
    from: config.from,
  };
}

export function announcementEmailText(a) {
  return `${a.title}\n\n${a.body}\n\n— E-Kalinga Barangay Health Center`;
}
