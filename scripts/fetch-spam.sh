#!/usr/bin/env bash
set -euo pipefail

BUCKET="tomaskohlcom-jcomments"
DATE="${1:-$(date +%Y-%m-%d)}"

npx wrangler r2 object get "$BUCKET/spam/${DATE}.json" --remote --pipe 2>/dev/null | jq .
