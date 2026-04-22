#!/usr/bin/env bash

# Manage the Name & Photo Sharing profile on Ritual's SendBlue number.
#
# iMessage recipients see this contact card (name + photo) instead of a raw
# number. This is a one-shot configuration, not a per-message integration.
#
# Usage:
#   scripts/sendblue-contact-profile.sh get
#   scripts/sendblue-contact-profile.sh set [--first NAME] [--last NAME] \
#                                           [--display NAME] [--photo-url URL]
#   scripts/sendblue-contact-profile.sh delete
#
# Environment (reads apps/backend/.env if present):
#   SENDBLUE_API_KEY        - SendBlue API key id   (sb-api-key-id)
#   SENDBLUE_API_SECRET     - SendBlue API secret   (sb-api-secret-key)
#   SENDBLUE_FROM_NUMBER    - E.164 Ritual number   (e.g. +14155551234)
#   RITUAL_CONTACT_PHOTO_URL - override photo URL for `set` (optional)
#                              default: https://app.ritual.so/brand/contact-card.png

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/apps/backend/.env"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${SENDBLUE_API_KEY:?SENDBLUE_API_KEY not set}"
: "${SENDBLUE_API_SECRET:?SENDBLUE_API_SECRET not set}"
: "${SENDBLUE_FROM_NUMBER:?SENDBLUE_FROM_NUMBER not set (e.g. +14155551234)}"

BASE_URL="https://api.sendblue.com/api/v2/contact-sharing"

PRETTY="cat"
if command -v jq >/dev/null 2>&1; then
  PRETTY="jq ."
fi

auth_headers=(
  -H "sb-api-key-id: $SENDBLUE_API_KEY"
  -H "sb-api-secret-key: $SENDBLUE_API_SECRET"
)

url_encode_number() {
  # E.164 numbers start with `+`, which must be percent-encoded in query strings.
  printf '%s' "$1" | sed 's/+/%2B/g'
}

cmd_get() {
  local encoded
  encoded=$(url_encode_number "$SENDBLUE_FROM_NUMBER")
  echo "GET $BASE_URL/state?fromNumber=$SENDBLUE_FROM_NUMBER" >&2
  curl -sS --fail-with-body -X GET \
    "$BASE_URL/state?fromNumber=$encoded" \
    "${auth_headers[@]}" | $PRETTY
}

cmd_set() {
  local first="Ritual"
  local last=""
  local display="Ritual"
  local photo_url="${RITUAL_CONTACT_PHOTO_URL:-https://app.ritual.so/brand/contact-card.png}"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --first)      first="$2";      shift 2 ;;
      --last)       last="$2";       shift 2 ;;
      --display)    display="$2";    shift 2 ;;
      --photo-url)  photo_url="$2";  shift 2 ;;
      *) echo "Unknown flag: $1" >&2; exit 2 ;;
    esac
  done

  if [[ -z "$photo_url" ]]; then
    echo "error: photo URL is empty" >&2
    exit 2
  fi

  echo "current state:" >&2
  cmd_get >&2 || true
  echo >&2
  echo "about to overwrite profile for $SENDBLUE_FROM_NUMBER:" >&2
  echo "  firstName:   $first" >&2
  echo "  lastName:    $last" >&2
  echo "  displayName: $display" >&2
  echo "  photoUrl:    $photo_url" >&2
  read -r -p "proceed? [y/N] " confirm
  [[ "$confirm" == "y" || "$confirm" == "Y" ]] || { echo "aborted." >&2; exit 1; }

  local payload
  payload=$(cat <<JSON
{
  "fromNumber": "$SENDBLUE_FROM_NUMBER",
  "firstName": "$first",
  "lastName": "$last",
  "displayName": "$display",
  "photoUrl": "$photo_url"
}
JSON
)

  echo "POST $BASE_URL/profile" >&2
  curl -sS --fail-with-body -X POST \
    "$BASE_URL/profile" \
    "${auth_headers[@]}" \
    -H "Content-Type: application/json" \
    -d "$payload" | $PRETTY
}

cmd_delete() {
  echo "about to DELETE contact profile for $SENDBLUE_FROM_NUMBER" >&2
  read -r -p "proceed? [y/N] " confirm
  [[ "$confirm" == "y" || "$confirm" == "Y" ]] || { echo "aborted." >&2; exit 1; }

  echo "DELETE $BASE_URL/profile" >&2
  curl -sS --fail-with-body -X DELETE \
    "$BASE_URL/profile" \
    "${auth_headers[@]}" \
    -H "Content-Type: application/json" \
    -d "{\"fromNumber\": \"$SENDBLUE_FROM_NUMBER\"}" | $PRETTY
}

case "${1:-}" in
  get)    shift; cmd_get    "$@" ;;
  set)    shift; cmd_set    "$@" ;;
  delete) shift; cmd_delete "$@" ;;
  *)
    echo "usage: $0 {get|set|delete} [flags]" >&2
    echo "see header of $0 for details" >&2
    exit 2
    ;;
esac
