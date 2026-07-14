#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.production.yml}"
STATE_FILE="${STATE_FILE:-.deploy/current-release}"
TARGET_RELEASE="${1:-}"

# shellcheck source=scripts/lib/env-file.sh
source scripts/lib/env-file.sh

if [[ ! -f "$ENV_FILE" || ! -f "$COMPOSE_FILE" ]]; then
  echo "Ambiente de produção não preparado." >&2
  exit 1
fi

current_release="$(get_env_value "$STATE_FILE" RELEASE_TAG none)"
previous_release="$(get_env_value "$STATE_FILE" PREVIOUS_RELEASE_TAG none)"

if [[ -z "$TARGET_RELEASE" ]]; then
  TARGET_RELEASE="$previous_release"
fi

if [[ -z "$TARGET_RELEASE" || "$TARGET_RELEASE" == "none" || ! "$TARGET_RELEASE" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "Nenhuma release anterior válida disponível para rollback." >&2
  exit 1
fi

APP_DOMAIN="$(require_env_value "$ENV_FILE" APP_DOMAIN)"
API_DOMAIN="$(require_env_value "$ENV_FILE" API_DOMAIN)"
DEPLOY_HEALTHCHECK_ATTEMPTS="$(get_env_value "$ENV_FILE" DEPLOY_HEALTHCHECK_ATTEMPTS 30)"
DEPLOY_HEALTHCHECK_INTERVAL_SECONDS="$(get_env_value "$ENV_FILE" DEPLOY_HEALTHCHECK_INTERVAL_SECONDS 5)"

sed -i -E "s|^RELEASE_TAG=.*|RELEASE_TAG=$TARGET_RELEASE|" "$ENV_FILE"
export RELEASE_TAG="$TARGET_RELEASE"

dc() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

echo "Baixando imagens da release $TARGET_RELEASE..."
dc pull api worker web

echo "Recriando aplicação sem executar nova migration..."
dc up -d --no-deps api worker web

healthy=0
for ((i=1; i<=DEPLOY_HEALTHCHECK_ATTEMPTS; i++)); do
  if curl -fsS "https://${API_DOMAIN}/ready" >/dev/null \
    && curl -fsS "https://${APP_DOMAIN}/" >/dev/null; then
    healthy=1
    break
  fi
  sleep "$DEPLOY_HEALTHCHECK_INTERVAL_SECONDS"
done

if [[ "$healthy" != "1" ]]; then
  echo "Rollback para $TARGET_RELEASE falhou nos healthchecks." >&2
  dc logs --tail=200 api worker web caddy >&2 || true
  exit 1
fi

cat > "$STATE_FILE" <<EOF
RELEASE_TAG=$TARGET_RELEASE
PREVIOUS_RELEASE_TAG=$current_release
ROLLED_BACK_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
chmod 600 "$STATE_FILE"

echo "Rollback concluído para $TARGET_RELEASE."
echo "Atenção: rollback de imagem exige migrations backward-compatible pelo padrão expand/contract."
