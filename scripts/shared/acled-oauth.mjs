/**
 * Lightweight ACLED OAuth helper for seed scripts.
 *
 * Mirrors the credential exchange from server/_shared/acled-auth.ts
 * without the Redis/TypeScript dependencies so plain .mjs scripts
 * can import it directly.
 */

const ACLED_TOKEN_URL = 'https://acleddata.com/oauth/token';
const ACLED_CLIENT_ID = 'acled';
const ACLED_COOKIE_LOGIN_URL = 'https://acleddata.com/user/login?_format=json';

function extractSetCookies(resp) {
  // Node/undici may expose getSetCookie(); fall back to standard header.
  if (resp?.headers && typeof resp.headers.getSetCookie === 'function') return resp.headers.getSetCookie();
  const raw = resp?.headers?.get?.('set-cookie');
  return raw ? [raw] : [];
}

function buildCookieHeader(setCookies) {
  const parts = [];
  for (const c of setCookies || []) {
    const nv = String(c).split(';')[0]?.trim();
    if (nv) parts.push(nv);
  }
  return parts.length ? parts.join('; ') : null;
}

/**
 * Obtain a valid ACLED access token.
 *
 * Priority:
 *   1. ACLED_EMAIL + ACLED_PASSWORD: OAuth exchange
 *   2. ACLED_ACCESS_TOKEN: static token (legacy, expires 24h)
 *   3. Neither: null
 *
 * @param {object} options
 * @param {string} [options.userAgent] - User-Agent header value.
 * @returns {Promise<string|null>}
 */
export async function getAcledToken({ userAgent } = {}) {
  const email = (process.env.ACLED_EMAIL || '').trim();
  const password = (process.env.ACLED_PASSWORD || '').trim();

  if (email && password) {
    console.log('  ACLED: exchanging credentials for OAuth token...');
    const body = new URLSearchParams({
      username: email,
      password,
      grant_type: 'password',
      client_id: ACLED_CLIENT_ID,
    });

    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    if (userAgent) headers['User-Agent'] = userAgent;

    const resp = await fetch(ACLED_TOKEN_URL, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.warn(`  ACLED OAuth exchange failed (${resp.status}): ${text.slice(0, 200)}`);
      // Fall through to static token check
    } else {
      const data = await resp.json();
      if (data.access_token) {
        console.log('  ACLED: OAuth token obtained successfully');
        return data.access_token;
      }
      console.warn('  ACLED: OAuth response missing access_token');
    }
  }

  const staticToken = (process.env.ACLED_ACCESS_TOKEN || '').trim();
  if (staticToken) {
    console.log('  ACLED: using static ACLED_ACCESS_TOKEN (expires after 24h)');
    return staticToken;
  }

  return null;
}

/**
 * Cookie-based auth fallback (per ACLED docs).
 * Returns a `Cookie` header value like `SESS...=...; SSESS...=...`, or null.
 */
export async function getAcledCookieHeader({ userAgent } = {}) {
  const email = (process.env.ACLED_EMAIL || '').trim();
  const password = (process.env.ACLED_PASSWORD || '').trim();
  if (!email || !password) return null;

  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (userAgent) headers['User-Agent'] = userAgent;

  const resp = await fetch(ACLED_COOKIE_LOGIN_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: email, pass: password }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    console.warn(`  ACLED cookie login failed (${resp.status}): ${text.slice(0, 200)}`);
    return null;
  }

  return buildCookieHeader(extractSetCookies(resp));
}
