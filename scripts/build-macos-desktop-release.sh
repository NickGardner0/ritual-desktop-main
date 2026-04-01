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

read_tauri_config() {
  local expr="$1"
  python3 - <<PY
import json
with open("apps/desktop/src-tauri/tauri.conf.json") as f:
    cfg = json.load(f)
print(${expr})
PY
}

PRODUCT_NAME="$(read_tauri_config 'cfg["package"]["productName"]')"
VERSION="$(read_tauri_config 'cfg["package"]["version"]')"
UPDATER_ENDPOINT="$(read_tauri_config 'cfg["tauri"]["updater"]["endpoints"][0]')"
SIGNING_IDENTITY="$(read_tauri_config 'cfg["tauri"]["bundle"]["macOS"]["signingIdentity"]')"

ARCH="$(uname -m)"
case "${ARCH}" in
  arm64) UPDATER_PLATFORM="darwin-aarch64"; DMG_ARCH_SUFFIX="aarch64" ;;
  x86_64) UPDATER_PLATFORM="darwin-x86_64"; DMG_ARCH_SUFFIX="x64" ;;
  *)
    echo "Unsupported macOS architecture: ${ARCH}"
    exit 1
    ;;
esac

MACOS_BUNDLE_DIR="apps/desktop/src-tauri/target/release/bundle/macos"
UPDATER_DIR="apps/desktop/src-tauri/target/release/bundle/updater"
DMG_DIR="apps/desktop/src-tauri/target/release/bundle/dmg"
APP_PATH="${MACOS_BUNDLE_DIR}/${PRODUCT_NAME}.app"
APP_NOTARY_ZIP="${MACOS_BUNDLE_DIR}/${PRODUCT_NAME}.notary.zip"
APP_ZIP="${MACOS_BUNDLE_DIR}/${PRODUCT_NAME}.app.zip"
UPDATER_TAR="${UPDATER_DIR}/${PRODUCT_NAME}.app.tar.gz"
UPDATER_SIG="${UPDATER_TAR}.sig"
LATEST_JSON="${UPDATER_DIR}/latest.json"
DMG_PATH="${DMG_DIR}/${PRODUCT_NAME}_${VERSION}_${DMG_ARCH_SUFFIX}.dmg"
HELPER_PATH="${APP_PATH}/Contents/MacOS/ritual-watcher"
ENTITLEMENTS_PATH="apps/desktop/src-tauri/entitlements.plist"
KEYCHAIN_PATH="${HOME}/Library/Keychains/login.keychain-db"
UPDATER_ASSET_URL="${UPDATER_ENDPOINT%/latest.json}/${PRODUCT_NAME}.app.tar.gz"

NOTARY_AUTH_ARGS=()
if [[ "${has_api_key_credentials}" == "true" ]]; then
  NOTARY_AUTH_ARGS=(
    --key "${APPLE_API_KEY_PATH}"
    --key-id "${APPLE_API_KEY}"
    --issuer "${APPLE_API_ISSUER}"
  )
else
  NOTARY_AUTH_ARGS=(
    --apple-id "${APPLE_ID}"
    --password "${APPLE_PASSWORD}"
    --team-id "${APPLE_TEAM_ID}"
  )
fi

sign_macos_path() {
  local target="$1"
  echo "  codesign: ${target}"
  codesign --force --timestamp \
    --sign "${SIGNING_IDENTITY}" \
    --options runtime \
    --entitlements "${ENTITLEMENTS_PATH}" \
    --keychain "${KEYCHAIN_PATH}" \
    "${target}"
}

mkdir -p "${MACOS_BUNDLE_DIR}" "${UPDATER_DIR}" "${DMG_DIR}"
rm -rf "${APP_PATH}"
rm -f "${APP_NOTARY_ZIP}" "${APP_ZIP}" "${UPDATER_TAR}" "${UPDATER_SIG}" "${LATEST_JSON}" "${DMG_PATH}"

