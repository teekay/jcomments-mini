#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$SCRIPT_DIR/.env" ] && source "$SCRIPT_DIR/.env"

COUNT="${1:-10}"

if [ -z "${API_URL:-}" ]; then
  echo "Set API_URL in .env or environment" >&2
  exit 1
fi

curl -sf "$API_URL/comments" | jq -r --argjson n "$COUNT" \
  '[to_entries[] | .key as $page | .value[] | . + {page: $page}]
   | sort_by(.createdAt) | reverse | .[:$n]
   | .[] | "\(.createdAt) [\(.page)] \(.author): \(.text[:80])"'
