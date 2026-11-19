/**
 * Checks a Google OAuth Client ID + Client Secret pair against Google itself.
 *
 * We call Google's token endpoint with a made-up authorization code. Google
 * authenticates the client BEFORE it looks at the code, so the answer tells us
 * whether the pair is real without needing a real sign-in:
 *
 *   invalid_grant                         -> the client was accepted, only our fake
 *                                            code was rejected   => credentials VALID
 *   invalid_client / unauthorized_client  -> Google does not know this client, or the
 *                                            secret is wrong      => credentials INVALID
 *   anything else (timeout, 5xx, network) -> we could not tell    => UNAVAILABLE
 *
 * "Unavailable" is kept separate from "invalid" on purpose: a timeout must never be
 * reported as bad credentials, and it must never let a save through either.
 *
 * Never log or return the secret, the request body, or Google's response body.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TIMEOUT_MS = 8_000;
const DUMMY_CODE = 'healthcentria-credential-check';

export const GOOGLE_CREDENTIALS_INVALID_MESSAGE = 'Invalid Google Client ID or Client Secret.';
export const GOOGLE_UNAVAILABLE_MESSAGE = 'Could not verify with Google, try again.';

/**
 * @param {{ clientId: string, clientSecret: string, redirectUri?: string }} input
 * @returns {Promise<'valid' | 'invalid' | 'unavailable'>}
 */
export async function verifyGoogleOAuthClient({ clientId, clientSecret, redirectUri }) {
  let response;
  try {
    response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: DUMMY_CODE,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri || 'http://localhost/oauth-check',
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // DNS failure, offline, timeout: not an answer about the credentials.
    return 'unavailable';
  }

  let code = '';
  try {
    const data = await response.json();
    code = typeof data?.error === 'string' ? data.error : '';
  } catch {
    code = '';
  }

  if (response.ok) return 'valid';
  if (code === 'invalid_grant') return 'valid';
  if (code === 'invalid_client' || code === 'unauthorized_client') return 'invalid';
  return 'unavailable';
}

/** Turns a verdict into an HTTP error body, or null when the credentials are fine. */
export function googleVerdictResponse(verdict, fields = ['clientId', 'clientSecret']) {
  if (verdict === 'valid') return null;
  if (verdict === 'invalid') {
    return {
      status: 400,
      body: {
        success: false,
        code: 'GOOGLE_CREDENTIALS_INVALID',
        message: GOOGLE_CREDENTIALS_INVALID_MESSAGE,
        errors: Object.fromEntries(fields.map((field) => [field, [GOOGLE_CREDENTIALS_INVALID_MESSAGE]])),
      },
    };
  }
  return {
    status: 503,
    body: { success: false, code: 'GOOGLE_UNAVAILABLE', message: GOOGLE_UNAVAILABLE_MESSAGE },
  };
}
