#!/usr/bin/env bash
set -Eeuo pipefail

CURRENT_RELEASE="${1:-}"
PREVIOUS_RELEASE="${2:-}"
ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.production.yml}"

# shellcheck source=scripts/lib/env-file.sh
source scripts/lib/env-file.sh

if [[ "${DRILL_CONFIRM:-}" != "HOMOLOGATION_DISASTER_RECOVERY" ]]; then
  echo "Drill remoto cancelado: confirmação ausente." >&2
  exit 1
fi

if [[ -z "$CURRENT_RELEASE" || -z "$PREVIOUS_RELEASE" ]]; then
  echo "Uso: DRILL_CONFIRM=HOMOLOGATION_DISASTER_RECOVERY $0 <release-atual> <release-anterior>" >&2
  exit 1
fi

APP_DOMAIN="$(require_env_value "$ENV_FILE" APP_DOMAIN)"
API_DOMAIN="$(require_env_value "$ENV_FILE" API_DOMAIN)"
GRAFANA_DOMAIN="$(require_env_value "$ENV_FILE" GRAFANA_DOMAIN)"

dc() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

smoke() {
  curl -fsS "https://${API_DOMAIN}/ready" >/dev/null
  curl -fsS "https://${APP_DOMAIN}/" >/dev/null
  curl -fsS "https://${GRAFANA_DOMAIN}/api/health" >/dev/null
}

echo "1/6 Criando backup de controle..."
backup_output="$(bash scripts/backup-production.sh)"
echo "$backup_output"
backup_path="$(grep -Eo 'backups/[0-9TZ]+' <<<"$backup_output" | tail -n1)"
[[ -n "$backup_path" ]] || { echo "Backup não identificado." >&2; exit 1; }

echo "2/6 Criando sentinelas posteriores ao backup..."
dc exec -T postgres sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 <<SQL
CREATE TABLE IF NOT EXISTS homologation_drill_sentinel(
  id text PRIMARY KEY,
  created_at timestamptz DEFAULT now()
);
INSERT INTO homologation_drill_sentinel(id)
VALUES ('"'"'after-backup'"'"')
ON CONFLICT DO NOTHING;
SQL'
dc exec -T redis sh -ec 'redis-cli -a "$REDIS_PASSWORD" SET homologation:drill:sentinel after-backup >/dev/null'

echo "3/6 Restaurando backup e validando sentinelas..."
RESTORE_CONFIRM=RESTORE_PRODUCTION bash scripts/restore-production.sh "$backup_path"
postgres_sentinel="$(dc exec -T postgres sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "SELECT to_regclass('"'"'public.homologation_drill_sentinel'"'"');"' | tr -d '\r')"
[[ -z "$postgres_sentinel" ]] || { echo "Sentinela PostgreSQL permaneceu após restore." >&2; exit 1; }
redis_sentinel="$(dc exec -T redis sh -ec 'redis-cli -a "$REDIS_PASSWORD" EXISTS homologation:drill:sentinel' | tr -d '\r')"
[[ "$redis_sentinel" == "0" ]] || { echo "Sentinela Redis permaneceu após restore." >&2; exit 1; }
smoke

echo "4/6 Testando rollback para $PREVIOUS_RELEASE..."
bash scripts/rollback-production.sh "$PREVIOUS_RELEASE"
smoke

echo "5/6 Retornando para $CURRENT_RELEASE..."
bash scripts/deploy-production.sh "$CURRENT_RELEASE"
smoke

echo "6/6 Registrando resultado..."
mkdir -p .deploy
cat > .deploy/last-dr-drill.env <<EOF
DRILL_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
BACKUP_PATH=$backup_path
ROLLBACK_RELEASE=$PREVIOUS_RELEASE
RESTORED_RELEASE=$CURRENT_RELEASE
STATUS=passed
EOF
chmod 600 .deploy/last-dr-drill.env

echo "Drill remoto aprovado."
