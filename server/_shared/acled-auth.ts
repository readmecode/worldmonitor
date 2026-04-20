/**
 * ACLED OAuth token manager with automatic refresh.
 *
 * ACLED switched to OAuth tokens that expire every 24 hours.
 * This module handles the token lifecycle:
 *
 *   1. If ACLED_EMAIL + ACLED_PASSWORD are set → exchange for an OAuth
 *      access token (24 h) + refresh token (14 d), cache in Redis,
 *      and auto-refresh before expiry.
 *
 *   2. If only ACLED_ACCESS_TOKEN is set → use the static token as-is
 *      (backward-compatible, but will expire after 24 h).
 *
 *   3. If neither is set → return null (graceful degradation).
 *
 * See: https://acleddata.com/api-documentation/getting-started
 * Fixes: https://github.com/koala73/worldmonitor/issues/1283
 */

import { CHROME_UA } from './constants';
import { getCachedJson, setCachedJson } from './redis';

const ACLED_TOKEN_URL = 'https://acleddata.com/oauth/token';
const ACLED_CLIENT_ID = 'acled';
const ACLED_COOKIE_LOGIN_URL = 'https://acleddata.com/user/login?_format=json';

/** Refresh 5 minutes before the token actually expires. */
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

/** Redis cache key for the ACLED OAuth token state. */
const REDIS_CACHE_KEY = 'acled:oauth:token';

/** Cache token in Redis for 23 hours (token lasts 24 h, minus margin). */
const REDIS_TTL_SECONDS = 23 * 60 * 60;

/** Redis cache key for ACLED cookie session (fallback auth). */
const REDIS_COOKIE_KEY = 'acled:cookie:session';

/**
 * Cookie sessions can be short-lived / invalidated server-side.
 * Keep TTL modest so we auto-heal if ACLED rotates session secrets.
 */
const REDIS_COOKIE_TTL_SECONDS = 6 * 60 * 60;

interface TokenState {
  accessToken: string;
  refreshToken: string;
  /** Absolute timestamp (ms) when the access token expires. */
  expiresAt: number;
}

interface AcledOAuthTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

interface AcledCookieSessionState {
  cookieHeader: string;
  refreshAt: number;
}

/**
 * In-memory fast-path cache.
 * Acts as L1 cache; Redis is L2 and survives Vercel Edge cold starts.
 */
let memCached: TokenState | null = null;
let refreshPromise: Promise<string | null> | null = null;
let memCookie: AcledCookieSessionState | null = null;
let cookieLoginPromise: Promise<string | null> | null = null;

function extractSetCookies(resp: Response): string[] {
  // Node/undici provides getSetCookie(); Edge/Web doesn't. Support both.
  const hdrs = resp.headers as unknown as { getSetCookie?: () => string[] };
  if (typeof hdrs.getSetCookie === 'function') return hdrs.getSetCookie();

  const raw = resp.headers.get('set-cookie');
  if (!raw) return [];
  return [raw];
}

function buildCookieHeader(setCookies: string[]): string | null {
  const parts: string[] = [];
  for (const c of setCookies) {
    const nv = c.split(';')[0]?.trim();
    if (nv) parts.push(nv);
  }
  return parts.length > 0 ? parts.join('; ') : null;
}

async function loginCookieSession(email: string, password: string): Promise<AcledCookieSessionState> {
  const resp = await fetch(ACLED_COOKIE_LOGIN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': CHROME_UA,
    },
    body: JSON.stringify({ name: email, pass: password }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`ACLED cookie login failed (${resp.status}): ${text.slice(0, 200)}`);
  }

  const cookieHeader = buildCookieHeader(extractSetCookies(resp));
  if (!cookieHeader) throw new Error('ACLED cookie login missing Set-Cookie header');

  return {
    cookieHeader,
    refreshAt: Date.now() + (REDIS_COOKIE_TTL_SECONDS - 5 * 60) * 1000,
  };
}

async function cacheCookieToRedis(state: AcledCookieSessionState): Promise<void> {
  try {
    await setCachedJson(REDIS_COOKIE_KEY, state, REDIS_COOKIE_TTL_SECONDS);
  } catch (err) {
    console.warn('[acled-auth] Failed to cache cookie session in Redis', err);
  }
}

async function restoreCookieFromRedis(): Promise<AcledCookieSessionState | null> {
  try {
    const data = await getCachedJson(REDIS_COOKIE_KEY);
    if (
      data &&
      typeof data === 'object' &&
      'cookieHeader' in (data as Record<string, unknown>) &&
      'refreshAt' in (data as Record<string, unknown>)
    ) {
      return data as AcledCookieSessionState;
    }
  } catch (err) {
    console.warn('[acled-auth] Failed to restore cookie session from Redis', err);
  }
  return null;
}

/**
 * Returns an ACLED cookie header string (e.g. `SESS...=...; SSESS...=...`) or null.
 *
 * This is a fallback for cases where OAuth is configured but the dataset
 * endpoint rejects Bearer tokens (403) while allowing logged-in sessions.
 */
