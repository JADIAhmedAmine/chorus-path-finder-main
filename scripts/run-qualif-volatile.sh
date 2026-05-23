#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

prompt_value() {
  local name="$1"
  local label="$2"
  local current="${!name:-}"

  if [[ -n "$current" ]]; then
    return
  fi

  read -r -p "$label: " current
  export "$name=$current"
}

prompt_secret() {
  local name="$1"
  local label="$2"
  local current="${!name:-}"

  if [[ -n "$current" ]]; then
    return
  fi

  read -r -s -p "$label: " current
  printf '\n'
  export "$name=$current"
}

export CHORUS_ENV=qualif
export VITE_CHORUS_ENV=qualif
export VITE_CHORUS_MODE=direct
export VITE_CHORUS_ENABLED=true
export CHORUS_ALLOWED_SUPPLIER_IDS="${CHORUS_ALLOWED_SUPPLIER_IDS:-26359578}"

prompt_value CHORUS_QUALIF_CLIENT_ID "PISTE qualif client_id"
prompt_secret CHORUS_QUALIF_CLIENT_SECRET "PISTE qualif client_secret"
prompt_value CHORUS_QUALIF_TECHNICAL_LOGIN "CPRO qualif technical login"
prompt_secret CHORUS_QUALIF_TECHNICAL_PASSWORD "CPRO qualif technical password"

if [[ "$#" -eq 0 ]]; then
  set -- up -d --build
fi

docker compose --env-file .env.local -f docker-compose.prod.yml "$@"
