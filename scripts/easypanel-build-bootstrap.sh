#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/promotion-radar}"
REPOSITORY="https://github.com/RuanMarcos38/Solu-o-de-Promo-o.git"
BRANCH="${BRANCH:-main}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Execute como root." >&2
  exit 1
fi

for command in git docker; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "Comando obrigatório ausente: $command" >&2
    exit 1
  }
done

docker info >/dev/null
docker network inspect easypanel >/dev/null

if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin --prune
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/$BRANCH"
elif [ -e "$APP_DIR" ]; then
  echo "A pasta $APP_DIR já existe e não é um repositório Git. Nada foi removido." >&2
  exit 1
else
  git clone --branch "$BRANCH" --single-branch "$REPOSITORY" "$APP_DIR"
fi

cd "$APP_DIR"

COMMIT_SHA="$(git rev-parse --short=12 HEAD)"
echo "Construindo commit $COMMIT_SHA"

docker build --pull -f Dockerfile -t "promotion-radar-api:$COMMIT_SHA" -t promotion-radar-api:current .
docker build --pull -f Dockerfile.worker -t "promotion-radar-worker:$COMMIT_SHA" -t promotion-radar-worker:current .
docker build --pull -f Dockerfile.web --build-arg VITE_API_URL=https://api-ofertas.r2rmarketingdigital.com.br -t "promotion-radar-web:$COMMIT_SHA" -t promotion-radar-web:current .
docker build --pull -f Dockerfile.prometheus -t "promotion-radar-prometheus:$COMMIT_SHA" -t promotion-radar-prometheus:current .
docker build --pull -f Dockerfile.grafana -t "promotion-radar-grafana:$COMMIT_SHA" -t promotion-radar-grafana:current .
docker build --pull -f Dockerfile.alertmanager -t "promotion-radar-alertmanager:$COMMIT_SHA" -t promotion-radar-alertmanager:current .

echo "===== IMAGENS CONSTRUÍDAS ====="
docker image ls --format '{{.Repository}}:{{.Tag}} {{.Size}}' | grep '^promotion-radar-' | sort

echo "===== RECURSOS ====="
df -h /
free -h

echo "BUILD_OK commit=$COMMIT_SHA"
