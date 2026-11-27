#!/usr/bin/env bash
# Deploy mode `visit-bucket`: create the supervisor visit-photo bucket (HD-15B) and prove it
# PRIVATE (see visit-bucket.mjs). Runs on the box: the NOS key lives in the .env there only.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "no .env here — run this on the deploy box"; exit 2; }
# shellcheck disable=SC1091
. ./scripts/load-env.sh
node scripts/visit-bucket.mjs
