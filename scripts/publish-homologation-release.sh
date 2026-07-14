#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="${1:-deploy/homologation.env}"

# shellcheck source=scripts/lib/env-file.sh
source scripts/lib/env-file.sh

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Arquivo de homologação não encontrado: $ENV_FILE" >&2
  exit 1
fi

RELEASE_TAG="$(require_env_value "$ENV_FILE" RELEASE_TAG)"
PUBLIC_API_URL="$(require_env_value "$ENV_FILE" PUBLIC_API_URL)"
SSH_HOST="$(require_env_value "$ENV_FILE" SSH_HOST)"
SSH_PORT="$(get_env_value "$ENV_FILE" SSH_PORT 22)"
SSH_USER="$(require_env_value "$ENV_FILE" SSH_USER)"
REMOTE_APP_DIR="$(require_env_value "$ENV_FILE" REMOTE_APP_DIR)"

if [[ ! "$RELEASE_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+-rc\.[0-9]+$ ]]; then
  echo "RELEASE_TAG de homologação inválida: $RELEASE_TAG" >&2
  exit 1
fi

if [[ ! "$PUBLIC_API_URL" =~ ^https:// ]]; then
  echo "PUBLIC_API_URL precisa usar HTTPS." >&2
  exit 1
fi

for command in gh ssh; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Comando obrigatório ausente: $command" >&2
    exit 1
  fi
done

gh auth status >/dev/null

bash scripts/go-live-preflight.sh "$ENV_FILE"

echo "Publicando imagens $RELEASE_TAG no GHCR..."
gh workflow run release-images.yml \
  --ref main \
  -f release_tag="$RELEASE_TAG" \
  -f public_api_url="$PUBLIC_API_URL"

run_id=""
for _ in {1..20}; do
  run_id="$(gh run list --workflow release-images.yml --branch main --limit 10 --json databaseId,displayTitle,status \
    --jq '.[] | select(.displayTitle | contains("Release Images")) | .databaseId' | head -n1)"
  [[ -n "$run_id" ]] && break
  sleep 3
done

if [[ -z "$run_id" ]]; then
  echo "Não foi possível identificar o workflow Release Images." >&2
  exit 1
fi

gh run watch "$run_id" --exit-status

echo "Executando deploy remoto da release $RELEASE_TAG..."
ssh -p "$SSH_PORT" "$SSH_USER@$SSH_HOST" \
  "cd '$REMOTE_APP_DIR' && git fetch --all --prune && git checkout main && git pull --ff-only && bash scripts/deploy-production.sh '$RELEASE_TAG'"

bash scripts/go-live-smoke.sh "$ENV_FILE"

echo "Release $RELEASE_TAG publicada e homologada com sucesso."
