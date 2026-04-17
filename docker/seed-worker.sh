#!/bin/sh
set -eu

run_seed() {
  if node "$@"; then
    echo "[seed-worker] OK: $*"
  else
    echo "[seed-worker] WARN: $* failed"
  fi
}

wait_for_redis_rest() {
  if [ -z "${UPSTASH_REDIS_REST_URL:-}" ] || [ -z "${UPSTASH_REDIS_REST_TOKEN:-}" ]; then
    echo "[seed-worker] WARN: Redis credentials missing; skipping redis-rest readiness wait"
    return 0
  fi

  echo "[seed-worker] waiting for redis-rest..."
  i=0
  while [ "$i" -lt 60 ]; do
    if curl -fsS --max-time 2 \
      -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN" \
      -H "Content-Type: application/json" \
      -d '["PING"]' \
      "$UPSTASH_REDIS_REST_URL" >/dev/null 2>&1; then
      echo "[seed-worker] redis-rest ready"
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done

  echo "[seed-worker] WARN: redis-rest not ready after 60s; continuing anyway"
  return 0
}

wait_for_worldmonitor() {
  # Only relevant in self-hosted docker-compose where seed-insights warms digest via RPC.
  if [ "${DEPLOYMENT_MODE:-}" != "self_hosted" ]; then
    return 0
  fi

  echo "[seed-worker] waiting for worldmonitor..."
  i=0
  while [ "$i" -lt 60 ]; do
    if curl -fsS --max-time 2 "http://worldmonitor:8080/api/health" >/dev/null 2>&1; then
      echo "[seed-worker] worldmonitor ready"
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done

  echo "[seed-worker] WARN: worldmonitor not ready after 60s; continuing anyway"
  return 0
}

echo "[seed-worker] starting"

wait_for_redis_rest
wait_for_worldmonitor

last_hormuz=0
last_gpsjam=0
last_military=0
last_military_bases=0
last_aviation=0
last_earthquakes=0
last_outages=0
last_climate=0
last_cyber=0
last_unrest=0
last_wildfires=0
last_air_quality=0
last_aaii=0
last_gdelt=0
last_advisories=0
last_natural=0
last_forecasts=0
last_predictions=0
last_insights=0
last_ucdp=0
last_sanctions=0
last_trade=0
last_radiation=0
last_disease=0
last_economy=0
last_consumer_prices=0
last_regulatory=0
last_energy_spine=0
last_electricity=0
last_ember=0
last_resilience_static=0
last_resilience_scores=0
last_resilience_intervals=0
last_portwatch=0
last_portwatch_activity=0
last_correlation=0
last_cross_source=0
last_regional=0
last_macro=0
last_energy_sources=0
last_baselines=0
last_ecb=0
last_imf_extended=0
last_fear_greed=0
last_market_breadth=0
last_econ_calendar=0
last_earnings_calendar=0
last_cot=0
last_hyperliquid=0
last_gold_etf=0
last_gold_cb=0
last_commodity_quotes=0
last_fuel_prices=0
last_energy_intel=0
last_thermal=0
last_vpd=0
last_product_catalog=0

# Bootstrap: seed the most user-visible keys early so long-running seeds
# (e.g. gdelt intel) don't block initial dashboard hydration.
bootstrap_now="$(date +%s)"
run_seed "/app/scripts/seed-insights.mjs"
last_insights="$bootstrap_now"
run_seed "/app/scripts/seed-product-catalog.mjs"
last_product_catalog="$bootstrap_now"

# Resilience has a dependency chain: static index -> per-country scores -> intervals.
# Seed those in-order during bootstrap so resilienceIntervals isn't empty on first load.
run_seed "/app/scripts/seed-resilience-static.mjs"
last_resilience_static="$bootstrap_now"
run_seed "/app/scripts/seed-resilience-scores.mjs"
last_resilience_scores="$bootstrap_now"

