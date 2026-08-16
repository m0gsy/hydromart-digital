#!/usr/bin/env bash
# Close anonymous LISTING on every upload bucket, and prove it closed.
#
# Measured 2026-08-17, unauthenticated, against production:
#
#   GET https://nos.jkt-1.neo.id/hydromart-pod?list-type=2      -> 200   every PoD photo
#   GET https://nos.jkt-1.neo.id/hydromart-products?list-type=2 -> 200   every avatar
#   GET https://nos.jkt-1.neo.id/hydromart-facer?list-type=2    -> 403   correct
#
# Serving an object to whoever holds its URL is the intent. Handing a stranger the INDEX of
# every proof-of-delivery photo is not — with the list, the URLs stop being secrets.
#
# Runs on the box because the bucket keys live in the .env there and nowhere else. Reads the
# same .env every service reads, so it cannot drift from what the app actually uses.
#
#   bash scripts/storage-policy.sh              # every bucket in .env
#   BUCKETS=hydromart-pod bash scripts/...      # just one
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env ] || { echo "no .env here — run this on the deploy box"; exit 2; }

# shellcheck disable=SC1091
set -a; . ./.env; set +a

: "${STORAGE_S3_ENDPOINT:?STORAGE_S3_ENDPOINT missing from .env}"
: "${STORAGE_S3_ACCESS_KEY_ID:?STORAGE_S3_ACCESS_KEY_ID missing from .env}"
: "${STORAGE_S3_SECRET_ACCESS_KEY:?STORAGE_S3_SECRET_ACCESS_KEY missing from .env}"

# Every bucket the platform writes to. Overridable so one can be fixed on its own.
DEFAULT_BUCKETS="hydromart-pod hydromart-products hydromart-facer"
BUCKETS="${BUCKETS:-$DEFAULT_BUCKETS}"

failed=0
for bucket in $BUCKETS; do
  echo ""
  echo "=== $bucket ==="
  # The verifier does the work AND the proof: policy → ACL private → probe object → public
  # GET → anonymous LIST must not be 200. It exits non-zero if the index is still readable.
  #
  # Each bucket runs as its OWN process. A loop that ran them in one `&&` chain would stop
  # at the first failure and leave the rest unexamined, which is how a second open bucket
  # hides behind the first one.
  if STORAGE_S3_BUCKET="$bucket" \
     STORAGE_PUBLIC_BASE_URL="${STORAGE_S3_ENDPOINT%/}/$bucket" \
     node scripts/verify-object-storage.mjs; then
    echo "--- $bucket OK"
  else
    echo "--- $bucket STILL OPEN"
    failed=$((failed + 1))
  fi
done

echo ""
if [ "$failed" -gt 0 ]; then
  echo "$failed bucket(s) still list anonymously — set the bucket ACL to private in the"
  echo "provider console for those, then re-run this job."
  exit 1
fi
echo "every bucket serves objects and refuses its index."
