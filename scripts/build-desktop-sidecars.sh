#!/usr/bin/env bash
set -euo pipefail

TARGET_TRIPLE="${1:-}"
if [[ "${TARGET_TRIPLE}" != "aarch64-apple-darwin" && "${TARGET_TRIPLE}" != "x86_64-apple-darwin" ]]; then
  echo "Usage: bash scripts/build-desktop-sidecars.sh <aarch64-apple-darwin|x86_64-apple-darwin>" >&2
  exit 1
fi
HOST_ARCH="$(uname -m)"
EXPECTED_ARCH="arm64"
if [[ "${TARGET_TRIPLE}" == "x86_64-apple-darwin" ]]; then EXPECTED_ARCH="x86_64"; fi
if [[ "${HOST_ARCH}" != "${EXPECTED_ARCH}" ]]; then
  echo "${TARGET_TRIPLE} sidecars must be built on real ${EXPECTED_ARCH} hardware; host is ${HOST_ARCH}." >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BINARIES_DIR="${ROOT_DIR}/apps/desktop/src-tauri/binaries"
WATCHER_MANIFEST="${ROOT_DIR}/apps/desktop/src-tauri/bin/ritual-watcher/Cargo.toml"
WATCHER_TARGET_DIR="${ROOT_DIR}/apps/desktop/src-tauri/target/watcher-release-build"

cargo build \
  --locked \
  --release \
  --manifest-path "${WATCHER_MANIFEST}" \
  --target "${TARGET_TRIPLE}" \
  --target-dir "${WATCHER_TARGET_DIR}"
cp "${WATCHER_TARGET_DIR}/${TARGET_TRIPLE}/release/ritual-watcher" \
  "${BINARIES_DIR}/ritual-watcher-${TARGET_TRIPLE}"
chmod 755 "${BINARIES_DIR}/ritual-watcher-${TARGET_TRIPLE}"

bash "${ROOT_DIR}/scripts/build-native-vision-helper.sh" "${TARGET_TRIPLE}" "${BINARIES_DIR}"
node "${ROOT_DIR}/scripts/pin-desktop-sidecar-target.mjs" --target "${TARGET_TRIPLE}"
RITUAL_REQUIRE_SIDECAR_TRIPLE="${TARGET_TRIPLE}" \
  node "${ROOT_DIR}/scripts/verify-desktop-sidecars.mjs"

file "${BINARIES_DIR}/ritual-watcher-${TARGET_TRIPLE}"
file "${BINARIES_DIR}/ritual-vision-helper-${TARGET_TRIPLE}"
shasum -a 256 "${BINARIES_DIR}/ritual-watcher-${TARGET_TRIPLE}"
shasum -a 256 "${BINARIES_DIR}/ritual-vision-helper-${TARGET_TRIPLE}"
