#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f "package.json" || ! -d "apps/desktop/src-tauri" ]]; then
  echo "Run this script from the ritual-desktop-main repo root."
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is required to publish desktop release assets." >&2
  exit 1
fi

read_tauri_config() {
  local file_path="$1"
  local expr="$2"
  node -e "const fs=require('fs'); const cfg=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); const value=(function(){ return ${expr}; })(); if (value === undefined || value === null) process.stdout.write(''); else process.stdout.write(String(value));" "${file_path}"
}

BASE_TAURI_CONFIG="apps/desktop/src-tauri/tauri.conf.json"
PRODUCT_NAME="$(read_tauri_config "${BASE_TAURI_CONFIG}" 'cfg.productName')"
VERSION="$(read_tauri_config "${BASE_TAURI_CONFIG}" 'cfg.version')"
TAG="${1:-${GITHUB_REF_NAME:-v${VERSION}}}"
RELEASE_REPO="${RITUAL_UPDATER_REPOSITORY:-NickGardner0/ritual-desktop-releases}"
RELEASE_TITLE="${PRODUCT_NAME} v${VERSION}"

if [[ "${TAG}" != "v${VERSION}" ]]; then
  echo "Release tag ${TAG} does not match desktop version v${VERSION}." >&2
  exit 1
fi

ARCH="$(uname -m)"
case "${ARCH}" in
  arm64) DMG_ARCH_SUFFIX="aarch64" ;;
  x86_64) DMG_ARCH_SUFFIX="x64" ;;
  *)
    echo "Unsupported macOS architecture: ${ARCH}" >&2
    exit 1
    ;;
esac

MACOS_BUNDLE_DIR="apps/desktop/src-tauri/target/release/bundle/macos"
DMG_DIR="apps/desktop/src-tauri/target/release/bundle/dmg"
APP_ZIP="${MACOS_BUNDLE_DIR}/${PRODUCT_NAME}.app.zip"
UPDATER_TAR="${MACOS_BUNDLE_DIR}/${PRODUCT_NAME}.app.tar.gz"
UPDATER_SIG="${UPDATER_TAR}.sig"
LATEST_JSON="${MACOS_BUNDLE_DIR}/latest.json"
DMG_PATH="${DMG_DIR}/${PRODUCT_NAME}_${VERSION}_${DMG_ARCH_SUFFIX}.dmg"
LATEST_URL="https://github.com/${RELEASE_REPO}/releases/latest/download/latest.json"

ARTIFACTS=(
  "${DMG_PATH}"
  "${UPDATER_TAR}"
  "${UPDATER_SIG}"
  "${APP_ZIP}"
  "${LATEST_JSON}"
)

for artifact in "${ARTIFACTS[@]}"; do
  if [[ ! -f "${artifact}" ]]; then
    echo "Missing desktop release artifact: ${artifact}" >&2
    exit 1
  fi
done

release_notes="$(cat <<EOF
Automated macOS desktop build for Ritual.

Assets include the notarized DMG, updater tarball, updater signature, app zip, and \`latest.json\` for in-app updates.
EOF
)"

if gh release view "${TAG}" --repo "${RELEASE_REPO}" >/dev/null 2>&1; then
  echo "Updating existing release ${TAG} in ${RELEASE_REPO}..."
  gh release edit "${TAG}" \
    --repo "${RELEASE_REPO}" \
    --title "${RELEASE_TITLE}" \
    --notes "${release_notes}" \
    --latest
else
  echo "Creating release ${TAG} in ${RELEASE_REPO}..."
  gh release create "${TAG}" \
    --repo "${RELEASE_REPO}" \
    --title "${RELEASE_TITLE}" \
    --notes "${release_notes}" \
    --latest
fi

echo "Uploading desktop release assets..."
gh release upload "${TAG}" \
  --repo "${RELEASE_REPO}" \
  --clobber \
  "${ARTIFACTS[@]}"

echo "Validating published updater feed..."
node scripts/validate-updater-artifacts.mjs --latest "${LATEST_URL}" --check-urls

echo
echo "Published ${TAG} to https://github.com/${RELEASE_REPO}/releases/tag/${TAG}"
