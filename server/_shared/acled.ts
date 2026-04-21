/**
 * Shared ACLED API fetch with Redis caching.
 *
 * Three endpoints call ACLED independently (risk-scores, unrest-events,
 * acled-events) with overlapping queries. This shared layer ensures
 * identical queries hit Redis instead of making redundant upstream calls.
 */
import { CHROME_UA } from './constants';
import { cachedFetchJson } from './redis';
import { getAcledAccessToken, getAcledCookieHeader } from './acled-auth';

const ACLED_API_URL = 'https://acleddata.com/api/acled/read';
const ACLED_CACHE_TTL = 900; // 15 min — matches ACLED rate-limit window
const ACLED_TIMEOUT_MS = 15_000;

function isDisabled(): boolean {
  const raw = (process.env.DISABLE_ACLED || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function isPermission403(message: string): boolean {
  const s = message.toLowerCase();
  // ACLED frequently returns 403 for accounts without API group permissions.
  return s.includes('access denied')
    || s.includes('permission is required')
    || s.includes('consent must be accepted');
}

export interface AcledRawEvent {
  event_id_cnty?: string;
  event_type?: string;
  sub_event_type?: string;
  country?: string;
  location?: string;
  latitude?: string;
  longitude?: string;
  event_date?: string;
  fatalities?: string;
  source?: string;
  actor1?: string;
  actor2?: string;
  admin1?: string;
  notes?: string;
  tags?: string;
}

interface FetchAcledOptions {
  eventTypes: string;
  startDate: string;
  endDate: string;
  country?: string;
  limit?: number;
}

/**
 * Fetch ACLED events with automatic Redis caching.
 * Cache key is derived from query parameters so identical queries across
 * different handlers share the same cached result.
 */
export async function fetchAcledCached(opts: FetchAcledOptions): Promise<AcledRawEvent[]> {
  if (isDisabled()) return [];

  const token = await getAcledAccessToken();
  // ACLED supports cookie-based auth, but it's a fallback. If neither OAuth nor
  // credentials exist, degrade gracefully.
  if (!token && !(process.env.ACLED_EMAIL?.trim() && process.env.ACLED_PASSWORD?.trim())) return [];

  const cacheKey = `acled:shared:${opts.eventTypes}:${opts.startDate}:${opts.endDate}:${opts.country || 'all'}:${opts.limit || 500}`;
  const result = await cachedFetchJson<AcledRawEvent[]>(cacheKey, ACLED_CACHE_TTL, async () => {
    const params = new URLSearchParams({
      event_type: opts.eventTypes,
      event_date: `${opts.startDate}|${opts.endDate}`,
      event_date_where: 'BETWEEN',
      limit: String(opts.limit || 500),
      _format: 'json',
    });
    if (opts.country) params.set('country', opts.country);

    const url = `${ACLED_API_URL}?${params}`;

    const doFetch = async (headers: Record<string, string>) => {
      const resp = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(ACLED_TIMEOUT_MS),
      });
      return resp;
    };

    // 1) Primary: OAuth bearer token
    let resp: Response | null = null;
    if (token) {
      resp = await doFetch({
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'User-Agent': CHROME_UA,
      });
    }

    // 2) Fallback: cookie-based session (some accounts appear to allow cookie auth
    //    while rejecting Bearer tokens with 403).
    if (!resp || resp.status === 403) {
      const cookieHeader = await getAcledCookieHeader();
      if (cookieHeader) {
        resp = await doFetch({
          Accept: 'application/json',
          Cookie: cookieHeader,
          'User-Agent': CHROME_UA,
        });
      }
    }

    // If we couldn't obtain any auth method, degrade to an empty result for this seed cycle.
    if (!resp) return null;

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      // Self-hosted: treat permission-denied 403 as "ACLED unavailable" (fallback to other sources).
      if (resp.status === 403 && text && isPermission403(text)) return null;
      throw new Error(`ACLED API error: ${resp.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
    }
    const data = (await resp.json()) as { data?: AcledRawEvent[]; message?: string; error?: string };
    if (data.message || data.error) {
      const msg = String(data.message || data.error || 'ACLED API error');
      if (isPermission403(msg)) return null;
      throw new Error(msg);
    }

    const events = data.data || [];
    return events.length > 0 ? events : null;
  });
  return result || [];
}
