#!/usr/bin/env node
/**
 * Self-hosted env sanity check.
 *
 * Prints which recommended keys are present in `.env.local` (no values).
 */
import fs from 'node:fs';
import path from 'node:path';

function readFileIfExists(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function parseEnvKeys(raw) {
  const keys = new Set();
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Z0-9_]+$/.test(key)) continue;
    keys.add(key);
  }
  return keys;
}

const repoRoot = process.cwd();
const envLocalPath = path.join(repoRoot, '.env.local');
const envExamplePath = path.join(repoRoot, '.env.selfhosted.example');

const envLocal = readFileIfExists(envLocalPath);
if (!envLocal) {
  console.log('No .env.local found');
  process.exit(0);
}

const envExample = readFileIfExists(envExamplePath) ?? '';

const localKeys = parseEnvKeys(envLocal);
const exampleKeys = parseEnvKeys(envExample);

// These are the keys that most commonly drive UNHEALTHY/EMPTY signals.
const recommended = [
  'ACLED_EMAIL',
  'ACLED_PASSWORD',
  'NASA_FIRMS_API_KEY',
  'OPENAQ_API_KEY',
  'WAQI_API_KEY',
  'EIA_API_KEY',
  'FRED_API_KEY',
  'FINNHUB_API_KEY',
  'AISSTREAM_API_KEY',
  'OPENSKY_CLIENT_ID',
  'OPENSKY_CLIENT_SECRET',
  'UCDP_ACCESS_TOKEN',
  'CLOUDFLARE_API_TOKEN',
  'PROXY_URL',
];

const present = [];
const missing = [];
for (const k of recommended) {
  if (localKeys.has(k)) present.push(k);
  else missing.push(k);
}

// Report keys that are in .env.local but not in the example (helps catch typos).
const unknown = [];
for (const k of localKeys) {
  if (!exampleKeys.has(k) && !k.startsWith('VITE_')) unknown.push(k);
}

console.log('== Self-hosted Env Check ==');
console.log(`.env.local keys: ${localKeys.size}`);
console.log(`Recommended present: ${present.length ? present.join(', ') : '(none)'}`);
console.log(`Recommended missing: ${missing.length ? missing.join(', ') : '(none)'}`);
if (unknown.length) {
  console.log(`Unknown keys (not in .env.selfhosted.example): ${unknown.sort().join(', ')}`);
}

