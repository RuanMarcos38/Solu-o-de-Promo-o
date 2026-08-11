#!/usr/bin/env bash
set -Eeuo pipefail

SMOKE_PORT=3334
SMOKE_LOG="${RUNNER_TEMP:-/tmp}/promotion-api-degraded-startup.log"
HEALTH_BODY="${RUNNER_TEMP:-/tmp}/promotion-api-degraded-health.json"
READY_BODY="${RUNNER_TEMP:-/tmp}/promotion-api-degraded-ready.json"

cleanup() {
  if [[ -n "${API_PID:-}" ]]; then
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

env \
  NODE_ENV=production \
  API_HOST=127.0.0.1 \
  API_PORT="$SMOKE_PORT" \
  FRONTEND_ORIGINS=https://ofertas.r2rmarketingdigital.com.br \
  JWT_SECRET=ci-production-random-jwt-value-7f4c9e2a1b8d6f03 \
  BOOTSTRAP_ADMIN_ENABLED=false \
  DATABASE_URL=https://invalid-project.supabase.co \
  REDIS_URL='<URL INTERNA COPIADA DO REDIS>' \
  CHANNEL_CONFIG_ENCRYPTION_KEY='(chave configurada)' \
  node apps/api/dist/start.js >"$SMOKE_LOG" 2>&1 &
API_PID=$!

for _ in $(seq 1 40); do
  if curl --fail --silent "http://127.0.0.1:${SMOKE_PORT}/health" >"$HEALTH_BODY"; then
    break
  fi
  if ! kill -0 "$API_PID" 2>/dev/null; then
    cat "$SMOKE_LOG" >&2
    exit 1
  fi
  sleep 0.25
done

node -e '
  const fs = require("node:fs");
  const body = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const expected = ["CHANNEL_KEY_DERIVED", "DATABASE_URL_INVALID", "REDIS_URL_INVALID"];
  if (body.status !== "ok") throw new Error("/health não confirmou vida da API");
  for (const code of expected) {
    if (!body.warnings?.includes(code)) throw new Error(`/health não informou ${code}`);
  }
' "$HEALTH_BODY"

READY_STATUS=$(curl --silent --output "$READY_BODY" --write-out '%{http_code}' "http://127.0.0.1:${SMOKE_PORT}/ready")
test "$READY_STATUS" = "503"
node -e '
  const fs = require("node:fs");
  const body = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (body.code !== "DATABASE_URL_INVALID") throw new Error("/ready não diagnosticou DATABASE_URL_INVALID");
' "$READY_BODY"

CORS_HEADERS=$(curl --silent --include --request OPTIONS \
  "http://127.0.0.1:${SMOKE_PORT}/auth/login" \
  --header 'Origin: https://ofertas.r2rmarketingdigital.com.br' \
  --header 'Access-Control-Request-Method: POST')
grep -qi 'access-control-allow-origin: https://ofertas.r2rmarketingdigital.com.br' <<<"$CORS_HEADERS"

echo "Bot de resiliência aprovado: API online, diagnóstico seguro e CORS correto com dependências inválidas."
