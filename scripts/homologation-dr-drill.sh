#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="${1:-deploy/homologation.env}"

# shellcheck source=scripts/lib/env-file.sh
source scripts/lib/env-file.sh

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Arquivo de homologação não encontrado: $ENV_FILE" >&2
  exit 1
fi

if [[ "$(get_env_value "$ENV_FILE" DRILL_CONFIRM '')" != "HOMOLOGATION_DISASTER_RECOVERY" ]]; then
  echo "Drill cancelado. Defina DRILL_CONFIRM=HOMOLOGATION_DISASTER_RECOVERY no arquivo de homologação." >&2
  exit 1
fi

SSH_HOST="$(require_env_value "$ENV_FILE" SSH_HOST)"
SSH_PORT="$(get_env_value "$ENV_FILE" SSH_PORT 22)"
SSH_USER="$(require_env_value "$ENV_FILE" SSH_USER)"
REMOTE_APP_DIR="$(require_env_value "$ENV_FILE" REMOTE_APP_DIR)"
CURRENT_RELEASE="$(require_env_value "$ENV_FILE" DRILL_CURRENT_RELEASE)"
PREVIOUS_RELEASE="$(require_env_value "$ENV_FILE" DRILL_PREVIOUS_RELEASE)"

remote() {
  ssh -p "$SSH_PORT" "$SSH_USER@$SSH_HOST" "cd '$REMOTE_APP_DIR' && $*"
}

echo "1/6 Criando backup de controle..."
backup_output="$(remote 'bash scripts/backup-production.sh')"
echo "$backup_output"
backup_path="$(grep -Eo 'backups/[0-9TZ]+' <<<"$backup_output" | tail -n1)"
if [[ -z "$backup_path" ]]; then
  echo "Não foi possível identificar o diretório do backup." >&2
  exit 1
fi

echo "2/6 Criando sentinelas posteriores ao backup..."
remote "docker compose --env-file .env.production -f compose.production.yml exec -T postgres sh -ec 'PGPASSWORD=\"\$POSTGRES_PASSWORD\" psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -v ON_ERROR_STOP=1 -c \"CREATE TABLE IF NOT EXISTS homologation_drill_sentinel(id text primary key, created_at timestamptz default now()); INSERT INTO homologation_drill_sentinel(id) VALUES (''after-backup'') ON CONFLICT DO NOTHING;\"'"
remote "docker compose --env-file .env.production -f compose.production.yml exec -T redis sh -ec 'redis-cli -a \"\$REDIS_PASSWORD\" SET homologation:drill:sentinel after-backup >/dev/null'"

echo "3/6 Restaurando o backup e validando remoção das sentinelas..."
remote "RESTORE_CONFIRM=RESTORE_PRODUCTION bash scripts/restore-production.sh '$backup_path'"
remote "docker compose --env-file .env.production -f compose.production.yml exec -T postgres sh -ec 'PGPASSWORD=\"\$POSTGRES_PASSWORD\" psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -Atqc \"SELECT to_regclass(''''public.homologation_drill_sentinel'''');\" | grep -qx ""'"
remote "docker compose --env-file .env.production -f compose.production.yml exec -T redis sh -ec 'test \"\$(redis-cli -a \"\$REDIS_PASSWORD\" EXISTS homologation:drill:sentinel)\" = 0'"

echo "4/6 Testando rollback para $PREVIOUS_RELEASE..."
remote "bash scripts/rollback-production.sh '$PREVIOUS_RELEASE'"
bash scripts/go-live-smoke.sh "$ENV_FILE"

echo "5/6 Retornando para $CURRENT_RELEASE..."
remote "bash scripts/deploy-production.sh '$CURRENT_RELEASE'"
bash scripts/go-live-smoke.sh "$ENV_FILE"

echo "6/6 Registrando resultado do drill..."
remote "mkdir -p .deploy && printf '%s\n' 'DRILL_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)' 'BACKUP_PATH=$backup_path' 'ROLLBACK_RELEASE=$PREVIOUS_RELEASE' 'RESTORED_RELEASE=$CURRENT_RELEASE' 'STATUS=passed' > .deploy/last-dr-drill.env && chmod 600 .deploy/last-dr-drill.env"

echo "Drill completo: backup, restore, rollback e retorno à release atual foram aprovados."
