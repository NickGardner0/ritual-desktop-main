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
  local file_path="$1"
  local expr="$2"
  node -e "const fs=require('fs'); const cfg=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); const value=(function(){ return ${expr}; })(); if (value === undefined || value === null) process.stdout.write(''); else process.stdout.write(String(value));" "${file_path}"
}

BASE_TAURI_CONFIG="apps/desktop/src-tauri/tauri.conf.json"
GENERATED_TAURI_CONFIG="apps/desktop/src-tauri/tauri.generated.production.conf.json"

PRODUCT_NAME="$(read_tauri_config "${BASE_TAURI_CONFIG}" 'cfg.productName')"
VERSION="$(read_tauri_config "${BASE_TAURI_CONFIG}" 'cfg.version')"
UPDATER_ENDPOINT="$(read_tauri_config "${GENERATED_TAURI_CONFIG}" 'cfg.plugins?.updater?.endpoints?.[0]')"
SIGNING_IDENTITY="$(read_tauri_config "${BASE_TAURI_CONFIG}" 'process.env.APPLE_SIGNING_IDENTITY || cfg.bundle?.macOS?.signingIdentity')"

if [[ -z "${SIGNING_IDENTITY}" ]]; then
  echo "Missing signing identity. Set APPLE_SIGNING_IDENTITY or bundle.macOS.signingIdentity." >&2
  exit 1
fi

ARCH="$(uname -m)"
REQUESTED_TARGET="${RITUAL_RELEASE_TARGET:-}"
case "${REQUESTED_TARGET}" in
  "" )
    if [[ "${ARCH}" == "arm64" ]]; then
      REQUESTED_TARGET="aarch64-apple-darwin"
    fi
    ;;
  darwin-aarch64) REQUESTED_TARGET="aarch64-apple-darwin" ;;
esac
case "${REQUESTED_TARGET}" in
  aarch64-apple-darwin) UPDATER_PLATFORM="darwin-aarch64"; TAURI_TARGET_TRIPLE="aarch64-apple-darwin"; DMG_ARCH_SUFFIX="aarch64"; EXPECTED_HOST_ARCH="arm64" ;;
  *)
    echo "Unsupported macOS release target: ${REQUESTED_TARGET:-unset}. Ritual currently ships Apple Silicon only." >&2
    exit 1
    ;;
esac
if [[ "${ARCH}" != "${EXPECTED_HOST_ARCH}" ]]; then
  echo "Release target ${TAURI_TARGET_TRIPLE} requires a real ${EXPECTED_HOST_ARCH} macOS host; current host is ${ARCH}." >&2
  exit 1
fi

TARGET_BUNDLE_ROOT="apps/desktop/src-tauri/target/${TAURI_TARGET_TRIPLE}/release/bundle"
MACOS_BUNDLE_DIR="${TARGET_BUNDLE_ROOT}/macos"
DMG_DIR="${TARGET_BUNDLE_ROOT}/dmg"
APP_PATH="${MACOS_BUNDLE_DIR}/${PRODUCT_NAME}.app"
APP_NOTARY_ZIP="${MACOS_BUNDLE_DIR}/${PRODUCT_NAME}_${VERSION}_${DMG_ARCH_SUFFIX}.notary.zip"
APP_ZIP="${MACOS_BUNDLE_DIR}/${PRODUCT_NAME}_${VERSION}_${DMG_ARCH_SUFFIX}.app.zip"
UPDATER_TAR="${MACOS_BUNDLE_DIR}/${PRODUCT_NAME}_${VERSION}_${DMG_ARCH_SUFFIX}.app.tar.gz"
UPDATER_SIG="${UPDATER_TAR}.sig"
LATEST_JSON="${MACOS_BUNDLE_DIR}/latest-${UPDATER_PLATFORM}.json"
DMG_PATH="${DMG_DIR}/${PRODUCT_NAME}_${VERSION}_${DMG_ARCH_SUFFIX}.dmg"
HELPER_PATH="${APP_PATH}/Contents/MacOS/ritual-watcher"
VISION_HELPER_PATH="${APP_PATH}/Contents/MacOS/ritual-vision-helper"
APP_INFO_PLIST="${APP_PATH}/Contents/Info.plist"
ENTITLEMENTS_PATH="apps/desktop/src-tauri/entitlements.plist"
KEYCHAIN_PATH="${APPLE_SIGNING_KEYCHAIN_PATH:-${HOME}/Library/Keychains/login.keychain-db}"
UPDATER_ASSET_NAME="$(basename "${UPDATER_TAR}")"
UPDATER_ASSET_URL="${UPDATER_ENDPOINT%/latest.json}/${UPDATER_ASSET_NAME}"
DMG_BACKGROUND_PATH="apps/desktop/src-tauri/dmg/ritual-dmg-background.png"
DMG_BACKGROUND_TIFF="apps/desktop/src-tauri/dmg/ritual-dmg-background.tiff"

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

mkdir -p "${MACOS_BUNDLE_DIR}" "${DMG_DIR}"
rm -rf "${APP_PATH}"
rm -f "${APP_NOTARY_ZIP}" "${APP_ZIP}" "${UPDATER_TAR}" "${UPDATER_SIG}" "${LATEST_JSON}" "${DMG_PATH}"

