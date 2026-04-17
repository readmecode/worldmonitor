import type { DeploymentMode } from '../../src/shared/capabilities';

const DEFAULT_MODE: DeploymentMode = 'hosted';

export function getDeploymentMode(): DeploymentMode {
  const raw = process.env.DEPLOYMENT_MODE;
  return raw === 'self_hosted' || raw === 'dev_full' || raw === 'hosted'
    ? raw
    : DEFAULT_MODE;
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
