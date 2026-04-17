import type { ProviderCapability, ProviderReadiness } from '../../src/shared/capabilities';
import { createDefaultProviderMap } from '../../src/shared/capabilities';

function hasSecret(key: string): boolean {
  return Boolean(process.env[key]?.trim());
}

function hasAcledCredentials(): boolean {
  return (hasSecret('ACLED_EMAIL') && hasSecret('ACLED_PASSWORD')) || hasSecret('ACLED_ACCESS_TOKEN');
}

function fromSecret(present: boolean, whenMissing: ProviderReadiness = 'missing'): ProviderReadiness {
  return present ? 'ready' : whenMissing;
}

export function getProviderReadiness(): Record<ProviderCapability, ProviderReadiness> {
  const providers = createDefaultProviderMap();

  providers.fred = fromSecret(hasSecret('FRED_API_KEY'));
  providers.eia = fromSecret(hasSecret('EIA_API_KEY'));
  providers.acled = fromSecret(hasAcledCredentials());
  providers.ucdp = fromSecret(hasSecret('UCDP_ACCESS_TOKEN'));
  providers.finnhub = fromSecret(hasSecret('FINNHUB_API_KEY'), 'degraded');
  providers.wto = fromSecret(hasSecret('WTO_API_KEY'));
  providers.wingbits = fromSecret(hasSecret('WINGBITS_API_KEY'), 'degraded');
  providers.ais = hasSecret('AISSTREAM_API_KEY') ? 'ready' : 'unsupported';
  providers.opensky = hasSecret('OPENSKY_CLIENT_ID') && hasSecret('OPENSKY_CLIENT_SECRET')
    ? 'ready'
    : 'degraded';
  providers.exa = fromSecret(hasSecret('EXA_API_KEYS'), 'degraded');
  providers.brave = fromSecret(hasSecret('BRAVE_API_KEYS'), 'degraded');
  providers.serpapi = fromSecret(hasSecret('SERPAPI_API_KEYS'), 'degraded');

  return providers;
}