if ! command -v create-dmg >/dev/null 2>&1; then
  echo "Installing create-dmg..."
  brew install create-dmg
fi

echo "Generating DMG background asset..."
node scripts/generate-macos-dmg-background.mjs "${DMG_BACKGROUND_PATH}"
DMG_BACKGROUND_ASSET="${DMG_BACKGROUND_PATH}"
if [[ -f "${DMG_BACKGROUND_TIFF}" ]]; then
  DMG_BACKGROUND_ASSET="${DMG_BACKGROUND_TIFF}"
fi

SIDECAR_DIR="apps/desktop/src-tauri/binaries"
WATCHER_SIDECAR_PATH="${SIDECAR_DIR}/ritual-watcher-${TAURI_TARGET_TRIPLE}"
VISION_SIDECAR_PATH="${SIDECAR_DIR}/ritual-vision-helper-${TAURI_TARGET_TRIPLE}"
LEGACY_VISION_SIDECAR_PATH="${SIDECAR_DIR}/ritual-vision-helper-${UPDATER_PLATFORM}"

if [[ "${RITUAL_REBUILD_SIDECARS:-0}" == "1" ]]; then
  echo "Rebuilding ritual-vision-helper (RITUAL_REBUILD_SIDECARS=1). Update sidecar-lock.json before shipping."
  bash scripts/build-native-vision-helper.sh "${TAURI_TARGET_TRIPLE}" "${SIDECAR_DIR}"
else
  echo "Using pinned sidecars from ${SIDECAR_DIR} (set RITUAL_REBUILD_SIDECARS=1 to rebuild vision helper)."
fi

if [[ "${LEGACY_VISION_SIDECAR_PATH}" != "${VISION_SIDECAR_PATH}" && -f "${LEGACY_VISION_SIDECAR_PATH}" ]]; then
  echo "Removing legacy vision helper alias: ${LEGACY_VISION_SIDECAR_PATH}"
  rm -f "${LEGACY_VISION_SIDECAR_PATH}"
fi

echo "Verifying sidecar hashes..."
RITUAL_REQUIRE_SIDECAR_TRIPLE="${TAURI_TARGET_TRIPLE}" node scripts/verify-desktop-sidecars.mjs

echo "Pre-signing sidecar binaries..."

SIDECAR_BACKUP_DIR="$(mktemp -d)"
DMG_STAGING_DIR=""
SIDECARS_RESTORED=false

restore_release_sidecars() {
  if [[ "${SIDECARS_RESTORED}" == "false" && -d "${SIDECAR_BACKUP_DIR}" ]]; then
    cp -p "${SIDECAR_BACKUP_DIR}/$(basename "${WATCHER_SIDECAR_PATH}")" "${WATCHER_SIDECAR_PATH}"
    cp -p "${SIDECAR_BACKUP_DIR}/$(basename "${VISION_SIDECAR_PATH}")" "${VISION_SIDECAR_PATH}"
    SIDECARS_RESTORED=true
  fi
}

cleanup_release_staging() {
  restore_release_sidecars
  if [[ -n "${DMG_STAGING_DIR}" && -d "${DMG_STAGING_DIR}" ]]; then
    rm -rf "${DMG_STAGING_DIR}"
  fi
  if [[ -d "${SIDECAR_BACKUP_DIR}" ]]; then
    rm -rf "${SIDECAR_BACKUP_DIR}"
  fi
}

trap cleanup_release_staging EXIT
cp -p "${WATCHER_SIDECAR_PATH}" "${SIDECAR_BACKUP_DIR}/"
cp -p "${VISION_SIDECAR_PATH}" "${SIDECAR_BACKUP_DIR}/"

for bin in "${WATCHER_SIDECAR_PATH}" "${VISION_SIDECAR_PATH}"; do
  if [[ ! -f "${bin}" ]]; then
    echo "Expected sidecar missing before bundle build: ${bin}" >&2
    exit 1
  fi
  if [[ ! -x "${bin}" ]]; then
    echo "Expected sidecar is not executable: ${bin}" >&2
    exit 1
  fi
  echo "  Signing: $(basename "${bin}")"
  sign_macos_path "${bin}"
done
echo "Sidecar signing complete."
SIGNED_WATCHER_SHA="$(shasum -a 256 "${WATCHER_SIDECAR_PATH}" | awk '{print $1}')"
SIGNED_VISION_SHA="$(shasum -a 256 "${VISION_SIDECAR_PATH}" | awk '{print $1}')"

export RITUAL_RUNTIME_SIDECAR_LOCK_JSON
RITUAL_RUNTIME_SIDECAR_LOCK_JSON="$(
  node scripts/render-runtime-sidecar-lock.mjs --target "${TAURI_TARGET_TRIPLE}"
)"

cd apps/desktop
SOURCE_SHA="${GITHUB_SHA:-$(git rev-parse HEAD)}"
if [[ ! "${SOURCE_SHA}" =~ ^[0-9a-fA-F]{40}$ ]]; then
  echo "Release source SHA is invalid: ${SOURCE_SHA}" >&2
  exit 1
