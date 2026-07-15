#!/bin/sh
set -eu

required_env="
ALERTMANAGER_SMTP_SMARTHOST
ALERTMANAGER_SMTP_FROM
ALERTMANAGER_SMTP_USERNAME
ALERTMANAGER_EMAIL_TO
ALERTMANAGER_TELEGRAM_CHAT_ID
"

for name in $required_env; do
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then
    echo "Variável obrigatória ausente: $name" >&2
    exit 1
  fi
done

required_files="
/run/secrets/alertmanager_smtp_password
/run/secrets/alertmanager_telegram_bot_token
/run/secrets/alertmanager_primary_webhook_url
/run/secrets/alertmanager_secondary_webhook_url
/run/secrets/alertmanager_warning_webhook_url
"

for file in $required_files; do
  if [ ! -s "$file" ]; then
    echo "Secret obrigatório ausente ou vazio: $file" >&2
    exit 1
  fi
done

mkdir -p /etc/alertmanager/generated /alertmanager
envsubst < /etc/alertmanager/alertmanager.yml.tmpl > /etc/alertmanager/generated/alertmanager.yml

amtool check-config /etc/alertmanager/generated/alertmanager.yml

exec alertmanager \
  --config.file=/etc/alertmanager/generated/alertmanager.yml \
  --storage.path=/alertmanager \
  --web.listen-address=0.0.0.0:9093
