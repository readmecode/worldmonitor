import type { AuthSession } from './auth-state';
import { getSecretState } from './runtime-config';
import { isProUser } from './widget-store';
import { getDeploymentMode } from './deployment-mode';

export enum PanelGateReason {
  NONE = 'none',           // show content (pro user, or desktop with API key, or non-premium panel)
  ANONYMOUS = 'anonymous', // "Sign In to Unlock"
  FREE_TIER = 'free_tier', // "Upgrade to Pro"
}

function hasSelfHostedPremiumAccess(): boolean {
  const mode = getDeploymentMode();
  if (mode === 'dev_full') return true;
  if (mode !== 'self_hosted') return false;

  const configured = (import.meta.env.VITE_SELF_HOSTED_FEATURES ?? '')
    .split(',')
    .map((value: string) => value.trim());

  return configured.includes('premium_ui');
}

/**
 * Single source of truth for premium access.
 * Covers all access paths: desktop API key, tester keys (wm-pro-key / wm-widget-key), Clerk Pro.
 */
export function hasPremiumAccess(authState?: AuthSession): boolean {
  if (hasSelfHostedPremiumAccess()) return true;
  if (getSecretState('WORLDMONITOR_API_KEY').present) return true;
  if (isProUser()) return true;
  if (authState?.user?.role === 'pro') return true;
  return false;
}

/**
 * Determine gating reason for a premium panel given current auth state.
 * Non-premium panels always return NONE.
 */
export function getPanelGateReason(
  authState: AuthSession,
  isPremium: boolean,
): PanelGateReason {
  // Non-premium panels are never gated
  if (!isPremium) return PanelGateReason.NONE;

  // API key, tester key, or Clerk Pro: always unlocked
  if (hasPremiumAccess(authState)) return PanelGateReason.NONE;

  // Web gating based on Clerk auth state
  if (!authState.user) return PanelGateReason.ANONYMOUS;
  return PanelGateReason.FREE_TIER;
}
