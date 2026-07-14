#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.production.yml}"
STATE_FILE="${STATE_FILE:-.deploy/current-release}"
TARGET_RELEASE="${1:-}"

if [[ ! -f "$ENV_FILE" || ! -f "$COMPOSE_FILE" ]]; then
  echo "Ambiente de produção não preparado." >&2
  exit 1
fi

current_release="none"
previous_release="none"
if [[ -f "$STATE_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$STATE_FILE"
  current_release="${RELEASE_TAG:-none}"
  previous_release="${PREVIOUS_RELEASE_TAG:-none}"
fi

if [[ -z "$TARGET_RELEASE" ]]; then
  TARGET_RELEASE="$previous_release"
fi

if [[ -z "$TARGET_RELEASE" || "$TARGET_RELEASE" == "none" ]]; then
  echo "Nenhuma release anterior disponível para rollback." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

sed -i -E "s|^RELEASE_TAG=.*|RELEASE_TAG=$TARGET_RELEASE|" "$ENV_FILE"
export RELEASE_TAG="$TARGET_RELEASE"

dc() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

echo "Baixando imagens da release $TARGET_RELEASE..."
dc pull api worker web

echo "Recriando aplicação sem executar nova migration..."
dc up -d --no-deps api worker web

attempts="${DEPLOY_HEALTHCHECK_ATTEMPTS:-30}"
interval="${DEPLOY_HEALTHCHECK_INTERVAL_SECONDS:-5}"
healthy=0
for ((i=1; i<=attempts; i++)); do
  if curl -fsS "https://${API_DOMAIN}/ready" >/dev/null \
    && curl -fsS "https://${APP_DOMAIN}/" >/dev/null; then
    healthy=1
    break
  fi
  sleep "$interval"
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
