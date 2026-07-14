#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.production.yml}"

if [[ ! -f "$ENV_FILE" || ! -f .env.production.secrets ]]; then
  echo "Arquivos de produção não encontrados." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

BACKUP_ROOT="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
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
dc exec -T redis sh -ec 'redis-cli -a "$REDIS_PASSWORD" BGSAVE >/dev/null; while [ "$(redis-cli -a "$REDIS_PASSWORD" INFO persistence | tr -d "\r" | awk -F: "/rdb_bgsave_in_progress/{print \$2}")" = "1" ]; do sleep 1; done'
dc cp redis:/data/dump.rdb "$TARGET_DIR/redis.rdb"

release_tag="unknown"
if [[ -f .deploy/current-release ]]; then
  release_tag="$(awk -F= '$1=="RELEASE_TAG"{print $2}' .deploy/current-release | tail -n1)"
fi

cat > "$TARGET_DIR/metadata.env" <<EOF
CREATED_AT=$TIMESTAMP
RELEASE_TAG=${release_tag:-unknown}
POSTGRES_DB=${POSTGRES_DB:-promo_db}
POSTGRES_USER=${POSTGRES_USER:-promo}
EOF

(
  cd "$TARGET_DIR"
  sha256sum postgres.dump redis.rdb metadata.env > SHA256SUMS
)
chmod 600 "$TARGET_DIR"/*

if [[ -n "${BACKUP_ENCRYPTION_RECIPIENT:-}" ]]; then
  if ! command -v age >/dev/null 2>&1; then
    echo "BACKUP_ENCRYPTION_RECIPIENT foi definido, mas o comando age não está instalado." >&2
    exit 1
  fi
  tar -C "$BACKUP_ROOT" -czf - "$TIMESTAMP" | age -r "$BACKUP_ENCRYPTION_RECIPIENT" -o "$BACKUP_ROOT/$TIMESTAMP.tar.gz.age"
  chmod 600 "$BACKUP_ROOT/$TIMESTAMP.tar.gz.age"
  rm -rf "$TARGET_DIR"
  echo "Backup criptografado: $BACKUP_ROOT/$TIMESTAMP.tar.gz.age"
else
  echo "Backup criado: $TARGET_DIR"
fi

find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -mtime "+$RETENTION_DAYS" -exec rm -rf {} +