# Quick-win health-critical seeds (avoid empty criticals right after restart)
run_seed "/app/scripts/seed-hyperliquid-flow.mjs"
last_hyperliquid="$bootstrap_now"
run_seed "/app/scripts/seed-correlation.mjs"
last_correlation="$bootstrap_now"
run_seed "/app/scripts/seed-cross-source-signals.mjs"
last_cross_source="$bootstrap_now"
run_seed "/app/scripts/seed-radiation-watch.mjs"
last_radiation="$bootstrap_now"

run_seed "/app/scripts/seed-fear-greed.mjs"
last_fear_greed="$bootstrap_now"
run_seed "/app/scripts/seed-market-breadth.mjs"
last_market_breadth="$bootstrap_now"

run_seed "/app/scripts/seed-economic-calendar.mjs"
last_econ_calendar="$bootstrap_now"
if [ -n "${FINNHUB_API_KEY:-}" ]; then
  run_seed "/app/scripts/seed-earnings-calendar.mjs"
else
  echo "[seed-worker] SKIP: /app/scripts/seed-earnings-calendar.mjs (FINNHUB_API_KEY not set)"
fi
last_earnings_calendar="$bootstrap_now"

run_seed "/app/scripts/seed-cot.mjs"
last_cot="$bootstrap_now"
run_seed "/app/scripts/seed-bundle-ecb-eu.mjs"
last_ecb="$bootstrap_now"

run_seed "/app/scripts/seed-energy-intelligence.mjs"
last_energy_intel="$bootstrap_now"

# Wildfires are a dependency for thermal escalation and several cross-source signals.
# If FIRMS key isn't set we still continue; health will show EMPTY_ON_DEMAND.
if [ -n "${NASA_FIRMS_API_KEY:-}" ] || [ -n "${FIRMS_API_KEY:-}" ]; then
  run_seed "/app/scripts/seed-fire-detections.mjs"
else
  echo "[seed-worker] SKIP: /app/scripts/seed-fire-detections.mjs (NASA_FIRMS_API_KEY not set)"
fi
last_wildfires="$bootstrap_now"

# Air quality has two sources: OpenAQ (keyed) + optional WAQI supplement.
if [ -n "${OPENAQ_API_KEY:-}" ] || [ -n "${WAQI_API_KEY:-}" ]; then
  run_seed "/app/scripts/seed-health-air-quality.mjs"
else
  echo "[seed-worker] SKIP: /app/scripts/seed-health-air-quality.mjs (OPENAQ_API_KEY not set)"
fi
last_air_quality="$bootstrap_now"

# AAII sentiment is a weekly dataset but cheap; keep it seeded so /api/health isn't EMPTY.
run_seed "/app/scripts/seed-aaii-sentiment.mjs"
last_aaii="$bootstrap_now"

run_seed "/app/scripts/seed-thermal-escalation.mjs"
last_thermal="$bootstrap_now"
run_seed "/app/scripts/seed-vpd-tracker.mjs"
last_vpd="$bootstrap_now"

run_seed "/app/scripts/seed-gold-etf-flows.mjs"
last_gold_etf="$bootstrap_now"
run_seed "/app/scripts/seed-gold-cb-reserves.mjs"
last_gold_cb="$bootstrap_now"
run_seed "/app/scripts/seed-fuel-prices.mjs"
last_fuel_prices="$bootstrap_now"

run_seed "/app/scripts/seed-sanctions-pressure.mjs"
last_sanctions="$bootstrap_now"
run_seed "/app/scripts/seed-bundle-climate.mjs"
last_climate="$bootstrap_now"
run_seed "/app/scripts/seed-resilience-intervals.mjs"
last_resilience_intervals="$bootstrap_now"
run_seed "/app/scripts/seed-bundle-resilience-recovery.mjs"
run_seed "/app/scripts/seed-portwatch-port-activity.mjs"
last_portwatch_activity="$bootstrap_now"

