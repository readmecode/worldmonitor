/**
 * Vercel edge proxy for the widget agent.
 *
 * Auth paths:
 *   1. Clerk JWT (Authorization: Bearer <token>) — validates plan === 'pro',
 *      then injects real server keys and proxies to the Railway relay.
 *   2. Browser tester key (X-WorldMonitor-Key) — validated against
 *      WORLDMONITOR_VALID_KEYS so one browser-held key can unlock premium
 *      testing paths across the app.
 *   3. Legacy tester keys (X-Widget-Key / X-Pro-Key) — validated directly here
 *      so the relay's WIDGET_AGENT_KEY / PRO_WIDGET_KEY are never exposed
 *      to the browser.
 *
 * GET  → proxy to relay /widget-agent/health
 * POST → proxy SSE stream to relay /widget-agent
 */

export const config = { runtime: 'edge' };

// @ts-expect-error — JS module, no declaration file
import { getCorsHeaders } from './_cors.js';
import { validateBearerToken } from '../server/auth-session';

function getRelayBase(): string {
  // Self-hosted: proxy to the local relay container (ais-relay) instead of the public proxy.
  // docker-compose sets WS_RELAY_URL=http://ais-relay:3004
  const selfHostedRelay = (process.env.WIDGET_AGENT_RELAY_BASE || process.env.WS_RELAY_URL || '').trim();
  if (selfHostedRelay) return selfHostedRelay.replace(/\/$/, '');
  return 'https://proxy.worldmonitor.app';
}

const RELAY_BASE = getRelayBase();
const WIDGET_AGENT_KEY = process.env.WIDGET_AGENT_KEY ?? '';
const PRO_WIDGET_KEY = process.env.PRO_WIDGET_KEY ?? '';
const WORLDMONITOR_VALID_KEY_SET = new Set(
  (process.env.WORLDMONITOR_VALID_KEYS ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean),
);

function hasValidWorldMonitorKey(key: string): boolean {
  return Boolean(key) && WORLDMONITOR_VALID_KEY_SET.has(key);
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}

function isSelfHosted(): boolean {
  return (process.env.DEPLOYMENT_MODE || '').toLowerCase() === 'self_hosted'
    || (process.env.DEPLOYMENT_MODE || '').toLowerCase() === 'selfhosted'
    || Boolean(process.env.SELF_HOSTED_FEATURES);
}

export default async function handler(req: Request): Promise<Response> {
  const corsHeaders = getCorsHeaders(req) as Record<string, string>;

  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-WorldMonitor-Key, X-Widget-Key, X-Pro-Key',
      },
    });
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  let isPro = false;

  // Self-hosted: allow local stacks to use widget-agent without browser-held keys.
  // The relay is local and the handler injects server-side keys (WIDGET_AGENT_KEY / PRO_WIDGET_KEY),
  // so requiring `wm-pro-key` in localStorage is unnecessary friction.
  if (isSelfHosted()) {
    isPro = false;
    if (req.method === 'POST') {
      try {
        const raw = await req.clone().text();
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        isPro = parsed.tier === 'pro';
      } catch {
        // If body is malformed, relay will return 400; keep isPro=false.
      }
    }
  } else {
  const worldMonitorKey = req.headers.get('X-WorldMonitor-Key') ?? '';
  if (hasValidWorldMonitorKey(worldMonitorKey)) {
    isPro = true;
  } else {
    const authHeader = req.headers.get('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      // Clerk JWT path (web users with active subscription)
      const session = await validateBearerToken(authHeader.slice(7));
      if (!session.valid) {
        return json({ error: 'Invalid or expired session' }, 401, corsHeaders);
      }
      if (session.role !== 'pro') {
        return json({ error: 'Pro subscription required' }, 403, corsHeaders);
      }
      isPro = true;
    } else {
      // Legacy tester key path (wm-widget-key / wm-pro-key)
      const widgetKey = req.headers.get('X-Widget-Key') ?? '';
      const proKey = req.headers.get('X-Pro-Key') ?? '';
      const hasWidgetKey = Boolean(WIDGET_AGENT_KEY && widgetKey === WIDGET_AGENT_KEY);
      const hasProKey = Boolean(PRO_WIDGET_KEY && proKey === PRO_WIDGET_KEY);
      if (!hasWidgetKey && !hasProKey) {
        return json({ error: 'Forbidden' }, 403, corsHeaders);
      }
      isPro = hasProKey;
    }
  }
  }

  // Mirror the relay P2 fix: allow PRO-only deployments (no basic key, but PRO key present)
  if (!WIDGET_AGENT_KEY && !PRO_WIDGET_KEY) {
    return json({ error: 'Widget agent unavailable', ok: false, widgetKeyConfigured: false }, 503, corsHeaders);
  }

  // ── Build relay headers (server-side keys, never exposed to browser) ──────
  const relayHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'worldmonitor-widget-edge/1.0',
    ...(WIDGET_AGENT_KEY ? { 'X-Widget-Key': WIDGET_AGENT_KEY } : {}),
  };
  if (isPro && PRO_WIDGET_KEY) {
    relayHeaders['X-Pro-Key'] = PRO_WIDGET_KEY;
  }

  // ── Health check (GET) ────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const healthRes = await fetch(`${RELAY_BASE}/widget-agent/health`, {
      method: 'GET',
      headers: relayHeaders,
    });
    const body = await healthRes.text();
    return new Response(body, {
      status: healthRes.status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, corsHeaders);
  }

  // ── Agent call (POST, SSE stream) ─────────────────────────────────────────
  let rawBody = await req.text();

  // Normalise tier in body to match the server-validated isPro flag.
  // Prevents the relay from seeing tier:pro without the matching X-Pro-Key.
  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    const expectedTier = isPro ? 'pro' : 'basic';
    if (parsed.tier !== expectedTier) {
      rawBody = JSON.stringify({ ...parsed, tier: expectedTier });
    }
  } catch { /* malformed body — relay will return 400 */ }

  const relayRes = await fetch(`${RELAY_BASE}/widget-agent`, {
    method: 'POST',
    headers: relayHeaders,
    body: rawBody,
  });

  return new Response(relayRes.body, {
    status: relayRes.status,
    headers: {
      'Content-Type': relayRes.headers.get('Content-Type') ?? 'text/event-stream',
      'Cache-Control': 'no-cache, no-store',
      'X-Accel-Buffering': 'no',
      ...corsHeaders,
    },
  });
}
