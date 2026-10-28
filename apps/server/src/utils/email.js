import { Resend } from 'resend';
import { env } from '../config/env.js';

let client = null;
function getClient() {
  if (!env.RESEND_API_KEY) return null;
  if (!client) client = new Resend(env.RESEND_API_KEY);
  return client;
}

/** Plain-text email kept readable on phones and old clients. Never throws — callers must not fail a request on email errors. */
export async function sendEmail(to, subject, text) {
  const resend = getClient();
  if (!resend) {
    console.warn(`Email skipped (no RESEND_API_KEY): "${subject}" → ${Array.isArray(to) ? to.length : 1} recipient(s).`);
    return { skipped: true };
  }
  try {
    await resend.emails.send({ from: env.RESEND_FROM, to, subject, text });
    return { sent: true };
  } catch (err) {
    console.error('Resend send failed:', err instanceof Error ? err.message : err);
    return { failed: true };
  }
}

export function announcementEmailText(a) {
  return `${a.title}\n\n${a.body}\n\n— E-Kalinga Barangay Health Center`;
}