fi
RITUAL_CHANNEL=production RITUAL_BUILD_SHA="${SOURCE_SHA}" \
  ../../node_modules/.bin/tauri build \
    --target "${TAURI_TARGET_TRIPLE}" \
    --config src-tauri/tauri.generated.production.conf.json \
    --no-sign \
    --bundles app
cd ../..

if [[ ! -f "${HELPER_PATH}" ]]; then
  echo "Bundled helper not found at ${HELPER_PATH}" >&2
  exit 1
fi

if [[ ! -f "${VISION_HELPER_PATH}" ]]; then
  echo "Bundled vision helper not found at ${VISION_HELPER_PATH}" >&2
  exit 1
fi

echo "Verifying bundled sidecars are the exact signed, hash-pinned inputs..."
cmp -s "${WATCHER_SIDECAR_PATH}" "${HELPER_PATH}" || {
  echo "Bundled watcher bytes differ from the signed runtime hash input." >&2
  exit 1
}
cmp -s "${VISION_SIDECAR_PATH}" "${VISION_HELPER_PATH}" || {
  echo "Bundled vision-helper bytes differ from the signed runtime hash input." >&2
  exit 1
}
codesign --verify --strict --verbose=2 "${HELPER_PATH}"
codesign --verify --strict --verbose=2 "${VISION_HELPER_PATH}"

restore_release_sidecars
unset RITUAL_RUNTIME_SIDECAR_LOCK_JSON

echo "Embedding release identity in Info.plist..."
for key in RitualSourceSHA RitualChannel RitualTargetTriple; do
  /usr/libexec/PlistBuddy -c "Delete :${key}" "${APP_INFO_PLIST}" >/dev/null 2>&1 || true
done
/usr/libexec/PlistBuddy -c "Add :RitualSourceSHA string ${SOURCE_SHA}" "${APP_INFO_PLIST}"
/usr/libexec/PlistBuddy -c "Add :RitualChannel string production" "${APP_INFO_PLIST}"
/usr/libexec/PlistBuddy -c "Add :RitualTargetTriple string ${TAURI_TARGET_TRIPLE}" "${APP_INFO_PLIST}"

echo "Signing outer app..."
sign_macos_path "${APP_PATH}"

echo "Verifying signed app bundle..."
codesign --verify --deep --strict --verbose=2 "${APP_PATH}"
cmp -s "${SIDECAR_BACKUP_DIR}/$(basename "${WATCHER_SIDECAR_PATH}")" "${WATCHER_SIDECAR_PATH}"
test "$(shasum -a 256 "${HELPER_PATH}" | awk '{print $1}')" = "${SIGNED_WATCHER_SHA}"
test "$(shasum -a 256 "${VISION_HELPER_PATH}" | awk '{print $1}')" = "${SIGNED_VISION_SHA}"

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
TAURI_SIGNER_ARGS=()
if [[ -f "${TAURI_SIGNING_PRIVATE_KEY}" ]]; then
  TAURI_SIGNER_ARGS+=(-f "${TAURI_SIGNING_PRIVATE_KEY}")
else
  TAURI_SIGNER_ARGS+=(-k "${TAURI_SIGNING_PRIVATE_KEY}")
fi

if [[ "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD+x}" == "x" ]]; then
  TAURI_SIGNER_ARGS+=(-p "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD}")
fi

env \
  -u TAURI_PRIVATE_KEY \
  -u TAURI_KEY_PATH \
  -u TAURI_KEY_PASSWORD \
  -u TAURI_SIGNING_PRIVATE_KEY \
  -u TAURI_SIGNING_PRIVATE_KEY_PATH \
  -u TAURI_SIGNING_PRIVATE_KEY_PASSWORD \
  ./node_modules/.bin/tauri signer sign "${TAURI_SIGNER_ARGS[@]}" "${UPDATER_TAR}"

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
DMG_STAGING_DIR="$(mktemp -d)"

cp -R "${APP_PATH}" "${DMG_STAGING_DIR}/"

CREATE_DMG_ARGS=(
  --volname "${PRODUCT_NAME}"
  --no-internet-enable
  --background "${DMG_BACKGROUND_ASSET}"
  --icon-size 112
  --window-size 640 440
  --format UDZO
  --filesystem APFS
  --hide-extension "${PRODUCT_NAME}.app"
  --icon "${PRODUCT_NAME}.app" 180 200
  --app-drop-link 460 200
  "${DMG_PATH}"
  "${DMG_STAGING_DIR}"
)

create-dmg "${CREATE_DMG_ARGS[@]}"
rm -rf "${DMG_STAGING_DIR}"
DMG_STAGING_DIR=""

echo "Submitting DMG for notarization..."
xcrun notarytool submit "${DMG_PATH}" "${NOTARY_AUTH_ARGS[@]}" --wait

echo "Stapling DMG..."
xcrun stapler staple "${DMG_PATH}"

echo "Validating updater artifacts..."
node scripts/validate-updater-artifacts.mjs --latest "${LATEST_JSON}" --platform "${UPDATER_PLATFORM}"

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