export async function getAcledCookieHeader(): Promise<string | null> {
  const email = process.env.ACLED_EMAIL?.trim();
  const password = process.env.ACLED_PASSWORD?.trim();
  if (!email || !password) return null;

  if (memCookie && Date.now() < memCookie.refreshAt) return memCookie.cookieHeader;

  const fromRedis = await restoreCookieFromRedis();
  if (fromRedis && Date.now() < fromRedis.refreshAt) {
    memCookie = fromRedis;
    return memCookie.cookieHeader;
  }
  if (fromRedis) memCookie = fromRedis;

  if (cookieLoginPromise) return cookieLoginPromise;
  cookieLoginPromise = (async () => {
    try {
      memCookie = await loginCookieSession(email, password);
      await cacheCookieToRedis(memCookie);
      return memCookie.cookieHeader;
    } catch (err) {
      console.error('[acled-auth] Failed to obtain ACLED cookie session', err);
      return memCookie?.cookieHeader ?? null;
    } finally {
      cookieLoginPromise = null;
    }
  })();

  return cookieLoginPromise;
}

async function requestAcledToken(
  body: URLSearchParams,
  action: 'exchange' | 'refresh',
): Promise<AcledOAuthTokenResponse> {
  const resp = await fetch(ACLED_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': CHROME_UA,
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(
      `ACLED OAuth token ${action} failed (${resp.status}): ${text.slice(0, 200)}`,
    );
  }

  return (await resp.json()) as AcledOAuthTokenResponse;
}

/**
 * Exchange ACLED credentials for an OAuth token pair.
 */
async function exchangeCredentials(
  email: string,
  password: string,
): Promise<TokenState> {
  const body = new URLSearchParams({
    username: email,
    password,
    grant_type: 'password',
    client_id: ACLED_CLIENT_ID,
  });
  const data = await requestAcledToken(body, 'exchange');

  if (!data.access_token || !data.refresh_token) {
    throw new Error('ACLED OAuth response missing access_token or refresh_token');
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 86_400) * 1000,
  };
}

/**
 * Use a refresh token to obtain a new access token.
 */
async function refreshAccessToken(refreshToken: string): Promise<TokenState> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    client_id: ACLED_CLIENT_ID,
  });
  const data = await requestAcledToken(body, 'refresh');

  if (!data.access_token) {
    throw new Error('ACLED OAuth refresh response missing access_token');
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: Date.now() + (data.expires_in ?? 86_400) * 1000,
  };
}

/**
 * Persist token state to Redis so it survives Vercel Edge cold starts.
 */
async function cacheToRedis(state: TokenState): Promise<void> {
  try {
    await setCachedJson(REDIS_CACHE_KEY, state, REDIS_TTL_SECONDS);
  } catch (err) {
    console.warn('[acled-auth] Failed to cache token in Redis', err);
  }
}

/**
 * Restore token state from Redis (L2 cache for cold starts).
 */
async function restoreFromRedis(): Promise<TokenState | null> {
  try {
    const data = await getCachedJson(REDIS_CACHE_KEY);
    if (
      data &&
      typeof data === 'object' &&
      'accessToken' in (data as Record<string, unknown>) &&
      'refreshToken' in (data as Record<string, unknown>) &&
      'expiresAt' in (data as Record<string, unknown>)
    ) {
      return data as TokenState;
    }
  } catch (err) {
    console.warn('[acled-auth] Failed to restore token from Redis', err);
  }
  return null;
}

/**
 * Returns a valid ACLED access token, refreshing if necessary.
 *
 * Priority:
 *   1. ACLED_EMAIL + ACLED_PASSWORD → OAuth flow with auto-refresh
 *   2. ACLED_ACCESS_TOKEN          → static token (legacy)
 *   3. Neither                     → null
 *
 * Caching:
 *   L1: In-memory `memCached` (fast-path within same isolate)
 *   L2: Redis via `getCachedJson`/`setCachedJson` (survives cold starts)
 */
export async function getAcledAccessToken(): Promise<string | null> {
  const email = process.env.ACLED_EMAIL?.trim();
  const password = process.env.ACLED_PASSWORD?.trim();

  // -- OAuth flow --
  if (email && password) {
    // L1: Return in-memory token if still fresh.
    if (memCached && Date.now() < memCached.expiresAt - EXPIRY_MARGIN_MS) {
      return memCached.accessToken;
    }

    // L2: Try Redis (survives Vercel Edge cold starts).
    // Also check L2 when L1 is expired, in case another isolate wrote a fresher token.
    if (!memCached || Date.now() >= memCached.expiresAt - EXPIRY_MARGIN_MS) {
      const fromRedis = await restoreFromRedis();
      if (fromRedis && Date.now() < fromRedis.expiresAt - EXPIRY_MARGIN_MS) {
        memCached = fromRedis;
        return memCached.accessToken;
      }
      // If Redis had a token but it's near-expiry, keep it for fallback.
      if (fromRedis) memCached = fromRedis;
    }

    // Deduplicate concurrent refresh attempts.
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
      try {
        // Try refreshing with the existing refresh token first.
        if (memCached?.refreshToken) {
          try {
            memCached = await refreshAccessToken(memCached.refreshToken);
            await cacheToRedis(memCached);
            return memCached.accessToken;
          } catch (refreshErr) {
            console.warn('[acled-auth] Refresh token expired, re-authenticating', refreshErr);
          }
        }

        // Full re-authentication with email/password.
        memCached = await exchangeCredentials(email, password);
        await cacheToRedis(memCached);
        return memCached.accessToken;
      } catch (err) {
        console.error('[acled-auth] Failed to obtain ACLED access token', err);
        // If we still have a cached token (even if near-expiry), try using it.
        return memCached?.accessToken ?? null;
      } finally {
        refreshPromise = null;
      }
    })();

    return refreshPromise;
  }

  // -- Static token fallback (legacy) --
  const staticToken = process.env.ACLED_ACCESS_TOKEN?.trim();
  return staticToken || null;
}
