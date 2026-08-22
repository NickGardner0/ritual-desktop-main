#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is required to publish desktop release assets." >&2
  exit 1
fi

ARTIFACT_ROOT="${RITUAL_RELEASE_ARTIFACT_ROOT:-release-assets}"
VERSION="$(node -e "const fs=require('fs'); const cfg=JSON.parse(fs.readFileSync('apps/desktop/src-tauri/tauri.conf.json','utf8')); process.stdout.write(String(cfg.version || ''))")"
TAG="${1:-${GITHUB_REF_NAME:-v${VERSION}}}"
RELEASE_REPO="${RITUAL_UPDATER_REPOSITORY:-NickGardner0/ritual-desktop-releases}"
if [[ "${TAG}" != "v${VERSION}" ]]; then
  echo "Release tag ${TAG} does not match desktop version v${VERSION}." >&2
  exit 1
fi

required_patterns=(
  "*_${VERSION}_aarch64.dmg"
  "*_${VERSION}_aarch64.app.zip"
  "*_${VERSION}_aarch64.app.tar.gz"
  "*_${VERSION}_aarch64.app.tar.gz.sig"
  "latest.json"
)
artifacts=()
for pattern in "${required_patterns[@]}"; do
  matches=("${ARTIFACT_ROOT}"/${pattern})
  if [[ "${#matches[@]}" -ne 1 || ! -f "${matches[0]}" ]]; then
    echo "Expected exactly one Apple Silicon release asset matching ${ARTIFACT_ROOT}/${pattern}; found ${#matches[@]}." >&2
    exit 1
  fi
  artifacts+=("${matches[0]}")
done

release_notes="Automated signed and notarized Apple Silicon macOS desktop build for Ritual ${VERSION}. Requires macOS 14 or later."
if gh release view "${TAG}" --repo "${RELEASE_REPO}" >/dev/null 2>&1; then
  gh release edit "${TAG}" --repo "${RELEASE_REPO}" --title "Ritual v${VERSION}" --notes "${release_notes}" --latest
else
  gh release create "${TAG}" --repo "${RELEASE_REPO}" --title "Ritual v${VERSION}" --notes "${release_notes}" --latest
fi
gh release upload "${TAG}" --repo "${RELEASE_REPO}" --clobber "${artifacts[@]}"

LATEST_URL="https://github.com/${RELEASE_REPO}/releases/latest/download/latest.json"
node scripts/validate-updater-artifacts.mjs --latest "${LATEST_URL}" --platform darwin-aarch64 --check-urls
echo "Published Apple Silicon desktop release ${TAG}."
