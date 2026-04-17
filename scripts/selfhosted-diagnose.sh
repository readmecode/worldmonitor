#!/bin/sh
set -eu

# Self-hosted debugging helper.
# Runs a minimal set of commands and prints outputs in one place so you can
# paste it into a GitHub issue / chat without re-running things manually.

echo "== WorldMonitor Self-Hosted Diagnose =="
echo "ts_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "pwd=$(pwd)"
echo ""

echo "== Docker =="
docker version 2>&1 || true
echo ""
docker context ls 2>&1 || true
echo ""

echo "== Compose PS =="
docker compose ps 2>&1 || true
echo ""

echo "== Health =="
curl -sS -m 5 http://localhost:3000/api/health 2>&1 || true
echo ""
echo ""

echo "== Key Endpoints (quick) =="
for path in \
  "/api/intelligence/v1/get-risk-scores" \
  "/api/infrastructure/v1/get-cable-health" \
  "/api/news/v1/list-feed-digest?variant=full&lang=en" \
; do
  echo "-- GET $path"
  curl -sS -m 10 -i "http://localhost:3000$path" 2>&1 | head -n 40 || true
  echo ""
done

echo "== Logs (tail) =="
for svc in worldmonitor ais-relay seed-worker redis-rest redis; do
  echo "-- docker compose logs --tail=200 $svc"
  docker compose logs --tail=200 "$svc" 2>&1 || true
  echo ""
done

echo "== Greps (recent) =="
docker compose logs --tail=400 worldmonitor 2>&1 | rg -n "ECONNRESET|setCachedJson failed|\\[health\\]" || true
docker compose logs --tail=400 ais-relay 2>&1 | rg -n "\\[CII\\]|\\[CableHealth\\]|\\[Chokepoints\\]|\\[ServiceStatuses\\]|fetch failed|RPC base" || true
echo ""

echo "== Done =="

