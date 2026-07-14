#!/usr/bin/env bash
set -Eeuo pipefail

BACKUP_PATH="${1:-}"
ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.production.yml}"

# shellcheck source=scripts/lib/env-file.sh
source scripts/lib/env-file.sh

if [[ -z "$BACKUP_PATH" || ! -d "$BACKUP_PATH" ]]; then
  echo "Uso: RESTORE_CONFIRM=RESTORE_PRODUCTION $0 <diretorio-do-backup>" >&2
  exit 1
fi

if [[ "${RESTORE_CONFIRM:-}" != "RESTORE_PRODUCTION" ]]; then
  echo "Restauração cancelada. Defina RESTORE_CONFIRM=RESTORE_PRODUCTION conscientemente." >&2
  exit 1
fi

for file in postgres.dump redis.rdb metadata.env SHA256SUMS; do
  if [[ ! -f "$BACKUP_PATH/$file" ]]; then
    echo "Arquivo ausente no backup: $file" >&2
    exit 1
  fi
done

(
  cd "$BACKUP_PATH"
  sha256sum -c SHA256SUMS
)

if [[ ! -f "$ENV_FILE" || ! -f .env.production.secrets ]]; then
  echo "Ambiente de produção não preparado." >&2
  exit 1
fi

APP_DOMAIN="$(require_env_value "$ENV_FILE" APP_DOMAIN)"
API_DOMAIN="$(require_env_value "$ENV_FILE" API_DOMAIN)"
DEPLOY_HEALTHCHECK_ATTEMPTS="$(get_env_value "$ENV_FILE" DEPLOY_HEALTHCHECK_ATTEMPTS 30)"
DEPLOY_HEALTHCHECK_INTERVAL_SECONDS="$(get_env_value "$ENV_FILE" DEPLOY_HEALTHCHECK_INTERVAL_SECONDS 5)"

dc() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

absolute_backup="$(cd "$BACKUP_PATH" && pwd)"

echo "Interrompendo tráfego de escrita..."
dc stop worker api web

echo "Restaurando PostgreSQL..."
dc up -d postgres
dc exec -T postgres sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" dropdb --if-exists --maintenance-db=postgres -U "$POSTGRES_USER" "$POSTGRES_DB" && PGPASSWORD="$POSTGRES_PASSWORD" createdb --maintenance-db=postgres -U "$POSTGRES_USER" "$POSTGRES_DB"'
dc exec -T postgres sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges' < "$absolute_backup/postgres.dump"

echo "Restaurando Redis..."
dc stop redis
dc run --rm --no-deps -v "$absolute_backup:/restore:ro" redis sh -ec 'cp /restore/redis.rdb /data/dump.rdb && chown redis:redis /data/dump.rdb'
dc up -d redis

echo "Validando schema e reiniciando serviços..."
dc run --rm migrate
dc up -d api worker web alertmanager prometheus grafana caddy

for ((i=1; i<=DEPLOY_HEALTHCHECK_ATTEMPTS; i++)); do
  if curl -fsS "https://${API_DOMAIN}/ready" >/dev/null \
    && curl -fsS "https://${APP_DOMAIN}/" >/dev/null; then
    echo "Restauração concluída com sucesso."
    exit 0
  fi
  sleep "$DEPLOY_HEALTHCHECK_INTERVAL_SECONDS"
done

echo "Dados restaurados, mas a aplicação não passou no healthcheck." >&2
dc logs --tail=200 api worker postgres redis >&2 || true
exit 1
