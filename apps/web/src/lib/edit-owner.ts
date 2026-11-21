/**
 * The per-tab token sent with lock and save requests.
 *
 * It is not a credential: the login token is still the Authorization header.
 * It only lets the server tell "this tab's claim" apart from "somebody else's",
 * and refuse a late release that belongs to a newer claim.
 *
 * Kept in sessionStorage, so a reload of the same tab keeps the same identity
 * and can renew or release the claim it already has.
 */
const OWNER_KEY = 'healthcentria.edit-owner';

/** A token for this tab, kept across reloads of the same tab. */
export function tabOwner(): string {
  try {
    const existing = sessionStorage.getItem(OWNER_KEY);
    if (existing) return existing;
    const made = makeToken();
    sessionStorage.setItem(OWNER_KEY, made);
    return made;
  } catch {
    // Private mode / storage disabled: still works, just per mount.
    return makeToken();
  }
}

export function makeToken(): string {
  try {
    return crypto.randomUUID().replace(/-/g, '');
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  }
}
