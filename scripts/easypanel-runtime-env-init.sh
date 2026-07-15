#!/usr/bin/env bash
set -Eeuo pipefail

TARGET_DIR="${TARGET_DIR:-/root/promotion-radar}"
TEMPLATE="${TEMPLATE:-/opt/promotion-radar/deploy/easypanel/easypanel.env.example}"
ADMIN_EMAIL_VALUE="${ADMIN_EMAIL_VALUE:-ruanessencia8@gmail.com}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Execute como root." >&2
  exit 1
fi

if [ ! -s "$TEMPLATE" ]; then
  echo "Template ausente: $TEMPLATE" >&2
  exit 1
fi

for file in postgres.env redis.env application.env admin-credentials.txt; do
  if [ -e "$TARGET_DIR/$file" ] && [ "${FORCE:-0}" != "1" ]; then
    echo "Arquivo já existe: $TARGET_DIR/$file. Nada foi sobrescrito." >&2
    exit 1
  fi
done

install -d -m 700 "$TARGET_DIR"
umask 077

PG="$(openssl rand -hex 24)"
RD="$(openssl rand -hex 24)"
JWT="$(openssl rand -hex 48)"
ENC="$(openssl rand -hex 32)"
ADM="$(openssl rand -hex 18)"
MET="$(openssl rand -hex 32)"
WEB="$(openssl rand -hex 32)"

printf 'POSTGRES_DB=promo_db\nPOSTGRES_USER=promo\nPOSTGRES_PASSWORD=%s\n' "$PG" > "$TARGET_DIR/postgres.env"
printf 'REDIS_PASSWORD=%s\n' "$RD" > "$TARGET_DIR/redis.env"
cp "$TEMPLATE" "$TARGET_DIR/application.env"

sed -i \
  -e "s#^DATABASE_URL=.*#DATABASE_URL=postgresql://promo:${PG}@postgres:5432/promo_db?schema=public#" \
  -e "s#^REDIS_URL=.*#REDIS_URL=redis://:${RD}@redis:6379#" \
  -e "s#^JWT_SECRET=.*#JWT_SECRET=${JWT}#" \
  -e "s#^CHANNEL_CONFIG_ENCRYPTION_KEY=.*#CHANNEL_CONFIG_ENCRYPTION_KEY=${ENC}#" \
  -e "s#^ADMIN_EMAIL=.*#ADMIN_EMAIL=${ADMIN_EMAIL_VALUE}#" \
  -e "s#^ADMIN_PASSWORD=.*#ADMIN_PASSWORD=${ADM}#" \
  -e "s#^OPERATIONAL_ALERT_WEBHOOK_SECRET=.*#OPERATIONAL_ALERT_WEBHOOK_SECRET=${WEB}#" \
  -e "s#^METRICS_BEARER_TOKEN=.*#METRICS_BEARER_TOKEN=${MET}#" \
  "$TARGET_DIR/application.env"

printf 'ADMIN_EMAIL=%s\nADMIN_PASSWORD=%s\n' "$ADMIN_EMAIL_VALUE" "$ADM" > "$TARGET_DIR/admin-credentials.txt"
chmod 600 "$TARGET_DIR"/*.env "$TARGET_DIR/admin-credentials.txt"

for file in postgres.env redis.env application.env admin-credentials.txt; do
  [ -s "$TARGET_DIR/$file" ] || {
    echo "Falha ao criar $TARGET_DIR/$file" >&2
    exit 1
  }
done

unset PG RD JWT ENC ADM MET WEB

echo "RUNTIME_ENV_READY"
