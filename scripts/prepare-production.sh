#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DOMAIN="${1:-}"
TLS_CONTACT="${2:-}"

if [[ -z "$ROOT_DOMAIN" || -z "$TLS_CONTACT" ]]; then
  echo "Uso: $0 <dominio-raiz> <email-tls>" >&2
  echo "Exemplo: $0 ofertas.exemplo.com admin@exemplo.com" >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl é obrigatório para gerar valores aleatórios." >&2
  exit 1
fi

if [[ -e .env.production || -e .env.production.secrets ]]; then
  echo "Arquivos de produção já existem. Faça backup ou remova-os explicitamente antes de regenerar." >&2
  exit 1
fi

umask 077
cp .env.production.example .env.production

APP_DOMAIN="$ROOT_DOMAIN"
API_DOMAIN="api.$ROOT_DOMAIN"
GRAFANA_DOMAIN="grafana.$ROOT_DOMAIN"

sed -i \
  -e "s|^APP_DOMAIN=.*|APP_DOMAIN=$APP_DOMAIN|" \
  -e "s|^API_DOMAIN=.*|API_DOMAIN=$API_DOMAIN|" \
  -e "s|^GRAFANA_DOMAIN=.*|GRAFANA_DOMAIN=$GRAFANA_DOMAIN|" \
  -e "s|^TLS_EMAIL=.*|TLS_EMAIL=$TLS_CONTACT|" \
  -e "s|^PUBLIC_API_URL=.*|PUBLIC_API_URL=https://$API_DOMAIN|" \
  -e "s|^FRONTEND_ORIGINS=.*|FRONTEND_ORIGINS=https://$APP_DOMAIN|" \
  -e "s|^OPERATIONAL_ALERT_DASHBOARD_URL=.*|OPERATIONAL_ALERT_DASHBOARD_URL=https://$GRAFANA_DOMAIN|" \
  .env.production

random_hex() {
  openssl rand -hex "${1:-32}"
}

POSTGRES_PASSWORD_VALUE="$(random_hex 24)"
REDIS_PASSWORD_VALUE="$(random_hex 24)"
JWT_SECRET_VALUE="$(random_hex 48)"
CHANNEL_KEY_VALUE="$(openssl rand -base64 32 | tr -d '\n')"
ADMIN_PASSWORD_VALUE="$(random_hex 18)"
METRICS_TOKEN_VALUE="$(random_hex 32)"
GRAFANA_PASSWORD_VALUE="$(random_hex 18)"

cat > .env.production.secrets <<EOF
POSTGRES_PASSWORD=$POSTGRES_PASSWORD_VALUE
REDIS_PASSWORD=$REDIS_PASSWORD_VALUE
# Preencha com a URL Session Pooler do Supabase, sempre com schema=zenite_ofertas.
DATABASE_URL=
REDIS_URL=redis://:$REDIS_PASSWORD_VALUE@redis:6379
JWT_SECRET=$JWT_SECRET_VALUE
CHANNEL_CONFIG_ENCRYPTION_KEY=$CHANNEL_KEY_VALUE
ADMIN_PASSWORD=$ADMIN_PASSWORD_VALUE
METRICS_BEARER_TOKEN=$METRICS_TOKEN_VALUE
OPERATIONAL_ALERT_TELEGRAM_BOT_TOKEN=
OPERATIONAL_ALERT_WEBHOOK_URL=
OPERATIONAL_ALERT_WEBHOOK_SECRET=$(random_hex 32)
SMTP_PASS=
MERCADO_LIVRE_ACCESS_TOKEN=
AFFILIATE_LINK_RESOLVER_TOKEN=
AMAZON_CREATORS_CREDENTIAL_ID=
AMAZON_CREATORS_CREDENTIAL_SECRET=
SHOPEE_SECRET=
EOF

mkdir -p deploy/secrets ops/alertmanager/generated backups .deploy
chmod 700 deploy/secrets backups .deploy
chmod 600 .env.production .env.production.secrets

printf '%s' "$METRICS_TOKEN_VALUE" > deploy/secrets/promotion_radar_metrics_token
printf '%s' "$GRAFANA_PASSWORD_VALUE" > deploy/secrets/grafana_admin_password
printf '%s' '' > deploy/secrets/grafana_oauth_client_secret
printf '%s' '' > deploy/secrets/alertmanager_smtp_password
printf '%s' '' > deploy/secrets/alertmanager_telegram_bot_token
printf '%s' 'https://example.invalid/primary-disabled' > deploy/secrets/alertmanager_primary_webhook_url
printf '%s' 'https://example.invalid/secondary-disabled' > deploy/secrets/alertmanager_secondary_webhook_url
printf '%s' 'https://example.invalid/warning-disabled' > deploy/secrets/alertmanager_warning_webhook_url
chmod 644 deploy/secrets/*

cp ops/alertmanager/alertmanager.example.yml ops/alertmanager/generated/alertmanager.yml
chmod 644 ops/alertmanager/generated/alertmanager.yml

cat > .deploy/current-release <<EOF
RELEASE_TAG=none
PREVIOUS_RELEASE_TAG=none
EOF
chmod 600 .deploy/current-release

unset POSTGRES_PASSWORD_VALUE REDIS_PASSWORD_VALUE JWT_SECRET_VALUE CHANNEL_KEY_VALUE
unset ADMIN_PASSWORD_VALUE METRICS_TOKEN_VALUE GRAFANA_PASSWORD_VALUE

echo "Ambiente preparado para $APP_DOMAIN."
echo "Edite .env.production, .env.production.secrets e deploy/secrets/ antes do primeiro deploy."
echo "Configure DNS A/AAAA para $APP_DOMAIN, $API_DOMAIN e $GRAFANA_DOMAIN."
