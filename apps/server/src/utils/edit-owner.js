/**
 * The browser tab token sent with lock and save requests.
 *
 * It is not a credential: the login token is still the Authorization header.
 * It only identifies one tab's claim so the server can tell "my lock" from
 * "somebody else's lock", and refuse a release that belongs to a newer claim.
 */
export const EDIT_OWNER_HEADER = 'X-Edit-Owner';
export const EDIT_NONCE_HEADER = 'X-Edit-Nonce';

const OWNER_PATTERN = /^[A-Za-z0-9_-]{16,80}$/;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;

/** The caller's tab token, or '' when missing/invalid. */
export function readEditOwner(req) {
  const owner = String(req.get(EDIT_OWNER_HEADER) ?? '').trim();
  return OWNER_PATTERN.test(owner) ? owner : '';
}

/** The acquisition token, or '' when missing/invalid. */
export function readEditNonce(req) {
  const nonce = String(req.get(EDIT_NONCE_HEADER) ?? '').trim();
  return NONCE_PATTERN.test(nonce) ? nonce : '';
}
