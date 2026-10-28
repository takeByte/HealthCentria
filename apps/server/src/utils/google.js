import { createPublicKey, verify as verifySignature } from 'node:crypto';
import { googleOAuth } from '../config/env.js';

// Google OAuth 2.0 endpoints (Authorization Code flow, server-side).
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';
const JWKS_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const JWKS_TTL_MS = 60 * 60 * 1000;

let jwksCache = { keys: [], expiresAt: 0 };

/** Consent-screen URL the browser is redirected to. */
export function buildGoogleAuthUrl({ state, credentials }) {
  const params = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: googleOAuth.callbackUrl,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/** Exchange the one-time `code` for Google tokens. */
export async function exchangeCodeForTokens(code, credentials) {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      redirect_uri: googleOAuth.callbackUrl,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) {
    // Deliberately omit Google's response body: it can echo request context.
    throw new Error(`Google token exchange failed (${res.status})`);
  }
  return res.json();
}

/** Fetch the verified profile (sub, email, email_verified, name, picture). */
export async function fetchGoogleProfile(accessToken) {
  const res = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Google userinfo request failed (${res.status})`);
  }
  return res.json();
}

function decodeJwtPart(part) {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Google ID token is malformed.');
  }
}

async function getGoogleSigningKeys() {
  if (jwksCache.keys.length > 0 && jwksCache.expiresAt > Date.now()) {
    return jwksCache.keys;
  }
  const res = await fetch(JWKS_ENDPOINT);
  if (!res.ok) throw new Error(`Google signing keys request failed (${res.status})`);
  const body = await res.json();
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache = { keys, expiresAt: Date.now() + JWKS_TTL_MS };
  return keys;
}

/**
 * Verify a Google ID token returned by the authorization-code exchange.
 *
 * This checks the RS256 signature against Google's published JWKS, issuer,
 * audience and expiry. The caller must still require `email_verified === true`.
 */
export async function verifyGoogleIdToken(idToken, clientId) {
  if (typeof idToken !== 'string') throw new Error('Google did not return an ID token.');
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Google ID token is malformed.');

  const header = decodeJwtPart(parts[0]);
  const payload = decodeJwtPart(parts[1]);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
    throw new Error('Google ID token uses an unsupported signature.');
  }

  const findKey = (keys) =>
    keys.find(
      (key) =>
        key &&
        key.kid === header.kid &&
        (!key.use || key.use === 'sig') &&
        (!key.alg || key.alg === 'RS256'),
    );

  let keys = await getGoogleSigningKeys();
  let jwk = findKey(keys);
  if (!jwk) {
    // The cache may predate a key rotation. Refetch once before rejecting.
    jwksCache = { keys: [], expiresAt: 0 };
    keys = await getGoogleSigningKeys();
    jwk = findKey(keys);
  }
  if (!jwk) throw new Error('Google ID token signing key not found.');

  const publicKey = createPublicKey({ key: jwk, format: 'jwk' });
  const signatureOk = verifySignature(
    'RSA-SHA256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    publicKey,
    Buffer.from(parts[2], 'base64url'),
  );
  if (!signatureOk) throw new Error('Google ID token signature is invalid.');

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) {
    throw new Error('Google ID token has expired.');
  }
  if (typeof payload.iat === 'number' && payload.iat > now + 300) {
    throw new Error('Google ID token was issued in the future.');
  }
  if (!GOOGLE_ISSUERS.has(payload.iss)) {
    throw new Error('Google ID token issuer is invalid.');
  }
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(clientId)) {
    throw new Error('Google ID token audience is invalid.');
  }

  return payload;
}
