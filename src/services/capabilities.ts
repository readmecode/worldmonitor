import type { Capability, CapabilitySnapshot, ProviderCapability } from '@/shared/capabilities';
import { CAPABILITIES, FEATURE_REQUIREMENTS, PANEL_REQUIRED_CAPABILITY, createDefaultFeatureMap } from '@/shared/capabilities';
import { hasPremiumAccess } from './panel-gating';
import { getDeploymentMode, isDevFullMode, isSelfHostedMode } from './deployment-mode';
import { getProviderReadiness } from './provider-readiness';

const ENV: Record<string, string | undefined> = (() => {
  try {
    return (import.meta as any).env ?? {};
  } catch {
    return {};
  }
})();

function parseSelfHostedFeatureFlags(raw: string | undefined): Set<Capability> {
  if (!raw) return new Set();
  const known = new Set<string>(CAPABILITIES);
  return new Set(
    raw.split(',')
      .map((item) => item.trim())
      .filter((item): item is Capability => Boolean(item) && known.has(item)),
  );
}

export function getSelfHostedEnabledFeatures(): Set<Capability> {
  return parseSelfHostedFeatureFlags(ENV.VITE_SELF_HOSTED_FEATURES);
}

function hasReadyProviderSet(required: ProviderCapability[], readiness: CapabilitySnapshot['providers']): boolean {
  if (required.length === 0) return true;
  return required.some((provider) => readiness[provider] === 'ready');
}

function resolveFeatureMap(): Record<Capability, boolean> {
  if (isDevFullMode()) return createDefaultFeatureMap(true);

  if (isSelfHostedMode()) {
    const enabled = getSelfHostedEnabledFeatures();
    return Object.fromEntries(CAPABILITIES.map((capability) => [capability, enabled.has(capability)])) as Record<Capability, boolean>;
  }

  const premium = hasPremiumAccess();
  return {
    premium_ui: premium,
    advanced_market_analysis: premium,
    regional_intelligence: premium,
    resilience: premium,
    supply_chain_advanced: premium,
    scenario_engine: premium,
    ai_enrichment: premium,
  };
}

export function getCapabilitySnapshot(): CapabilitySnapshot {
  const providers = getProviderReadiness();
  const features = resolveFeatureMap();

  return {
    mode: getDeploymentMode(),
    features: Object.fromEntries(
      CAPABILITIES.map((capability) => {
        if (!features[capability]) return [capability, false];
        return [capability, hasReadyProviderSet(FEATURE_REQUIREMENTS[capability], providers)];
      }),
    ) as Record<Capability, boolean>,
    providers,
  };
}

export function hasCapability(capability: Capability): boolean {
  return getCapabilitySnapshot().features[capability];
}

export function getProviderStatus(provider: ProviderCapability) {
  return getCapabilitySnapshot().providers[provider];
}

export function getRequiredCapabilityForPanel(panelId: string): Capability | null {
  return PANEL_REQUIRED_CAPABILITY[panelId] ?? null;
}

export function hasPanelCapability(panelId: string): boolean {
  const capability = getRequiredCapabilityForPanel(panelId);
  return capability ? hasCapability(capability) : true;
}
