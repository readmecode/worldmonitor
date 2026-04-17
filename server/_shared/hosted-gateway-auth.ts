import { checkEntitlement, getRequiredTier } from './entitlement-check';
import { resolveSessionUserId } from './auth-session';
import { RPC_REQUIRED_CAPABILITY } from '../../src/shared/capabilities';
import { PREMIUM_RPC_PATHS } from '../../src/shared/premium-paths';

// @ts-expect-error -- JS module, no declaration file
import { validateApiKey } from '../../api/_api-key.js';

export interface HostedGatewayAuthResult {
  request: Request;
}

export async function applyHostedGatewayAuth(
  request: Request,
  pathname: string,
  corsHeaders: Record<string, string>,
): Promise<HostedGatewayAuthResult | Response> {
  const isTierGated = getRequiredTier(pathname) !== null;
  const isCapabilityGated = pathname in RPC_REQUIRED_CAPABILITY;
  const needsHostedPremiumGate = !isTierGated && (isCapabilityGated || PREMIUM_RPC_PATHS.has(pathname));

  let nextRequest = request;
  let sessionUserId: string | null = null;
  if (isTierGated) {
    sessionUserId = await resolveSessionUserId(request);
    if (sessionUserId) {
      nextRequest = new Request(request.url, {
        method: request.method,
        headers: (() => {
          const h = new Headers(request.headers);
          h.set('x-user-id', sessionUserId);
          return h;
        })(),
        body: request.body,
      });
    }
  }

  const keyCheck = validateApiKey(nextRequest, {
    forceKey: (isTierGated && !sessionUserId) || needsHostedPremiumGate,
  });
  if (keyCheck.required && !keyCheck.valid) {
    if (needsHostedPremiumGate) {
      const authHeader = nextRequest.headers.get('Authorization');
      if (authHeader?.startsWith('Bearer ')) {
        const { validateBearerToken } = await import('../auth-session');
        const session = await validateBearerToken(authHeader.slice(7));
        if (!session.valid) {
          return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        if (session.role !== 'pro') {
          return new Response(JSON.stringify({ error: 'Pro subscription required' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
      } else {
        return new Response(JSON.stringify({ error: keyCheck.error, _debug: (keyCheck as any)._debug }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    } else {
      return new Response(JSON.stringify({ error: keyCheck.error }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  }

  if (sessionUserId && !keyCheck.valid && needsHostedPremiumGate) {
    const authHeader = nextRequest.headers.get('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const { validateBearerToken } = await import('../auth-session');
      const session = await validateBearerToken(authHeader.slice(7));
      if (!session.valid || session.role !== 'pro') {
        return new Response(JSON.stringify({ error: 'Pro subscription required' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }
  }

  if (!(keyCheck.valid && nextRequest.headers.get('X-WorldMonitor-Key'))) {
    const entitlementResponse = await checkEntitlement(nextRequest, pathname, corsHeaders);
    if (entitlementResponse) return entitlementResponse;
  }

  return { request: nextRequest };
}