while true; do
  now="$(date +%s)"

  if [ $((now - last_hormuz)) -ge 86400 ]; then
    run_seed "/app/scripts/seed-hormuz.mjs"
    last_hormuz="$now"
  fi

  if [ $((now - last_gpsjam)) -ge 21600 ]; then
    run_seed "/app/scripts/fetch-gpsjam.mjs"
    last_gpsjam="$now"
  fi

  if [ $((now - last_military)) -ge 600 ]; then
    run_seed "/app/scripts/seed-military-flights.mjs"
    last_military="$now"
  fi

  if [ $((now - last_military_bases)) -ge 604800 ]; then
    run_seed /app/scripts/seed-military-bases.mjs --skip-cleanup-wait
    last_military_bases="$now"
  fi

  if [ $((now - last_aviation)) -ge 1800 ]; then
    run_seed "/app/scripts/seed-airport-delays.mjs"
    last_aviation="$now"
  fi

  if [ $((now - last_earthquakes)) -ge 900 ]; then
    run_seed "/app/scripts/seed-earthquakes.mjs"
    last_earthquakes="$now"
  fi

  if [ $((now - last_outages)) -ge 900 ]; then
    run_seed "/app/scripts/seed-internet-outages.mjs"
    last_outages="$now"
  fi

  if [ $((now - last_cyber)) -ge 7200 ]; then
    run_seed "/app/scripts/seed-cyber-threats.mjs"
    last_cyber="$now"
  fi

  if [ $((now - last_unrest)) -ge 2700 ]; then
    run_seed "/app/scripts/seed-unrest-events.mjs"
    last_unrest="$now"
  fi

  if [ $((now - last_wildfires)) -ge 3600 ]; then
    if [ -n "${NASA_FIRMS_API_KEY:-}" ] || [ -n "${FIRMS_API_KEY:-}" ]; then
      run_seed "/app/scripts/seed-fire-detections.mjs"
    else
      echo "[seed-worker] SKIP: /app/scripts/seed-fire-detections.mjs (NASA_FIRMS_API_KEY not set)"
    fi
    last_wildfires="$now"
  fi

  if [ $((now - last_air_quality)) -ge 3600 ]; then
    if [ -n "${OPENAQ_API_KEY:-}" ] || [ -n "${WAQI_API_KEY:-}" ]; then
      run_seed "/app/scripts/seed-health-air-quality.mjs"
    else
      echo "[seed-worker] SKIP: /app/scripts/seed-health-air-quality.mjs (OPENAQ_API_KEY not set)"
    fi
    last_air_quality="$now"
  fi

  if [ $((now - last_advisories)) -ge 3600 ]; then
    run_seed "/app/scripts/seed-security-advisories.mjs"
    last_advisories="$now"
  fi

  if [ $((now - last_natural)) -ge 7200 ]; then
    run_seed "/app/scripts/seed-natural-events.mjs"
    last_natural="$now"
  fi

  if [ $((now - last_forecasts)) -ge 3600 ]; then
    run_seed "/app/scripts/seed-forecasts.mjs"
    last_forecasts="$now"
  fi

  if [ $((now - last_predictions)) -ge 1800 ]; then
    run_seed "/app/scripts/seed-prediction-markets.mjs"
    last_predictions="$now"
  fi

  if [ $((now - last_insights)) -ge 900 ]; then
    run_seed "/app/scripts/seed-insights.mjs"
    last_insights="$now"
  fi

  # GDELT intel can be slow (rate limits, long sleeps). Keep it AFTER the
  # user-visible quick wins so the dashboard isn't empty after restart.
  if [ $((now - last_gdelt)) -ge 21600 ]; then
    run_seed "/app/scripts/seed-gdelt-intel.mjs"
    last_gdelt="$now"
  fi

  if [ $((now - last_ucdp)) -ge 21600 ]; then
    run_seed "/app/scripts/seed-ucdp-events.mjs"
    last_ucdp="$now"
  fi

  if [ $((now - last_sanctions)) -ge 21600 ]; then
    run_seed "/app/scripts/seed-sanctions-pressure.mjs"
    last_sanctions="$now"
  fi

  if [ $((now - last_trade)) -ge 21600 ]; then
    run_seed "/app/scripts/seed-supply-chain-trade.mjs"
    run_seed "/app/scripts/seed-trade-flows.mjs"
    last_trade="$now"
  fi

  if [ $((now - last_radiation)) -ge 900 ]; then
    run_seed "/app/scripts/seed-radiation-watch.mjs"
    last_radiation="$now"
  fi

  if [ $((now - last_disease)) -ge 86400 ]; then
    run_seed "/app/scripts/seed-disease-outbreaks.mjs"
    last_disease="$now"
  fi

  if [ $((now - last_correlation)) -ge 900 ]; then
    run_seed "/app/scripts/seed-correlation.mjs"
    last_correlation="$now"
  fi

  if [ $((now - last_cross_source)) -ge 900 ]; then
    run_seed "/app/scripts/seed-cross-source-signals.mjs"
    last_cross_source="$now"
  fi

  if [ $((now - last_regional)) -ge 21600 ]; then
    run_seed "/app/scripts/seed-bundle-regional.mjs"
    last_regional="$now"
  fi

  if [ $((now - last_macro)) -ge 86400 ]; then
    run_seed "/app/scripts/seed-bundle-macro.mjs"
    last_macro="$now"
  fi

  if [ $((now - last_ecb)) -ge 86400 ]; then
    run_seed "/app/scripts/seed-bundle-ecb-eu.mjs"
    last_ecb="$now"
  fi

  if [ $((now - last_imf_extended)) -ge 2592000 ]; then
    if [ -n "${ENABLE_IMF_EXTENDED_SEEDS:-}" ]; then
      run_seed "/app/scripts/seed-bundle-imf-extended.mjs"
    else
      echo "[seed-worker] SKIP: /app/scripts/seed-bundle-imf-extended.mjs (ENABLE_IMF_EXTENDED_SEEDS not set)"
    fi
    last_imf_extended="$now"
  fi

  if [ $((now - last_fear_greed)) -ge 21600 ]; then
    run_seed "/app/scripts/seed-fear-greed.mjs"
    last_fear_greed="$now"
  fi

  if [ $((now - last_aaii)) -ge 86400 ]; then
    run_seed "/app/scripts/seed-aaii-sentiment.mjs"
    last_aaii="$now"
  fi

  if [ $((now - last_market_breadth)) -ge 86400 ]; then
    run_seed "/app/scripts/seed-market-breadth.mjs"
    last_market_breadth="$now"
  fi

  if [ $((now - last_econ_calendar)) -ge 43200 ]; then
    run_seed "/app/scripts/seed-economic-calendar.mjs"
    last_econ_calendar="$now"
  fi

  if [ $((now - last_earnings_calendar)) -ge 43200 ]; then
    if [ -n "${FINNHUB_API_KEY:-}" ]; then
      run_seed "/app/scripts/seed-earnings-calendar.mjs"
    else
      echo "[seed-worker] SKIP: /app/scripts/seed-earnings-calendar.mjs (FINNHUB_API_KEY not set)"
    fi
    last_earnings_calendar="$now"
  fi

  if [ $((now - last_cot)) -ge 604800 ]; then
    run_seed "/app/scripts/seed-cot.mjs"
    last_cot="$now"
  fi

  if [ $((now - last_hyperliquid)) -ge 300 ]; then
    run_seed "/app/scripts/seed-hyperliquid-flow.mjs"
    last_hyperliquid="$now"
  fi

  if [ $((now - last_gold_etf)) -ge 7200 ]; then
    run_seed "/app/scripts/seed-gold-etf-flows.mjs"
    last_gold_etf="$now"
  fi

  if [ $((now - last_gold_cb)) -ge 86400 ]; then
    run_seed "/app/scripts/seed-gold-cb-reserves.mjs"
    last_gold_cb="$now"
  fi

  if [ $((now - last_commodity_quotes)) -ge 900 ]; then
    run_seed "/app/scripts/seed-commodity-quotes.mjs"
    last_commodity_quotes="$now"
  fi

  if [ $((now - last_fuel_prices)) -ge 604800 ]; then
    run_seed "/app/scripts/seed-fuel-prices.mjs"
    last_fuel_prices="$now"
  fi

  if [ $((now - last_energy_intel)) -ge 21600 ]; then
    run_seed "/app/scripts/seed-energy-intelligence.mjs"
    last_energy_intel="$now"
  fi

  if [ $((now - last_thermal)) -ge 7200 ]; then
    run_seed "/app/scripts/seed-thermal-escalation.mjs"
    last_thermal="$now"
  fi

  if [ $((now - last_vpd)) -ge 86400 ]; then
    run_seed "/app/scripts/seed-vpd-tracker.mjs"
    last_vpd="$now"
  fi

  if [ $((now - last_product_catalog)) -ge 21600 ]; then
    run_seed "/app/scripts/seed-product-catalog.mjs"
    last_product_catalog="$now"
  fi

  if [ $((now - last_economy)) -ge 86400 ]; then
    run_seed "/app/scripts/seed-economy.mjs"
    last_economy="$now"
  fi

  if [ $((now - last_consumer_prices)) -ge 86400 ]; then
    if [ -n "${CONSUMER_PRICES_CORE_BASE_URL:-}" ]; then
      run_seed "/app/scripts/seed-consumer-prices.mjs"
    else
      echo "[seed-worker] SKIP: /app/scripts/seed-consumer-prices.mjs (CONSUMER_PRICES_CORE_BASE_URL not set)"
    fi
    last_consumer_prices="$now"
  fi

  if [ $((now - last_climate)) -ge 10800 ]; then
    run_seed "/app/scripts/seed-bundle-climate.mjs"
    last_climate="$now"
  fi

  if [ $((now - last_energy_sources)) -ge 86400 ]; then
    run_seed "/app/scripts/seed-bundle-energy-sources.mjs"
    last_energy_sources="$now"
  fi

  if [ $((now - last_regulatory)) -ge 7200 ]; then
    run_seed "/app/scripts/seed-regulatory-actions.mjs"
    last_regulatory="$now"
  fi

  if [ $((now - last_energy_spine)) -ge 86400 ]; then
    run_seed "/app/scripts/seed-energy-spine.mjs"
    last_energy_spine="$now"
  fi

  if [ $((now - last_electricity)) -ge 86400 ]; then
    run_seed "/app/scripts/seed-electricity-prices.mjs"
    last_electricity="$now"
  fi

  if [ $((now - last_ember)) -ge 86400 ]; then
    run_seed "/app/scripts/seed-ember-electricity.mjs"
    last_ember="$now"
  fi

  if [ $((now - last_baselines)) -ge 604800 ]; then
    run_seed "/app/scripts/seed-chokepoint-baselines.mjs"
    last_baselines="$now"
  fi

  if [ $((now - last_resilience_static)) -ge 604800 ]; then
    run_seed "/app/scripts/seed-resilience-static.mjs"
    last_resilience_static="$now"
  fi

  if [ $((now - last_resilience_scores)) -ge 21600 ]; then
    run_seed "/app/scripts/seed-resilience-scores.mjs"
    last_resilience_scores="$now"
  fi

  if [ $((now - last_resilience_intervals)) -ge 604800 ]; then
    run_seed "/app/scripts/seed-resilience-intervals.mjs"
    last_resilience_intervals="$now"
  fi

  if [ $((now - last_portwatch)) -ge 1800 ]; then
    run_seed "/app/scripts/seed-portwatch-disruptions.mjs"
    run_seed "/app/scripts/seed-portwatch.mjs"
    run_seed "/app/scripts/seed-portwatch-chokepoints-ref.mjs"
    run_seed "/app/scripts/seed-chokepoint-flows.mjs"
    last_portwatch="$now"
  fi

  if [ $((now - last_portwatch_activity)) -ge 21600 ]; then
    run_seed "/app/scripts/seed-portwatch-port-activity.mjs"
    last_portwatch_activity="$now"
  fi

  sleep 30
done
