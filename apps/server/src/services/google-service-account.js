import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

/**
 * Access tokens for the project's Google service account (the same one the
 * Calendar sync uses: GOOGLE_SERVICE_ACCOUNT_EMAIL + _PRIVATE_KEY), one cached
 * token per scope. Used by Google Sheets; Calendar keeps its own copy so the
 * working sync is untouched.
 */

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REQUEST_TIMEOUT_MS = 10_000;

/** scope -> { accessToken, expiresAt } */
const cache = new Map();
/** scope -> in-flight promise */
const inflight = new Map();

function normalizePrivateKey(value) {
  return String(value ?? '')
    .replace(/\\n/g, '\n')
    .trim()
    .replace(/^["']|["']$/g, '');
}

export function serviceAccountConfig() {
  return {
    email: String(env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? '').trim(),
    privateKey: normalizePrivateKey(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY),
  };
}

export function isServiceAccountConfigured() {
  const config = serviceAccountConfig();
  return Boolean(config.email && config.privateKey);
}

export async function getServiceAccountToken(scope, { force = false } = {}) {
  const cached = cache.get(scope);
  if (!force && cached && cached.expiresAt > Date.now() + 60_000) return cached.accessToken;
  if (inflight.has(scope)) return inflight.get(scope);

  const request = (async () => {
    const config = serviceAccountConfig();
    if (!config.email || !config.privateKey) {
      throw new Error('The Google service account is not configured (GOOGLE_SERVICE_ACCOUNT_EMAIL / _PRIVATE_KEY).');
    }

    const now = Math.floor(Date.now() / 1000);
    let assertion;
    try {
      assertion = jwt.sign(
        { iss: config.email, scope, aud: TOKEN_ENDPOINT, iat: now, exp: now + 3600 },
        config.privateKey,
        { algorithm: 'RS256' },
      );
    } catch {
      throw new Error('Could not sign the Google service account request. Check GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.');
    }

    let response;
    try {
      response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(
        `Could not reach Google's token endpoint (${error?.name === 'TimeoutError' ? 'timeout' : 'network error'}).`,
      );
    }
    if (!response.ok) {
      // The body is omitted on purpose: it can echo request context.
      throw new Error(`Google service account token request failed (${response.status}).`);
    }
    const data = await response.json().catch(() => null);
    if (!data?.access_token) throw new Error('Google did not return an access token for the service account.');

    cache.set(scope, {
      accessToken: data.access_token,
      expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    });
    return data.access_token;
  })().finally(() => inflight.delete(scope));

  inflight.set(scope, request);
  return request;
}
