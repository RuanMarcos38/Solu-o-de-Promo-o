#!/usr/bin/env bash
set -Eeuo pipefail

BACKUP_PATH="${1:-}"
ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.production.yml}"

if [[ -z "$BACKUP_PATH" || ! -d "$BACKUP_PATH" ]]; then
  echo "Uso: RESTORE_CONFIRM=RESTORE_PRODUCTION $0 <diretorio-do-backup>" >&2
  exit 1
fi

if [[ "${RESTORE_CONFIRM:-}" != "RESTORE_PRODUCTION" ]]; then
  echo "Restauração cancelada. Defina RESTORE_CONFIRM=RESTORE_PRODUCTION conscientemente." >&2
  exit 1
fi

for file in postgres.dump redis.rdb SHA256SUMS; do
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

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

dc() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

absolute_backup="$(cd "$BACKUP_PATH" && pwd)"

echo "Interrompendo tráfego de escrita..."
dc stop worker api web

echo "Restaurando PostgreSQL..."
dc up -d postgres
dc exec -T postgres sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" dropdb --if-exists -U "$POSTGRES_USER" "$POSTGRES_DB" && PGPASSWORD="$POSTGRES_PASSWORD" createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
dc exec -T postgres sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges' < "$absolute_backup/postgres.dump"

echo "Restaurando Redis..."
dc stop redis
dc run --rm --no-deps -v "$absolute_backup:/restore:ro" redis sh -ec 'cp /restore/redis.rdb /data/dump.rdb && chown redis:redis /data/dump.rdb'
dc up -d redis

echo "Validando schema e reiniciando serviços..."
dc run --rm migrate
dc up -d api worker web alertmanager prometheus grafana caddy

for _ in {1..30}; do
  if curl -fsS "https://${API_DOMAIN}/ready" >/dev/null \
    && curl -fsS "https://${APP_DOMAIN}/" >/dev/null; then
    echo "Restauração concluída com sucesso."
    exit 0
  fi
  sleep 5
done

echo "Dados restaurados, mas a aplicação não passou no healthcheck." >&2
dc logs --tail=200 api worker postgres redis >&2 || true
exit 1
