#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/promotion-radar}"
RUNTIME_DIR="${RUNTIME_DIR:-/root/promotion-radar}"
STACK_NAME="${STACK_NAME:-promotion-radar}"

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

for file in postgres.env redis.env application.env; do
  if [ ! -s "$RUNTIME_DIR/$file" ]; then
    echo "Arquivo protegido ausente ou vazio: $RUNTIME_DIR/$file" >&2
    exit 1
  fi
done

chmod 700 "$RUNTIME_DIR"
chmod 600 "$RUNTIME_DIR"/*.env

git -C "$APP_DIR" fetch origin --prune
git -C "$APP_DIR" checkout main
git -C "$APP_DIR" reset --hard origin/main

cd "$APP_DIR"
IMAGE_TAG="$(git rev-parse --short=12 HEAD)"
export IMAGE_TAG

for image in api worker web; do
  docker image inspect "promotion-radar-${image}:${IMAGE_TAG}" >/dev/null 2>&1 || {
    echo "Imagem ausente: promotion-radar-${image}:${IMAGE_TAG}" >&2
    echo "Execute novamente scripts/easypanel-build-bootstrap.sh antes do deploy." >&2
    exit 1
  }
done

docker network inspect easypanel >/dev/null

docker stack deploy \
  --resolve-image never \
  --prune \
  -c deploy/easypanel/core-stack.yml \
  "$STACK_NAME"

sleep 20

echo "===== SERVIÇOS ====="
docker stack services "$STACK_NAME"

echo "===== TAREFAS COM FALHA ====="
docker stack ps "$STACK_NAME" --no-trunc --filter desired-state=shutdown | head -30 || true

echo "CORE_DEPLOY_SUBMITTED image_tag=$IMAGE_TAG"
