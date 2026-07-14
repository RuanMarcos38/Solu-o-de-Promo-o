#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="${1:-deploy/homologation.env}"

# shellcheck source=scripts/lib/env-file.sh
source scripts/lib/env-file.sh

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Arquivo de homologação não encontrado: $ENV_FILE" >&2
  exit 1
fi

APP_DOMAIN="$(require_env_value "$ENV_FILE" APP_DOMAIN)"
API_DOMAIN="$(require_env_value "$ENV_FILE" API_DOMAIN)"
GRAFANA_DOMAIN="$(require_env_value "$ENV_FILE" GRAFANA_DOMAIN)"
MIN_TLS_DAYS="$(get_env_value "$ENV_FILE" PREFLIGHT_TLS_MIN_DAYS 14)"

failures=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1" >&2; failures=$((failures + 1)); }

check_status() {
  local url="$1"
  local expected="$2"
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' "$url" || true)"
  if [[ "$code" == "$expected" ]]; then
    pass "$url retornou HTTP $expected"
  else
    fail "$url retornou HTTP ${code:-erro}, esperado $expected"
  fi
}

check_header() {
  local url="$1"
  local header="$2"
  local pattern="$3"
  if curl -sSI "$url" | tr -d '\r' | grep -Ei "^${header}:.*${pattern}" >/dev/null; then
    pass "$url contém $header"
  else
    fail "$url não contém $header esperado"
  fi
}

check_status "https://${APP_DOMAIN}/" 200
check_status "https://${API_DOMAIN}/ready" 200
check_status "https://${GRAFANA_DOMAIN}/api/health" 200
check_status "https://${API_DOMAIN}/metrics" 404

redirect_code="$(curl -sS -o /dev/null -w '%{http_code}' "http://${APP_DOMAIN}/" || true)"
redirect_location="$(curl -sSI "http://${APP_DOMAIN}/" | tr -d '\r' | awk 'tolower($1)=="location:"{print $2}' | tail -n1 || true)"
if [[ "$redirect_code" =~ ^30[12378]$ && "$redirect_location" == https://* ]]; then
  pass "HTTP redireciona para HTTPS"
else
  fail "Redirecionamento HTTP → HTTPS inválido"
fi

check_header "https://${APP_DOMAIN}/" "Strict-Transport-Security" "max-age="
check_header "https://${APP_DOMAIN}/" "X-Content-Type-Options" "nosniff"
check_header "https://${APP_DOMAIN}/" "Referrer-Policy" "strict-origin"

cors_headers="$(curl -sSI -X OPTIONS \
  -H "Origin: https://${APP_DOMAIN}" \
  -H 'Access-Control-Request-Method: GET' \
  "https://${API_DOMAIN}/offers" | tr -d '\r')"
if grep -Fi "access-control-allow-origin: https://${APP_DOMAIN}" <<<"$cors_headers" >/dev/null; then
  pass "CORS permite somente a origem homologada"
else
  fail "CORS não confirmou a origem homologada"
fi

if command -v openssl >/dev/null 2>&1; then
  certificate="$(echo | openssl s_client -verify_return_error -servername "$APP_DOMAIN" -connect "$APP_DOMAIN:443" 2>/dev/null || true)"
  if grep -q 'Verify return code: 0 (ok)' <<<"$certificate"; then
    pass "Cadeia TLS validada por uma autoridade confiável"
  else
    fail "A cadeia TLS não foi validada"
  fi

  expiry="$(openssl x509 -noout -enddate 2>/dev/null <<<"$certificate" | cut -d= -f2-)"
  if [[ -n "$expiry" ]]; then
    expiry_epoch="$(date -d "$expiry" +%s)"
    now_epoch="$(date +%s)"
    remaining_days="$(( (expiry_epoch - now_epoch) / 86400 ))"
    if (( remaining_days >= MIN_TLS_DAYS )); then
      pass "Certificado TLS válido por mais $remaining_days dia(s)"
    else
      fail "Certificado TLS expira em $remaining_days dia(s)"
    fi
  else
    fail "Não foi possível ler a validade do certificado TLS"
  fi
fi

socket_response="$(curl -sS "https://${API_DOMAIN}/socket.io/?EIO=4&transport=polling" || true)"
if [[ "$socket_response" == 0* ]]; then
  pass "Handshake Socket.IO disponível"
else
  fail "Handshake Socket.IO indisponível"
fi

if [[ "$failures" -gt 0 ]]; then
  echo "Smoke test reprovado com $failures falha(s)." >&2
  exit 1
fi

echo "Smoke test de homologação aprovado."
