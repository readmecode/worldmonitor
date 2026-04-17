import type { DeploymentMode } from '@/shared/capabilities';
import { DEPLOYMENT_MODES } from '@/shared/capabilities';

const ENV: Record<string, string | undefined> = (() => {
  try {
    return (import.meta as any).env ?? {};
  } catch {
    return {};
  }
})();

const DEFAULT_MODE: DeploymentMode = 'hosted';

function normalizeMode(raw: string | undefined): DeploymentMode {
  if (!raw) return DEFAULT_MODE;
  return (DEPLOYMENT_MODES as readonly string[]).includes(raw) ? raw as DeploymentMode : DEFAULT_MODE;
}

export function getDeploymentMode(): DeploymentMode {
  return normalizeMode(ENV.VITE_DEPLOYMENT_MODE);
}

export function isHostedMode(): boolean {
  return getDeploymentMode() === 'hosted';
}

export function isSelfHostedMode(): boolean {
  return getDeploymentMode() === 'self_hosted';
}

export function isDevFullMode(): boolean {
  return getDeploymentMode() === 'dev_full';
}
