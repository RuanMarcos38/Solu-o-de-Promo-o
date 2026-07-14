#!/usr/bin/env bash

get_env_value() {
  local file="$1"
  local key="$2"
  local fallback="${3:-}"
  local line value

  if [[ ! -f "$file" ]]; then
    printf '%s' "$fallback"
    return 0
  fi

  line="$(grep -E "^${key}=" "$file" | tail -n1 || true)"
  if [[ -z "$line" ]]; then
    printf '%s' "$fallback"
    return 0
  fi

  value="${line#*=}"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi

  printf '%s' "$value"
}

require_env_value() {
  local file="$1"
  local key="$2"
  local value
  value="$(get_env_value "$file" "$key")"
  if [[ -z "$value" ]]; then
    echo "$key precisa ser configurado em $file" >&2
    return 1
  fi
  printf '%s' "$value"
}
