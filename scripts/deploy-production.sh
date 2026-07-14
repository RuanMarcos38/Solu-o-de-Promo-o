#!/usr/bin/env bash
set -Eeuo pipefail

TARGET_RELEASE="${1:-}"
ENV_FILE="${ENV_FILE:-.env.production}"
SECRETS_ENV_FILE="${SECRETS_ENV_FILE:-.env.production.secrets}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.production.yml}"
STATE_FILE="${STATE_FILE:-.deploy/current-release}"

if [[ -z "$TARGET_RELEASE" ]]; then
  echo "Uso: $0 <release-tag>" >&2
  exit 1
fi

for file in "$ENV_FILE" "$SECRETS_ENV_FILE" "$COMPOSE_FILE"; do
  if [[ ! -f "$file" ]]; then
    echo "Arquivo obrigatório ausente: $file" >&2
    exit 1
  fi
done

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

for value in "${APP_DOMAIN:-}" "${API_DOMAIN:-}" "${GRAFANA_DOMAIN:-}" "${TLS_EMAIL:-}"; do
  if [[ -z "$value" || "$value" == *example.com* ]]; then
    echo "Domínios e TLS_EMAIL precisam ser configurados antes do deploy." >&2
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
  if [[ ! -f "$file" ]]; then
    echo "Arquivo de credencial ausente: $file" >&2
    exit 1
  fi
done

mkdir -p .deploy
previous_release="none"
if [[ -f "$STATE_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$STATE_FILE"
  previous_release="${RELEASE_TAG:-none}"
fi

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

attempts="${DEPLOY_HEALTHCHECK_ATTEMPTS:-30}"
interval="${DEPLOY_HEALTHCHECK_INTERVAL_SECONDS:-5}"
healthy=0

for ((i=1; i<=attempts; i++)); do
  if curl -fsS "https://${API_DOMAIN}/ready" >/dev/null \
    && curl -fsS "https://${APP_DOMAIN}/" >/dev/null \
    && curl -fsS "https://${GRAFANA_DOMAIN}/api/health" >/dev/null; then
    healthy=1
    break
  fi
  sleep "$interval"
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
