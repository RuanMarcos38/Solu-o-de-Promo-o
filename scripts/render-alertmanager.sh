#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="${1:-.env.production}"
SOURCE_FILE="ops/alertmanager/alertmanager.example.yml"
TARGET_FILE="ops/alertmanager/generated/alertmanager.yml"

# shellcheck source=scripts/lib/env-file.sh
source scripts/lib/env-file.sh

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Arquivo $ENV_FILE não encontrado." >&2
  exit 1
fi

smtp_host="$(require_env_value "$ENV_FILE" ALERTMANAGER_SMTP_SMARTHOST)"
smtp_from="$(require_env_value "$ENV_FILE" ALERTMANAGER_SMTP_FROM)"
smtp_user="$(require_env_value "$ENV_FILE" ALERTMANAGER_SMTP_USERNAME)"
email_to="$(require_env_value "$ENV_FILE" ALERTMANAGER_EMAIL_TO)"
telegram_chat="$(require_env_value "$ENV_FILE" ALERTMANAGER_TELEGRAM_CHAT_ID)"

if [[ ! "$telegram_chat" =~ ^-?[0-9]+$ ]]; then
  echo "ALERTMANAGER_TELEGRAM_CHAT_ID precisa ser numérico." >&2
  exit 1
fi

escape_sed() {
  printf '%s' "$1" | sed -e 's/[&|\\]/\\&/g'
}

mkdir -p "$(dirname "$TARGET_FILE")"
cp "$SOURCE_FILE" "$TARGET_FILE"

smtp_host="$(escape_sed "$smtp_host")"
smtp_from="$(escape_sed "$smtp_from")"
smtp_user="$(escape_sed "$smtp_user")"
email_to="$(escape_sed "$email_to")"
telegram_chat="$(escape_sed "$telegram_chat")"

sed -i \
  -e "s|smtp.example.invalid:587|$smtp_host|g" \
  -e "s|alerts@example.invalid|$smtp_from|g" \
  -e "s|oncall@example.invalid|$email_to|g" \
  -e "s|smtp_auth_username: '$smtp_from'|smtp_auth_username: '$smtp_user'|g" \
  -e "s|chat_id: 1|chat_id: $telegram_chat|g" \
  "$TARGET_FILE"

chmod 644 "$TARGET_FILE"
echo "Alertmanager renderizado em $TARGET_FILE"
