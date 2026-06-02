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

if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  if [[ -n "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]]; then
    export TAURI_SIGNING_PRIVATE_KEY="${TAURI_SIGNING_PRIVATE_KEY_PATH}"
  elif [[ -n "${TAURI_PRIVATE_KEY:-}" ]]; then
    export TAURI_SIGNING_PRIVATE_KEY="${TAURI_PRIVATE_KEY}"
    echo "warning: TAURI_PRIVATE_KEY is deprecated; treating it as TAURI_SIGNING_PRIVATE_KEY" >&2
  elif [[ -n "${TAURI_KEY_PATH:-}" ]]; then
    export TAURI_SIGNING_PRIVATE_KEY="${TAURI_KEY_PATH}"
    echo "warning: TAURI_KEY_PATH is deprecated; treating it as TAURI_SIGNING_PRIVATE_KEY" >&2
  fi
fi

if [[ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" && -n "${TAURI_KEY_PASSWORD:-}" ]]; then
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_KEY_PASSWORD}"
  echo "warning: TAURI_KEY_PASSWORD is deprecated; treating it as TAURI_SIGNING_PRIVATE_KEY_PASSWORD" >&2
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

if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  cat <<'EOF'
Missing Tauri updater signing key.

Provide the updater private key as one of:

1. A path
   export TAURI_SIGNING_PRIVATE_KEY_PATH="/absolute/path/to/ritual-updater.key"

2. The file contents or direct path in TAURI_SIGNING_PRIVATE_KEY
   export TAURI_SIGNING_PRIVATE_KEY="/absolute/path/to/ritual-updater.key"
EOF
  exit 1
fi

if [[ -z "${SENTRY_DESKTOP_NATIVE_DSN:-}" && "${RITUAL_ALLOW_MISSING_SENTRY_DESKTOP_NATIVE_DSN:-0}" != "1" ]]; then
  cat <<'EOF'
Missing native desktop Sentry DSN.

Set SENTRY_DESKTOP_NATIVE_DSN before building a packaged desktop release.
Without it, the Tauri shell, watcher, and recorder cannot report native errors
or smoke-test events to Sentry.

For GitHub Actions, add this repository secret:
  SENTRY_DESKTOP_NATIVE_DSN

For an intentional local test build without native Sentry, set:
  RITUAL_ALLOW_MISSING_SENTRY_DESKTOP_NATIVE_DSN=1
EOF
  exit 1
fi

if [[ ! -f "${UPDATER_PUBKEY_PATH}" ]]; then
  echo "Missing updater public key: ${UPDATER_PUBKEY_PATH}" >&2
  exit 1
fi

if [[ -f "${TAURI_SIGNING_PRIVATE_KEY}" ]]; then
  echo "Updater private key file found: ${TAURI_SIGNING_PRIVATE_KEY}"
else
  echo "Updater private key provided inline or via non-file secret."
fi

TAURI_SIGNER_ARGS=()
if [[ -f "${TAURI_SIGNING_PRIVATE_KEY}" ]]; then
  TAURI_SIGNER_ARGS+=(-f "${TAURI_SIGNING_PRIVATE_KEY}")
else
  TAURI_SIGNER_ARGS+=(-k "${TAURI_SIGNING_PRIVATE_KEY}")
fi

if [[ "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD+x}" == "x" ]]; then
  TAURI_SIGNER_ARGS+=(-p "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD}")
fi

signer_probe_file="$(mktemp "${TMPDIR:-/tmp}/ritual-updater-signing.XXXXXX")"
printf 'ritual-updater-signing-preflight' > "${signer_probe_file}"
signer_probe_sig="${signer_probe_file}.sig"
cleanup_signer_probe() {
  rm -f "${signer_probe_file}" "${signer_probe_sig}"
}
trap cleanup_signer_probe EXIT

if ! env \
  -u TAURI_PRIVATE_KEY \
  -u TAURI_KEY_PATH \
  -u TAURI_KEY_PASSWORD \
  -u TAURI_SIGNING_PRIVATE_KEY \
  -u TAURI_SIGNING_PRIVATE_KEY_PATH \
  -u TAURI_SIGNING_PRIVATE_KEY_PASSWORD \
  ./node_modules/.bin/tauri signer sign "${TAURI_SIGNER_ARGS[@]}" "${signer_probe_file}" >/dev/null 2>&1; then
  echo "Updater signing key validation failed. Check TAURI_SIGNING_PRIVATE_KEY and TAURI_SIGNING_PRIVATE_KEY_PASSWORD." >&2
  exit 1
fi

cleanup_signer_probe
trap - EXIT

node scripts/write-tauri-production-config.mjs >/dev/null

signing_identity="$(
  node -e "const fs=require('fs'); const cfg=JSON.parse(fs.readFileSync('${BASE_CONFIG_PATH}','utf8')); const value=(process.env.APPLE_SIGNING_IDENTITY || cfg.bundle?.macOS?.signingIdentity || '').trim(); process.stdout.write(value)"
)"
updater_endpoint="$(
  node -e "const fs=require('fs'); const cfg=JSON.parse(fs.readFileSync('${GENERATED_CONFIG_PATH}','utf8')); process.stdout.write(String(cfg.plugins?.updater?.endpoints?.[0] || ''))"
)"
updater_pubkey="$(
  node -e "const fs=require('fs'); const cfg=JSON.parse(fs.readFileSync('${GENERATED_CONFIG_PATH}','utf8')); process.stdout.write(String(cfg.plugins?.updater?.pubkey || ''))"
)"
capabilities_check="$(
  node -e "const fs=require('fs'); const cfg=JSON.parse(fs.readFileSync('${GENERATED_CONFIG_PATH}','utf8')); const caps=cfg.app?.security?.capabilities || []; const ok=Array.isArray(caps) && caps.includes('main-window') && caps.includes('sidebar-window') && !caps.includes('main-window-dev') && !caps.includes('sidebar-window-dev'); process.stdout.write(String(ok))"
)"

if [[ -z "${signing_identity}" ]]; then
  echo "No macOS signing identity is configured. Set APPLE_SIGNING_IDENTITY or bundle.macOS.signingIdentity." >&2
  exit 1
fi

if [[ -z "${updater_pubkey}" ]]; then
  echo "Generated production config does not contain an updater public key." >&2
  exit 1
fi

if [[ -z "${updater_endpoint}" ]]; then
  echo "Generated production config does not contain an updater endpoint." >&2
  exit 1
fi

if [[ "${capabilities_check}" != "true" ]]; then
  echo "Generated production config is not restricted to the production capability set." >&2
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
echo "  Production capabilities: main-window, sidebar-window"
echo
echo "Next steps:"
echo "  1. bash scripts/build-macos-desktop-release.sh"
echo "  2. node scripts/validate-updater-artifacts.mjs --latest <path-or-url-to-latest.json>"
echo "  3. Run the packaged desktop smoke checklist in docs/desktop-release-smoke-checklist.md"
