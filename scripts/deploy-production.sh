#!/usr/bin/env bash
set -Eeuo pipefail

TARGET_RELEASE="${1:-}"
ENV_FILE="${ENV_FILE:-.env.production}"
SECRETS_ENV_FILE="${SECRETS_ENV_FILE:-.env.production.secrets}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.production.yml}"
STATE_FILE="${STATE_FILE:-.deploy/current-release}"

# shellcheck source=scripts/lib/env-file.sh
source scripts/lib/env-file.sh

if [[ -z "$TARGET_RELEASE" || ! "$TARGET_RELEASE" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "Uso: $0 <release-tag-válida>" >&2
  exit 1
fi

for file in "$ENV_FILE" "$SECRETS_ENV_FILE" "$COMPOSE_FILE"; do
  if [[ ! -f "$file" ]]; then
    echo "Arquivo obrigatório ausente: $file" >&2
    exit 1
  fi
done

APP_DOMAIN="$(require_env_value "$ENV_FILE" APP_DOMAIN)"
API_DOMAIN="$(require_env_value "$ENV_FILE" API_DOMAIN)"
GRAFANA_DOMAIN="$(require_env_value "$ENV_FILE" GRAFANA_DOMAIN)"
TLS_EMAIL="$(require_env_value "$ENV_FILE" TLS_EMAIL)"
DEPLOY_HEALTHCHECK_ATTEMPTS="$(get_env_value "$ENV_FILE" DEPLOY_HEALTHCHECK_ATTEMPTS 30)"
DEPLOY_HEALTHCHECK_INTERVAL_SECONDS="$(get_env_value "$ENV_FILE" DEPLOY_HEALTHCHECK_INTERVAL_SECONDS 5)"
GRAFANA_OAUTH_ENABLED="$(get_env_value "$ENV_FILE" GRAFANA_OAUTH_ENABLED false)"

for value in "$APP_DOMAIN" "$API_DOMAIN" "$GRAFANA_DOMAIN" "$TLS_EMAIL"; do
  if [[ "$value" == *example.com* || "$value" == *example.invalid* ]]; then
    echo "Domínios e TLS_EMAIL precisam usar valores reais antes do deploy." >&2
    exit 1
  fi
done

required_secret_files=(
  deploy/secrets/promotion_radar_metrics_token
  deploy/secrets/grafana_admin_password
  deploy/secrets/alertmanager_smtp_password
  deploy/secrets/alertmanager_telegram_bot_token
  deploy/secrets/alertmanager_primary_webhook_url
  deploy/secrets/alertmanager_secondary_webhook_url
  deploy/secrets/alertmanager_warning_webhook_url
)

for file in "${required_secret_files[@]}"; do
  if [[ ! -s "$file" ]]; then
    echo "Arquivo de credencial ausente ou vazio: $file" >&2
    exit 1
  fi
done

for webhook_file in deploy/secrets/alertmanager_*_webhook_url; do
  webhook_url="$(cat "$webhook_file")"
  if [[ ! "$webhook_url" =~ ^https:// || "$webhook_url" == *example.invalid* ]]; then
    echo "Webhook inválido em $webhook_file. Use uma URL HTTPS real." >&2
    exit 1
  fi
done

if [[ "$GRAFANA_OAUTH_ENABLED" == "true" && ! -s deploy/secrets/grafana_oauth_client_secret ]]; then
  echo "SSO está habilitado, mas grafana_oauth_client_secret está vazio." >&2
  exit 1
fi

mkdir -p .deploy
previous_release="$(get_env_value "$STATE_FILE" RELEASE_TAG none)"

sed -i -E "s|^RELEASE_TAG=.*|RELEASE_TAG=$TARGET_RELEASE|" "$ENV_FILE"
export RELEASE_TAG="$TARGET_RELEASE"

scripts/render-alertmanager.sh "$ENV_FILE"

dc() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

if dc ps --status running postgres --format json 2>/dev/null | grep -q .; then
  scripts/backup-production.sh
fi

echo "Baixando imagens da release $TARGET_RELEASE..."
dc pull migrate api worker web

echo "Iniciando dependências..."
dc up -d postgres redis

echo "Aplicando migrations compatíveis..."
dc run --rm migrate

echo "Atualizando serviços..."
dc up -d api worker web alertmanager prometheus grafana caddy

healthy=0
for ((i=1; i<=DEPLOY_HEALTHCHECK_ATTEMPTS; i++)); do
  if curl -fsS "https://${API_DOMAIN}/ready" >/dev/null \
    && curl -fsS "https://${APP_DOMAIN}/" >/dev/null \
    && curl -fsS "https://${GRAFANA_DOMAIN}/api/health" >/dev/null; then
    healthy=1
    break
  fi
  sleep "$DEPLOY_HEALTHCHECK_INTERVAL_SECONDS"
done

if [[ "$healthy" != "1" ]]; then
  echo "A release $TARGET_RELEASE falhou nos healthchecks." >&2
  dc ps >&2 || true
  dc logs --tail=200 api worker web caddy grafana >&2 || true

  if [[ "$previous_release" != "none" && "$previous_release" != "$TARGET_RELEASE" ]]; then
    echo "Executando rollback automático para $previous_release..." >&2
    scripts/rollback-production.sh "$previous_release"
  fi
  exit 1
fi

cat > "$STATE_FILE" <<EOF
RELEASE_TAG=$TARGET_RELEASE
PREVIOUS_RELEASE_TAG=$previous_release
DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
chmod 600 "$STATE_FILE"

echo "Release $TARGET_RELEASE implantada com sucesso."
echo "Aplicação: https://${APP_DOMAIN}"
echo "API: https://${API_DOMAIN}"
echo "Grafana: https://${GRAFANA_DOMAIN}"
