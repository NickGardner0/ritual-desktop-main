#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "ritual-vision-helper build skipped: host is not macOS" >&2
  exit 0
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_TAURI_DIR="${ROOT_DIR}/apps/desktop/src-tauri"
NATIVE_VISION_DIR="${SRC_TAURI_DIR}/native-vision"
RAW_TARGET_TRIPLE="${1:-${TARGET:-}}"

normalize_target_triple() {
  case "${1:-}" in
    darwin-aarch64) echo "aarch64-apple-darwin" ;;
    darwin-x86_64) echo "x86_64-apple-darwin" ;;
    *) echo "${1:-}" ;;
  esac
}

TARGET_TRIPLE="$(normalize_target_triple "${RAW_TARGET_TRIPLE}")"
if [[ -z "${TARGET_TRIPLE}" ]]; then
  TARGET_TRIPLE="$(rustc -vV | awk '/host:/ {print $2; exit}')"
fi

if [[ -z "${TARGET_TRIPLE}" ]]; then
  echo "Unable to determine target triple for ritual-vision-helper" >&2
  exit 1
fi

OUT_DIR="${2:-${SRC_TAURI_DIR}/binaries}"
BUILD_DIR="${SRC_TAURI_DIR}/target/native-vision/${TARGET_TRIPLE}"
TMP_BINARY="${BUILD_DIR}/ritual-vision-helper"
FINAL_BINARY="${OUT_DIR}/ritual-vision-helper-${TARGET_TRIPLE}"

mkdir -p "${BUILD_DIR}" "${OUT_DIR}"

xcrun swiftc \
  -O \
  -framework Foundation \
  -framework AppKit \
  -framework Vision \
  -o "${TMP_BINARY}" \
  "${NATIVE_VISION_DIR}/VisionOcr.swift" \
  "${NATIVE_VISION_DIR}/main.swift"

cp "${TMP_BINARY}" "${FINAL_BINARY}"
chmod 755 "${FINAL_BINARY}"

echo "Built ritual-vision-helper at ${FINAL_BINARY}"
