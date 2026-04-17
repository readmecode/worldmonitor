import type { ProviderCapability, ProviderReadiness } from '@/shared/capabilities';
import { createDefaultProviderMap } from '@/shared/capabilities';
import { getSecretState } from './runtime-config';

function fromSecret(
  keyPresent: boolean,
  whenMissing: ProviderReadiness = 'missing',
): ProviderReadiness {
  return keyPresent ? 'ready' : whenMissing;
}

function hasAcledCredentials(): boolean {
  return (
    (getSecretState('ACLED_EMAIL').valid && getSecretState('ACLED_PASSWORD').valid)
    || getSecretState('ACLED_ACCESS_TOKEN').valid
  );
}

export function getProviderReadiness(): Record<ProviderCapability, ProviderReadiness> {
  const providers = createDefaultProviderMap();

  providers.fred = fromSecret(getSecretState('FRED_API_KEY').valid);
  providers.eia = fromSecret(getSecretState('EIA_API_KEY').valid);
  providers.acled = fromSecret(hasAcledCredentials());
  providers.ucdp = fromSecret(getSecretState('UCDP_ACCESS_TOKEN').valid);
  providers.finnhub = fromSecret(getSecretState('FINNHUB_API_KEY').valid, 'degraded');
  providers.wto = fromSecret(getSecretState('WTO_API_KEY').valid);
  providers.wingbits = fromSecret(getSecretState('WINGBITS_API_KEY').valid, 'degraded');
  providers.ais = getSecretState('AISSTREAM_API_KEY').valid ? 'ready' : 'unsupported';
  providers.opensky = (getSecretState('OPENSKY_CLIENT_ID').valid && getSecretState('OPENSKY_CLIENT_SECRET').valid)
    ? 'ready'
    : 'degraded';
  providers.exa = fromSecret(getSecretState('EXA_API_KEYS').valid, 'degraded');
  providers.brave = fromSecret(getSecretState('BRAVE_API_KEYS').valid, 'degraded');
  providers.serpapi = fromSecret(getSecretState('SERPAPI_API_KEYS').valid, 'degraded');

  return providers;
}