SIDECAR_DIR="apps/desktop/src-tauri/binaries"
echo "Pre-signing sidecar binaries..."
for bin in "${SIDECAR_DIR}"/*; do
  if [[ -f "${bin}" && -x "${bin}" ]]; then
    echo "  Signing: $(basename "${bin}")"
    sign_macos_path "${bin}"
  fi
done
echo "Sidecar signing complete."

cd apps/desktop
../../node_modules/.bin/tauri build --config src-tauri/tauri.generated.production.conf.json --bundles app
cd ../..

if [[ ! -f "${HELPER_PATH}" ]]; then
  echo "Bundled helper not found at ${HELPER_PATH}" >&2
  exit 1
fi

echo "Manually signing bundled helper and outer app..."
sign_macos_path "${HELPER_PATH}"
sign_macos_path "${APP_PATH}"

echo "Verifying signed app bundle..."
codesign --verify --deep --strict --verbose=2 "${APP_PATH}"

echo "Packaging app zip for notarization..."
ditto -c -k --sequesterRsrc --keepParent "${APP_PATH}" "${APP_NOTARY_ZIP}"

echo "Submitting app zip for notarization..."
xcrun notarytool submit "${APP_NOTARY_ZIP}" "${NOTARY_AUTH_ARGS[@]}" --wait

echo "Stapling app..."
xcrun stapler staple "${APP_PATH}"
spctl --assess --type execute -vv "${APP_PATH}"

echo "Creating distributable app zip..."
ditto -c -k --sequesterRsrc --keepParent "${APP_PATH}" "${APP_ZIP}"

echo "Creating updater tarball..."
tar -C "${MACOS_BUNDLE_DIR}" -czf "${UPDATER_TAR}" "${PRODUCT_NAME}.app"

echo "Signing updater tarball..."
./node_modules/.bin/tauri signer sign -f "${TAURI_PRIVATE_KEY}" -p "${TAURI_KEY_PASSWORD:-}" "${UPDATER_TAR}"

if [[ ! -f "${UPDATER_SIG}" ]]; then
  echo "Updater signature file missing: ${UPDATER_SIG}" >&2
  exit 1
fi

echo "Writing latest.json..."
python3 - <<PY
import datetime
import json
from pathlib import Path

signature = Path("${UPDATER_SIG}").read_text().strip()
latest = {
    "version": "${VERSION}",
    "notes": f"Desktop release ${VERSION}.",
    "pub_date": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    "platforms": {
        "${UPDATER_PLATFORM}": {
            "signature": signature,
            "url": "${UPDATER_ASSET_URL}",
        }
    },
}
Path("${LATEST_JSON}").write_text(json.dumps(latest, indent=2) + "\n")
PY

echo "Creating DMG..."
hdiutil create -volname "${PRODUCT_NAME}" -srcfolder "${APP_PATH}" -ov -format UDZO "${DMG_PATH}"

echo "Submitting DMG for notarization..."
xcrun notarytool submit "${DMG_PATH}" "${NOTARY_AUTH_ARGS[@]}" --wait

echo "Stapling DMG..."
xcrun stapler staple "${DMG_PATH}"

echo "Validating updater artifacts..."
node scripts/validate-updater-artifacts.mjs --latest "${LATEST_JSON}"

echo "Checking packaged app for accidental dashboard build artifacts..."
ARTIFACT_CHECK_OUTPUT="$(mktemp)"
ARTIFACT_PATTERN='\.next/cache|/dev/cache/turbopack|/server/app/api/|/dev/server/app/api/|route\.js\.map'
if command -v rg >/dev/null 2>&1; then
  strings "${APP_PATH}/Contents/MacOS/${PRODUCT_NAME}" | rg -n "${ARTIFACT_PATTERN}" >"${ARTIFACT_CHECK_OUTPUT}" || true
else
  strings "${APP_PATH}/Contents/MacOS/${PRODUCT_NAME}" | grep -nE "${ARTIFACT_PATTERN}" >"${ARTIFACT_CHECK_OUTPUT}" || true
fi
if [[ -s "${ARTIFACT_CHECK_OUTPUT}" ]]; then
  echo "Packaged app still embeds dashboard/Next build artifacts:" >&2
  cat "${ARTIFACT_CHECK_OUTPUT}" >&2
  rm -f "${ARTIFACT_CHECK_OUTPUT}"
  exit 1
fi
rm -f "${ARTIFACT_CHECK_OUTPUT}"

cat <<EOF

Desktop release artifacts are ready:
  App bundle: ${APP_PATH}
  App zip: ${APP_ZIP}
  DMG: ${DMG_PATH}
  Updater tarball: ${UPDATER_TAR}
  Updater signature: ${UPDATER_SIG}
  latest.json: ${LATEST_JSON}
EOF
