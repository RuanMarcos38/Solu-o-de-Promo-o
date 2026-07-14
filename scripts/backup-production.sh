#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.production.yml}"
STATE_FILE="${STATE_FILE:-.deploy/current-release}"

# shellcheck source=scripts/lib/env-file.sh
source scripts/lib/env-file.sh

if [[ ! -f "$ENV_FILE" || ! -f .env.production.secrets ]]; then
  echo "Arquivos de produção não encontrados." >&2
  exit 1
fi

BACKUP_ROOT="$(get_env_value "$ENV_FILE" BACKUP_DIR ./backups)"
RETENTION_DAYS="$(get_env_value "$ENV_FILE" BACKUP_RETENTION_DAYS 14)"
ENCRYPTION_RECIPIENT="$(get_env_value "$ENV_FILE" BACKUP_ENCRYPTION_RECIPIENT '')"
POSTGRES_DB_VALUE="$(get_env_value "$ENV_FILE" POSTGRES_DB promo_db)"
POSTGRES_USER_VALUE="$(get_env_value "$ENV_FILE" POSTGRES_USER promo)"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET_DIR="$BACKUP_ROOT/$TIMESTAMP"
mkdir -p "$TARGET_DIR"
chmod 700 "$BACKUP_ROOT" "$TARGET_DIR"

dc() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

if ! dc ps --status running postgres --format json 2>/dev/null | grep -q .; then
  echo "PostgreSQL não está em execução." >&2
  exit 1
fi

if ! dc ps --status running redis --format json 2>/dev/null | grep -q .; then
  echo "Redis não está em execução." >&2
  exit 1
fi

echo "Exportando PostgreSQL..."
dc exec -T postgres sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$TARGET_DIR/postgres.dump"

echo "Criando snapshot Redis..."
dc exec -T redis sh -ec 'redis-cli -a "$REDIS_PASSWORD" BGSAVE >/dev/null || true; while [ "$(redis-cli -a "$REDIS_PASSWORD" INFO persistence | tr -d "\r" | awk -F: "/rdb_bgsave_in_progress/{print \$2}")" = "1" ]; do sleep 1; done; test "$(redis-cli -a "$REDIS_PASSWORD" INFO persistence | tr -d "\r" | awk -F: "/rdb_last_bgsave_status/{print \$2}")" = "ok"'
dc cp redis:/data/dump.rdb "$TARGET_DIR/redis.rdb"

release_tag="$(get_env_value "$STATE_FILE" RELEASE_TAG unknown)"
cat > "$TARGET_DIR/metadata.env" <<EOF
CREATED_AT=$TIMESTAMP
RELEASE_TAG=${release_tag:-unknown}
POSTGRES_DB=$POSTGRES_DB_VALUE
POSTGRES_USER=$POSTGRES_USER_VALUE
EOF

(
  cd "$TARGET_DIR"
  sha256sum postgres.dump redis.rdb metadata.env > SHA256SUMS
)
chmod 600 "$TARGET_DIR"/*

if [[ -n "$ENCRYPTION_RECIPIENT" ]]; then
  if ! command -v age >/dev/null 2>&1; then
    echo "BACKUP_ENCRYPTION_RECIPIENT foi definido, mas o comando age não está instalado." >&2
    exit 1
  fi
  tar -C "$BACKUP_ROOT" -czf - "$TIMESTAMP" | age -r "$ENCRYPTION_RECIPIENT" -o "$BACKUP_ROOT/$TIMESTAMP.tar.gz.age"
  chmod 600 "$BACKUP_ROOT/$TIMESTAMP.tar.gz.age"
  rm -rf "$TARGET_DIR"
  echo "Backup criptografado: $BACKUP_ROOT/$TIMESTAMP.tar.gz.age"
else
  echo "Backup criado: $TARGET_DIR"
fi

if [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -mtime "+$RETENTION_DAYS" -exec rm -rf {} +
else
  echo "BACKUP_RETENTION_DAYS inválido: $RETENTION_DAYS" >&2
  exit 1
fi
