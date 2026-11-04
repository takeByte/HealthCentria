// Masking rules live here so they are easy to tune without touching routes.
export const MASK_CHARACTER = '•';
// Client ID: reveal the first half, mask the rest.
export const CLIENT_ID_VISIBLE_FRACTION = 0.5;
// Client Secret: reveal only the last few characters.
export const CLIENT_SECRET_VISIBLE_CHARS = 4;

export function maskClientId(value) {
  const text = typeof value === 'string' ? value : '';
  if (!text) return '';
  const visible = Math.ceil(text.length * CLIENT_ID_VISIBLE_FRACTION);
  return `${text.slice(0, visible)}${MASK_CHARACTER.repeat(text.length - visible)}`;
}

export function maskClientSecret(value) {
  const text = typeof value === 'string' ? value : '';
  if (!text) return '';
  const visible = Math.min(CLIENT_SECRET_VISIBLE_CHARS, Math.max(0, text.length - 1));
  return `${MASK_CHARACTER.repeat(text.length - visible)}${text.slice(text.length - visible)}`;
}

// Email addresses: keep the first couple of characters of the local part and
// the whole domain, so an admin can recognise the account without exposing it.
export const EMAIL_VISIBLE_CHARS = 2;

export function maskEmail(value) {
  const text = typeof value === 'string' ? value : '';
  const at = text.lastIndexOf('@');
  if (at <= 0) return text ? MASK_CHARACTER.repeat(text.length) : '';
  const local = text.slice(0, at);
  const visible = Math.min(EMAIL_VISIBLE_CHARS, Math.max(0, local.length - 1));
  return `${local.slice(0, visible)}${MASK_CHARACTER.repeat(Math.max(1, local.length - visible))}${text.slice(at)}`;
}
