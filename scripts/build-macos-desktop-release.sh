#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This release helper only supports macOS."
  exit 1
fi

if [[ ! -f "package.json" || ! -d "apps/desktop/src-tauri" ]]; then
  echo "Run this script from the ritual-desktop-main repo root."
  exit 1
fi

if [[ -z "${TAURI_PRIVATE_KEY:-}" && -n "${TAURI_KEY_PATH:-}" ]]; then
  export TAURI_PRIVATE_KEY="${TAURI_KEY_PATH}"
fi

if [[ -n "${APPLE_API_KEY_PAT:-}" && -z "${APPLE_API_KEY_PATH:-}" ]]; then
  export APPLE_API_KEY_PATH="${APPLE_API_KEY_PAT}"
  echo "warning: APPLE_API_KEY_PAT is deprecated; treating it as APPLE_API_KEY_PATH" >&2
fi

has_apple_id_credentials=true
for var_name in APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID; do
  if [[ -z "${!var_name:-}" ]]; then
    has_apple_id_credentials=false
  fi
done

has_api_key_credentials=true
for var_name in APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_PATH; do
  if [[ -z "${!var_name:-}" ]]; then
    has_api_key_credentials=false
  fi
done

if [[ "${has_apple_id_credentials}" != "true" && "${has_api_key_credentials}" != "true" ]]; then
  cat <<'EOF'
Missing notarization credentials.

Provide one of these credential sets before running this script:

1. Apple ID flow
   export APPLE_ID="you@example.com"
   export APPLE_PASSWORD="app-specific-password"
   export APPLE_TEAM_ID="D657T2LVR2"

2. App Store Connect API key flow
   export APPLE_API_KEY="key-id"
   export APPLE_API_ISSUER="issuer-id"
   export APPLE_API_KEY_PATH="/absolute/path/AuthKey_KEYID.p8"
EOF
  exit 1
fi

if [[ -z "${TAURI_PRIVATE_KEY:-}" ]]; then
  cat <<'EOF'
Missing Tauri updater signing key.

Provide the updater private key as one of:

1. A path
   export TAURI_KEY_PATH="/absolute/path/to/ritual-updater.key"

2. The file contents or direct path in TAURI_PRIVATE_KEY
   export TAURI_PRIVATE_KEY="/absolute/path/to/ritual-updater.key"
EOF
  exit 1
fi

export CI="${CI:-true}"
export RITUAL_ENV="${RITUAL_ENV:-production}"

echo "Building notarized Ritual desktop release..."
echo "  RITUAL_ENV=${RITUAL_ENV}"
echo "  CI=${CI}"

if [[ -n "${APPLE_PROVIDER_SHORT_NAME:-}" ]]; then
  echo "  APPLE_PROVIDER_SHORT_NAME is set"
else
echo "  APPLE_PROVIDER_SHORT_NAME is not set (usually fine for single-team accounts)"
fi
echo "  GitHub Releases updater feed will be baked into the production config"

bash scripts/validate-macos-release-env.sh
npm run desktop:updater:config
npm run typecheck
cd apps/desktop
../../node_modules/.bin/tauri build --config src-tauri/tauri.generated.production.conf.json --bundles dmg,updater
