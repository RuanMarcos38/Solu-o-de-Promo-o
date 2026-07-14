#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="${1:-.env.production}"
SOURCE_FILE="ops/alertmanager/alertmanager.example.yml"
TARGET_FILE="ops/alertmanager/generated/alertmanager.yml"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Arquivo $ENV_FILE não encontrado." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

required=(
  ALERTMANAGER_SMTP_SMARTHOST
  ALERTMANAGER_SMTP_FROM
  ALERTMANAGER_SMTP_USERNAME
  ALERTMANAGER_EMAIL_TO
  ALERTMANAGER_TELEGRAM_CHAT_ID
)

for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "$name precisa ser configurado em $ENV_FILE" >&2
    exit 1
  fi
done

escape_sed() {
  printf '%s' "$1" | sed -e 's/[&|\\]/\\&/g'
}

mkdir -p "$(dirname "$TARGET_FILE")"
cp "$SOURCE_FILE" "$TARGET_FILE"

smtp_host="$(escape_sed "$ALERTMANAGER_SMTP_SMARTHOST")"
smtp_from="$(escape_sed "$ALERTMANAGER_SMTP_FROM")"
smtp_user="$(escape_sed "$ALERTMANAGER_SMTP_USERNAME")"
email_to="$(escape_sed "$ALERTMANAGER_EMAIL_TO")"
telegram_chat="$(escape_sed "$ALERTMANAGER_TELEGRAM_CHAT_ID")"

sed -i \
  -e "s|smtp.example.invalid:587|$smtp_host|g" \
  -e "s|alerts@example.invalid|$smtp_from|g" \
  -e "s|oncall@example.invalid|$email_to|g" \
  -e "s|smtp_auth_username: '$smtp_from'|smtp_auth_username: '$smtp_user'|g" \
  -e "s|chat_id: 1|chat_id: $telegram_chat|g" \
  "$TARGET_FILE"

chmod 644 "$TARGET_FILE"
echo "Alertmanager renderizado em $TARGET_FILE"
