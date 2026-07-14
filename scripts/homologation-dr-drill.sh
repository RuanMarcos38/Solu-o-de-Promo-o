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

bash scripts/go-live-preflight.sh "$ENV_FILE"

ssh -p "$SSH_PORT" "$SSH_USER@$SSH_HOST" \
  "cd '$REMOTE_APP_DIR' && DRILL_CONFIRM=HOMOLOGATION_DISASTER_RECOVERY bash scripts/remote-homologation-dr-drill.sh '$CURRENT_RELEASE' '$PREVIOUS_RELEASE'"

bash scripts/go-live-smoke.sh "$ENV_FILE"

echo "Drill completo: backup, restore, rollback e retorno à release atual foram aprovados."
