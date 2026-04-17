export type DeploymentMode = 'hosted' | 'self_hosted' | 'dev_full';

export const DEPLOYMENT_MODES = ['hosted', 'self_hosted', 'dev_full'] as const;

export type Capability =
  | 'premium_ui'
  | 'advanced_market_analysis'
  | 'regional_intelligence'
  | 'resilience'
  | 'supply_chain_advanced'
  | 'scenario_engine'
  | 'ai_enrichment';

export const CAPABILITIES = [
  'premium_ui',
  'advanced_market_analysis',
  'regional_intelligence',
  'resilience',
  'supply_chain_advanced',
  'scenario_engine',
  'ai_enrichment',
] as const satisfies readonly Capability[];

export type ProviderCapability =
  | 'fred'
  | 'eia'
  | 'acled'
  | 'ucdp'
  | 'finnhub'
  | 'wto'
  | 'wingbits'
  | 'ais'
  | 'opensky'
  | 'exa'
  | 'brave'
  | 'serpapi';

export const PROVIDER_CAPABILITIES = [
  'fred',
  'eia',
  'acled',
  'ucdp',
  'finnhub',
  'wto',
  'wingbits',
  'ais',
  'opensky',
  'exa',
  'brave',
  'serpapi',
] as const satisfies readonly ProviderCapability[];

export type ProviderReadiness = 'ready' | 'missing' | 'degraded' | 'unsupported';

export interface CapabilitySnapshot {
  mode: DeploymentMode;
  features: Record<Capability, boolean>;
  providers: Record<ProviderCapability, ProviderReadiness>;
}

export const FEATURE_REQUIREMENTS: Record<Capability, ProviderCapability[]> = {
  premium_ui: [],
  advanced_market_analysis: ['finnhub', 'exa', 'brave', 'serpapi'],
  regional_intelligence: ['acled', 'ucdp'],
  resilience: ['acled', 'fred'],
  supply_chain_advanced: ['wto'],
  scenario_engine: [],
  ai_enrichment: ['exa', 'brave', 'serpapi'],
};

export const RPC_REQUIRED_CAPABILITY: Record<string, Capability> = {
  '/api/market/v1/analyze-stock': 'advanced_market_analysis',
  '/api/market/v1/get-stock-analysis-history': 'advanced_market_analysis',
  '/api/market/v1/backtest-stock': 'advanced_market_analysis',
  '/api/market/v1/get-insider-transactions': 'advanced_market_analysis',
  '/api/market/v1/list-stored-stock-backtests': 'advanced_market_analysis',
  '/api/intelligence/v1/get-regional-snapshot': 'regional_intelligence',
  '/api/intelligence/v1/get-regime-history': 'regional_intelligence',
  '/api/intelligence/v1/get-regional-brief': 'regional_intelligence',
  '/api/resilience/v1/get-resilience-score': 'resilience',
  '/api/resilience/v1/get-resilience-ranking': 'resilience',
  '/api/supply-chain/v1/get-country-chokepoint-index': 'supply_chain_advanced',
  '/api/supply-chain/v1/get-bypass-options': 'supply_chain_advanced',
  '/api/supply-chain/v1/get-country-cost-shock': 'supply_chain_advanced',
  '/api/supply-chain/v1/get-route-explorer-lane': 'supply_chain_advanced',
  '/api/supply-chain/v1/get-route-impact': 'supply_chain_advanced',
  '/api/supply-chain/v1/get-sector-dependency': 'supply_chain_advanced',
  '/api/supply-chain/v1/multi-sector-cost-shock': 'supply_chain_advanced',
  '/api/scenario/v1/run': 'scenario_engine',
  '/api/scenario/v1/status': 'scenario_engine',
};

export const PANEL_REQUIRED_CAPABILITY: Partial<Record<string, Capability>> = {
  'stock-analysis': 'advanced_market_analysis',
  'stock-backtest': 'advanced_market_analysis',
  'daily-market-brief': 'advanced_market_analysis',
  'market-implications': 'advanced_market_analysis',
  'wsb-ticker-scanner': 'advanced_market_analysis',
  'regional-intelligence': 'regional_intelligence',
  deduction: 'regional_intelligence',
  'supply-chain': 'supply_chain_advanced',
  'chat-analyst': 'ai_enrichment',
};

export function createDefaultFeatureMap(value = false): Record<Capability, boolean> {
  return Object.fromEntries(CAPABILITIES.map((capability) => [capability, value])) as Record<Capability, boolean>;
}

export function createDefaultProviderMap(
  value: ProviderReadiness = 'missing',
): Record<ProviderCapability, ProviderReadiness> {
  return Object.fromEntries(PROVIDER_CAPABILITIES.map((provider) => [provider, value])) as Record<ProviderCapability, ProviderReadiness>;
}
