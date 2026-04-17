#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEnvFile, runSeed, writeExtraKeyWithMeta } from './_seed-utils.mjs';

// Self-hosted seed-worker runs inside the relay image which intentionally does
// not ship the full Edge `api/` tree. Keep this script self-contained by
// treating prices as optional.
const FALLBACK_PRICES = {};

loadEnvFile(import.meta.url);

const CANONICAL_KEY = 'product-catalog:v2';
const CACHE_TTL_SECONDS = 86400; // 24h

async function loadProductIds() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const productsPath = path.resolve(here, '../src/config/products.generated.ts');
  let src = '';
  try {
    src = await readFile(productsPath, 'utf8');
  } catch {
    // In self-hosted docker images we don't ship `src/`. Returning an empty map
    // still allows us to publish a stable catalog shape for the UI/health check.
    return {};
  }
  const ids = {};
  for (const match of src.matchAll(/^\s*([A-Z0-9_]+):\s*'([^']+)'\s*,?\s*$/gm)) {
    ids[match[1]] = match[2];
  }
  return ids;
}

const TIER_CONFIG = {
  free: {
    name: 'Free',
    description: 'Get started with the essentials',
    features: ['Core dashboard panels', 'Global news feed', 'Earthquake & weather alerts', 'Basic map view'],
    cta: 'Get Started',
    href: 'https://worldmonitor.app',
    highlighted: false,
  },
  pro: {
    name: 'Pro',
    description: 'Full intelligence dashboard',
    features: ['Everything in Free', 'AI stock analysis & backtesting', 'Daily market briefs', 'Military & geopolitical tracking', 'Custom widget builder', 'MCP data connectors', 'Priority data refresh'],
    highlighted: true,
  },
  api_starter: {
    name: 'API',
    description: 'Programmatic access to intelligence data',
    features: ['REST API access', 'Real-time data streams', '1,000 requests/day', 'Webhook notifications', 'Custom data exports'],
    highlighted: false,
  },
  enterprise: {
    name: 'Enterprise',
    description: 'Custom solutions for organizations',
    features: ['Everything in Pro + API', 'Unlimited API requests', 'Dedicated support', 'Custom integrations', 'SLA guarantee', 'On-premise option'],
    cta: 'Contact Sales',
    href: 'mailto:enterprise@worldmonitor.app',
    highlighted: false,
  },
};

const PUBLIC_TIER_GROUPS = ['free', 'pro', 'api_starter', 'enterprise'];

function buildTiers(ids) {
  const tiers = [];
  for (const group of PUBLIC_TIER_GROUPS) {
    const config = TIER_CONFIG[group];
    if (!config) continue;

    if (group === 'free') {
      tiers.push({ ...config, price: 0, period: 'forever' });
      continue;
    }
    if (group === 'enterprise') {
      tiers.push({ ...config, price: null });
      continue;
    }

    const tier = { ...config };
    const monthlyKey = group === 'pro' ? 'PRO_MONTHLY' : group === 'api_starter' ? 'API_STARTER_MONTHLY' : null;
    const annualKey = group === 'pro' ? 'PRO_ANNUAL' : group === 'api_starter' ? 'API_STARTER_ANNUAL' : null;
    const monthlyId = monthlyKey ? String(ids?.[monthlyKey] || '') : '';
    const annualId = annualKey ? String(ids?.[annualKey] || '') : '';

    if (monthlyId) {
      tier.monthlyProductId = monthlyId;
      if (FALLBACK_PRICES[monthlyId] != null) tier.monthlyPrice = FALLBACK_PRICES[monthlyId] / 100;
    }
    if (annualId) {
      tier.annualProductId = annualId;
      if (FALLBACK_PRICES[annualId] != null) tier.annualPrice = FALLBACK_PRICES[annualId] / 100;
    }

    tiers.push(tier);
  }
  return tiers;
}

async function fetchCatalog() {
  const now = Date.now();
  const ids = await loadProductIds();
  const tiers = buildTiers(ids);
  return {
    tiers,
    fetchedAt: now,
    cachedUntil: now + CACHE_TTL_SECONDS * 1000,
    priceSource: 'fallback',
  };
}

function validate(data) {
  return Array.isArray(data?.tiers) && data.tiers.length >= 4;
}

async function main() {
  await runSeed('product', 'catalog', CANONICAL_KEY, fetchCatalog, {
    validateFn: validate,
    ttlSeconds: CACHE_TTL_SECONDS,
    sourceVersion: 'fallback-prices-v1',
    recordCount: (data) => data?.tiers?.length ?? 0,
    afterPublish: async (data) => {
      // `runSeed` writes seed-meta as `seed-meta:product:catalog`, but health expects `seed-meta:product-catalog`.
      // This extra write is cheap and keeps health consistent across deployments.
      await writeExtraKeyWithMeta(CANONICAL_KEY, data, CACHE_TTL_SECONDS, data?.tiers?.length ?? 0, 'seed-meta:product-catalog');
    },
  });
}

main().catch((err) => {
  console.error('FATAL:', err.message || err);
  process.exit(1);
});
