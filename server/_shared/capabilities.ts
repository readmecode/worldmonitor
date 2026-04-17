import type { Capability, CapabilitySnapshot, ProviderCapability } from '../../src/shared/capabilities';
import {
  CAPABILITIES,
  FEATURE_REQUIREMENTS,
  createDefaultFeatureMap,
} from '../../src/shared/capabilities';
// @ts-expect-error -- JS module, no declaration file
import { validateApiKey } from '../../api/_api-key.js';
import { validateBearerToken } from '../auth-session';
import { getEntitlements } from './entitlement-check';
import { getDeploymentMode, isDevFullMode, isSelfHostedMode } from './deployment-mode';
import { getProviderReadiness } from './provider-readiness';

export interface RequestAccessContext extends CapabilitySnapshot {
  userId: string | null;
}

function parseSelfHostedFeatureFlags(raw: string | undefined): Set<Capability> {
  if (!raw) return new Set();
  const known = new Set<string>(CAPABILITIES);
  return new Set(
    raw.split(',')
      .map((item) => item.trim())
      .filter((item): item is Capability => Boolean(item) && known.has(item)),
  );
}

function hasReadyProviderSet(
  required: ProviderCapability[],
  providers: CapabilitySnapshot['providers'],
): boolean {
  if (required.length === 0) return true;
  return required.some((provider) => providers[provider] === 'ready');
}

async function resolveHostedFeatures(request: Request): Promise<{ userId: string | null; features: Record<Capability, boolean> }> {
  const features = createDefaultFeatureMap(false);

  const keyCheck = validateApiKey(request, {});
  if (keyCheck.valid) {
    return { userId: null, features: createDefaultFeatureMap(true) };
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { userId: null, features };
  }

  const session = await validateBearerToken(authHeader.slice(7));
  if (!session.valid || !session.userId) {
    return { userId: null, features };
  }

  const entitlements = await getEntitlements(session.userId);
  const isPremium = session.role === 'pro' || Boolean(entitlements && entitlements.features.tier >= 1);
  if (isPremium) {
    features.premium_ui = true;
    features.regional_intelligence = true;
    features.resilience = true;
    features.supply_chain_advanced = true;
    features.scenario_engine = true;
    features.ai_enrichment = true;
  }
  if (entitlements && entitlements.features.tier >= 2) {
    features.advanced_market_analysis = true;
  }

  return { userId: session.userId, features };
}

export async function resolveRequestAccess(request: Request): Promise<RequestAccessContext> {
  const mode = getDeploymentMode();
  const providers = getProviderReadiness();

  let userId: string | null = null;
  let features = createDefaultFeatureMap(false);

  if (isDevFullMode()) {
    features = createDefaultFeatureMap(true);
  } else if (isSelfHostedMode()) {
    const enabled = parseSelfHostedFeatureFlags(process.env.SELF_HOSTED_FEATURES);
    features = Object.fromEntries(CAPABILITIES.map((capability) => [capability, enabled.has(capability)])) as Record<Capability, boolean>;
  } else {
    ({ userId, features } = await resolveHostedFeatures(request));
  }

  const gatedFeatures = Object.fromEntries(
    CAPABILITIES.map((capability) => {
      if (!features[capability]) return [capability, false];
      return [capability, hasReadyProviderSet(FEATURE_REQUIREMENTS[capability], providers)];
    }),
  ) as Record<Capability, boolean>;

  return { mode, userId, features: gatedFeatures, providers };
}

export function requireCapability(
  ctx: RequestAccessContext,
  capability: Capability,
): Response | null {
  if (ctx.features[capability]) return null;
  return new Response(
    JSON.stringify({
      error: 'Capability unavailable',
      capability,
      mode: ctx.mode,
      userId: ctx.userId,
    }),
    {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}
