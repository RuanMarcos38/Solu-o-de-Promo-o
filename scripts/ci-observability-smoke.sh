#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

METRICS_TOKEN="$(node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('hex'))")"
GRAFANA_PASSWORD="$(node -e "process.stdout.write(require('node:crypto').randomBytes(18).toString('hex'))")"
export METRICS_TOKEN GRAFANA_PASSWORD

cleanup() {
  docker compose --profile observability logs alertmanager prometheus grafana > observability-containers.log 2>&1 || true
  docker compose --profile observability down -v || true
}
trap cleanup EXIT

cp .env.example .env
sed -i "s/^METRICS_BEARER_TOKEN=.*/METRICS_BEARER_TOKEN=${METRICS_TOKEN}/" .env
mkdir -p ops/alertmanager/generated ops/observability/secrets
cp ops/alertmanager/alertmanager.example.yml ops/alertmanager/generated/alertmanager.yml

printf '%s' "$METRICS_TOKEN" > ops/observability/secrets/promotion_radar_metrics_token
printf '%s' "$GRAFANA_PASSWORD" > ops/observability/secrets/grafana_admin_password
printf '%s' "$(node -e "process.stdout.write(require('node:crypto').randomBytes(18).toString('hex'))")" > ops/observability/secrets/alertmanager_smtp_password
printf '%s' "$(node -e "process.stdout.write(require('node:crypto').randomBytes(18).toString('hex'))")" > ops/observability/secrets/alertmanager_telegram_bot_token
printf '%s' 'https://example.invalid/primary' > ops/observability/secrets/alertmanager_primary_webhook_url
printf '%s' 'https://example.invalid/secondary' > ops/observability/secrets/alertmanager_secondary_webhook_url
printf '%s' 'https://example.invalid/warning' > ops/observability/secrets/alertmanager_warning_webhook_url

chmod 700 ops/observability/secrets
chmod 644 ops/observability/secrets/*
chmod 644 ops/alertmanager/generated/alertmanager.yml

docker compose build api worker web migrate
docker compose up -d postgres redis
docker compose run --rm migrate
docker compose up -d api worker

wait_url() {
  local url="$1"
  local attempts="${2:-40}"
  for ((i=1; i<=attempts; i++)); do
    if curl -fsS "$url" >/dev/null; then return 0; fi
    sleep 3
  done
  return 1
}

wait_url http://localhost:3333/health 30
curl -fsS http://localhost:3333/ready
curl -fsS -H "Authorization: Bearer ${METRICS_TOKEN}" http://localhost:3333/metrics > api-metrics.txt
grep -q 'promotion_radar_http_requests_total' api-metrics.txt
grep -q 'promotion_radar_service_info' api-metrics.txt

wait_url http://localhost:9464/health 30
curl -fsS -H "Authorization: Bearer ${METRICS_TOKEN}" http://localhost:9464/metrics > worker-metrics.txt
grep -q 'promotion_radar_queue_depth' worker-metrics.txt
grep -q 'promotion_radar_service_info' worker-metrics.txt
API_URL=http://127.0.0.1:3333 CHECK_FRONTEND_BUNDLE=false node scripts/smoke-public.mjs

docker compose --profile observability up -d alertmanager prometheus grafana
wait_url http://localhost:9093/-/ready
wait_url http://localhost:9090/-/ready
wait_url http://localhost:3000/api/health

prometheus_ok=0
for _ in {1..20}; do
  curl -fsS http://localhost:9090/api/v1/targets > prometheus-targets.json
  curl -fsS 'http://localhost:9090/api/v1/query?query=promotion_radar_service_info' > prometheus-query.json
  if node <<'NODE'
const fs = require('node:fs');
const targets = JSON.parse(fs.readFileSync('prometheus-targets.json', 'utf8'));
const query = JSON.parse(fs.readFileSync('prometheus-query.json', 'utf8'));
const expected = new Set(['promotion-radar-api', 'promotion-radar-worker']);
for (const target of targets.data?.activeTargets || []) {
  if (target.health === 'up') expected.delete(target.labels?.job);
}
const samples = query.data?.result || [];
process.exit(expected.size === 0 && samples.length >= 2 ? 0 : 1);
NODE
  then
    prometheus_ok=1
    break
  fi
  sleep 3
done
printf '%s' "$prometheus_ok" > prometheus-smoke-result.txt
test "$prometheus_ok" = "1"

grafana_ok=0
for _ in {1..20}; do
  if curl -fsS -u "admin:${GRAFANA_PASSWORD}" 'http://localhost:3000/api/search?query=Radar' > grafana-search.json \
    && grep -q 'promotion-radar-overview' grafana-search.json \
    && grep -q 'promotion-radar-slo' grafana-search.json; then
    grafana_ok=1
    break
  fi
  sleep 3
done
printf '%s' "$grafana_ok" > grafana-smoke-result.txt
test "$grafana_ok" = "1"

echo 'Docker, Prometheus, Alertmanager e Grafana validados com sucesso.'
