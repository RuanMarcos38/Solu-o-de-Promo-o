#!/usr/bin/env bash
set -Eeuo pipefail

API_LOG="${RUNNER_TEMP:-/tmp}/promotion-api-smoke.log"

cleanup() {
  if [[ -n "${API_PID:-}" ]]; then
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

npm run build -w apps/api
npm run start -w apps/api >"$API_LOG" 2>&1 &
API_PID=$!

for _ in $(seq 1 30); do
  if curl --fail --silent --show-error http://127.0.0.1:3333/ready >/dev/null; then
    break
  fi

  if ! kill -0 "$API_PID" 2>/dev/null; then
    cat "$API_LOG" >&2
    exit 1
  fi

  sleep 1
done

curl --fail --silent --show-error http://127.0.0.1:3333/health >/dev/null
curl --fail --silent --show-error http://127.0.0.1:3333/ready >/dev/null
curl --fail --silent --show-error http://127.0.0.1:3333/api/v1/health >/dev/null
curl --fail --silent --show-error http://127.0.0.1:3333/openapi.json \
  | node -e '
    let body = "";
    process.stdin.on("data", (chunk) => { body += chunk; });
    process.stdin.on("end", () => {
      const document = JSON.parse(body);
      const required = ["/api/v1/health", "/api/v1/offers", "/api/v1/offers/stats", "/api/v1/marketplaces"];
      for (const route of required) {
        if (!document.paths?.[route]) throw new Error(`OpenAPI sem ${route}`);
      }
    });
  '

echo "Bot smoke test aprovado: API, prontidão e OpenAPI responderam corretamente."
