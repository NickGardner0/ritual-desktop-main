#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This release preflight only supports macOS."
  exit 1
fi

if [[ ! -f "package.json" || ! -d "apps/desktop/src-tauri" ]]; then
  echo "Run this script from the ritual-desktop-main repo root."
  exit 1
fi

if [[ -n "${APPLE_API_KEY_PAT:-}" && -z "${APPLE_API_KEY_PATH:-}" ]]; then
  export APPLE_API_KEY_PATH="${APPLE_API_KEY_PAT}"
  echo "warning: APPLE_API_KEY_PAT is deprecated; treating it as APPLE_API_KEY_PATH" >&2
fi

if [[ -z "${TAURI_PRIVATE_KEY:-}" && -n "${TAURI_KEY_PATH:-}" ]]; then
  export TAURI_PRIVATE_KEY="${TAURI_KEY_PATH}"
fi

TAURI_DIR="apps/desktop/src-tauri"
BASE_CONFIG_PATH="${TAURI_DIR}/tauri.conf.json"
GENERATED_CONFIG_PATH="${TAURI_DIR}/tauri.generated.production.conf.json"
UPDATER_PUBKEY_PATH="${TAURI_DIR}/updater.pub"

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

if [[ "${has_api_key_credentials}" == "true" && ! -f "${APPLE_API_KEY_PATH}" ]]; then
  echo "APPLE_API_KEY_PATH does not point to a readable file: ${APPLE_API_KEY_PATH}" >&2
  exit 1
fi

if [[ "${has_apple_id_credentials}" != "true" && "${has_api_key_credentials}" != "true" ]]; then
  cat <<'EOF'
Missing notarization credentials.

Provide one of these credential sets:

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

if [[ ! -f "${UPDATER_PUBKEY_PATH}" ]]; then
  echo "Missing updater public key: ${UPDATER_PUBKEY_PATH}" >&2
  exit 1
fi

if [[ -f "${TAURI_PRIVATE_KEY}" ]]; then
  echo "Updater private key file found: ${TAURI_PRIVATE_KEY}"
else
  echo "Updater private key provided inline or via non-file secret."
fi

node scripts/write-tauri-production-config.mjs >/dev/null

signing_identity="$(
  node -e "const fs=require('fs'); const cfg=JSON.parse(fs.readFileSync('${GENERATED_CONFIG_PATH}','utf8')); process.stdout.write((cfg.tauri?.bundle?.macOS?.signingIdentity || '').trim())"
)"
updater_endpoint="$(
  node -e "const fs=require('fs'); const cfg=JSON.parse(fs.readFileSync('${GENERATED_CONFIG_PATH}','utf8')); process.stdout.write(String(cfg.tauri?.updater?.endpoints?.[0] || ''))"
)"
updater_active="$(
  node -e "const fs=require('fs'); const cfg=JSON.parse(fs.readFileSync('${GENERATED_CONFIG_PATH}','utf8')); process.stdout.write(String(Boolean(cfg.tauri?.updater?.active)))"
)"

if [[ -z "${signing_identity}" ]]; then
  echo "Generated production config does not contain a macOS signing identity." >&2
  exit 1
fi

if [[ "${updater_active}" != "true" ]]; then
  echo "Generated production config does not have updater.active=true." >&2
  exit 1
fi

if [[ -z "${updater_endpoint}" ]]; then
  echo "Generated production config does not contain an updater endpoint." >&2
  exit 1
fi

if command -v security >/dev/null 2>&1; then
  if ! security find-identity -v -p codesigning 2>/dev/null | grep -F "${signing_identity}" >/dev/null; then
    echo "Configured signing identity not found in local keychain: ${signing_identity}" >&2
    exit 1
  fi
fi

echo
echo "Release preflight passed."
echo "  Notarization auth: $([[ "${has_api_key_credentials}" == "true" ]] && echo "App Store Connect API key" || echo "Apple ID")"
echo "  Signing identity: ${signing_identity}"
echo "  Updater endpoint: ${updater_endpoint}"
echo
echo "Next steps:"
echo "  1. bash scripts/build-macos-desktop-release.sh"
echo "  2. node scripts/validate-updater-artifacts.mjs --latest <path-or-url-to-latest.json>"
echo "  3. Run the packaged desktop smoke checklist in docs/desktop-release-smoke-checklist.md"
