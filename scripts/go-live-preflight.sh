#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="${1:-deploy/homologation.env}"

# shellcheck source=scripts/lib/env-file.sh
source scripts/lib/env-file.sh

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Arquivo de homologação não encontrado: $ENV_FILE" >&2
  echo "Copie deploy/homologation.env.example para deploy/homologation.env." >&2
  exit 1
fi

SERVER_IP="$(require_env_value "$ENV_FILE" SERVER_IP)"
APP_DOMAIN="$(require_env_value "$ENV_FILE" APP_DOMAIN)"
API_DOMAIN="$(require_env_value "$ENV_FILE" API_DOMAIN)"
GRAFANA_DOMAIN="$(require_env_value "$ENV_FILE" GRAFANA_DOMAIN)"
SSH_HOST="$(get_env_value "$ENV_FILE" SSH_HOST "$SERVER_IP")"
SSH_PORT="$(get_env_value "$ENV_FILE" SSH_PORT 22)"
CONNECT_TIMEOUT="$(get_env_value "$ENV_FILE" PREFLIGHT_CONNECT_TIMEOUT_SECONDS 5)"

failures=0

pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1" >&2; failures=$((failures + 1)); }
info() { printf 'INFO  %s\n' "$1"; }

resolve_ipv4() {
  local host="$1"
  if command -v dig >/dev/null 2>&1; then
    dig +short A "$host" | grep -E '^[0-9]+(\.[0-9]+){3}$' | sort -u
  else
    getent ahostsv4 "$host" 2>/dev/null | awk '{print $1}' | sort -u
  fi
}

check_dns() {
  local host="$1"
  local answers
  answers="$(resolve_ipv4 "$host" || true)"
  if grep -Fxq "$SERVER_IP" <<<"$answers"; then
    pass "$host aponta para $SERVER_IP"
  elif [[ -z "$answers" ]]; then
    fail "$host ainda não possui registro A público"
  else
    fail "$host aponta para ${answers//$'\n'/, }, esperado $SERVER_IP"
  fi
}

check_tcp() {
  local host="$1"
  local port="$2"
  if command -v nc >/dev/null 2>&1; then
    if nc -z -w "$CONNECT_TIMEOUT" "$host" "$port" >/dev/null 2>&1; then
      pass "TCP $host:$port acessível"
    else
      fail "TCP $host:$port indisponível"
    fi
  elif timeout "$CONNECT_TIMEOUT" bash -c "</dev/tcp/$host/$port" >/dev/null 2>&1; then
    pass "TCP $host:$port acessível"
  else
    fail "TCP $host:$port indisponível"
  fi
}

for host in "$APP_DOMAIN" "$API_DOMAIN" "$GRAFANA_DOMAIN"; do
  check_dns "$host"
done

check_tcp "$SSH_HOST" "$SSH_PORT"
check_tcp "$SERVER_IP" 80
check_tcp "$SERVER_IP" 443

if command -v docker >/dev/null 2>&1; then
  pass "Docker disponível no operador"
else
  fail "Docker não está instalado no operador"
fi

if command -v gh >/dev/null 2>&1; then
  if gh auth status >/dev/null 2>&1; then
    pass "GitHub CLI autenticado"
  else
    fail "GitHub CLI instalado, porém sem autenticação"
  fi
else
  info "GitHub CLI não instalado; publicação da release será feita pela interface do Actions"
fi

if ssh -o BatchMode=yes -o ConnectTimeout="$CONNECT_TIMEOUT" -p "$SSH_PORT" "$SSH_HOST" true >/dev/null 2>&1; then
  pass "SSH não interativo autorizado em $SSH_HOST"
else
  fail "SSH não interativo ainda não está autorizado em $SSH_HOST"
fi

if [[ "$failures" -gt 0 ]]; then
  echo "Preflight reprovado com $failures bloqueio(s)." >&2
  exit 1
fi

echo "Preflight aprovado. O ambiente está pronto para publicação e smoke test."
