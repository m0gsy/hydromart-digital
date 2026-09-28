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
# every proof-of-delivery photo is not — with the list, the URLs stop being secrets. The same
# run also brings each bucket's lifecycle up to date (evidence expiry + NoncurrentVersionExpiration
# — see verify-object-storage.mjs), which is why this is worth re-running whenever the rules change,
# not only the day the listing was found open.
#
# Runs on the box because the bucket keys live in the .env there and nowhere else. Reads the
# same .env every service reads, so it cannot drift from what the app actually uses.
#
# NEO's object storage gives each service its OWN bucket, its own access key/secret, and its
# own PUBLIC_BASE_URL — .env.production.example says so under "object storage" ("each service
# has its OWN bucket + access key"). There never was a single shared `STORAGE_S3_ACCESS_KEY_ID`;
# this script assumed one anyway from the day it was written and had never been run against a
# real .env since — it failed its first live re-run with "STORAGE_S3_ACCESS_KEY_ID missing from
# .env", not because the key was left blank, but because that name has never existed. Region and
# endpoint ARE shared (`STORAGE_S3_ENDPOINT`/`STORAGE_S3_REGION`) for every service except HR,
# which lives in a different NEO region entirely (`HR_STORAGE_S3_ENDPOINT`, wjv-1 not jkt-1) —
# reusing the shared endpoint for hydromart-facer would have pointed the probe at the wrong
# region's bucket of the same name, if one even exists there.
#
#   bash scripts/storage-policy.sh              # every bucket below
#   BUCKETS=hydromart-pod bash scripts/...      # just one
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env ] || { echo "no .env here — run this on the deploy box"; exit 2; }

# Read the .env, do not RUN it. `set -a; . ./.env; set +a` executes the file, and the live
# .env carries `FCM_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----…` unquoted, so the shell splits
# it on spaces and tries to run `PRIVATE`. That is not theory: this job's first real run
# died on it — `./.env: line 115: PRIVATE: command not found`, exit 127 — so the script
# written to close a live photo exposure could not reach the first bucket. load-env.sh
# exists for exactly this and is already what the host crontab uses.
# shellcheck disable=SC1091
. ./scripts/load-env.sh

# Every bucket the platform writes to, and the service whose credentials own it. Overridable
# (BUCKETS=hydromart-pod) so one can be fixed on its own without touching the others.
DEFAULT_BUCKETS="hydromart-pod hydromart-products hydromart-facer"
BUCKETS="${BUCKETS:-$DEFAULT_BUCKETS}"

# bucket name -> the env prefix that owns its credentials (.env.production.example).
prefix_for() {
  case "$1" in
    hydromart-pod) echo "DELIVERY" ;;
    hydromart-products) echo "PRODUCT" ;;
    hydromart-facer) echo "HR" ;;
    *)
      echo "!! no known credential prefix for bucket '$1' — add it to prefix_for() in this script" >&2
      return 1
      ;;
  esac
}

failed=0
for bucket in $BUCKETS; do
  echo ""
  echo "=== $bucket ==="
  prefix="$(prefix_for "$bucket")" || { failed=$((failed + 1)); continue; }
  # Indirect expansion (`${!name}`): the prefix is only known at loop time, so the variable
  # NAME itself has to be built before its value can be read.
  endpoint_var="${prefix}_STORAGE_S3_ENDPOINT"
  region_var="${prefix}_STORAGE_S3_REGION"
  key_var="${prefix}_STORAGE_S3_ACCESS_KEY_ID"
  secret_var="${prefix}_STORAGE_S3_SECRET_ACCESS_KEY"
  bucket_var="${prefix}_STORAGE_S3_BUCKET"
  url_var="${prefix}_STORAGE_PUBLIC_BASE_URL"
  # Endpoint/region are shared for every service except HR (a different NEO region) — the
  # per-service variable wins when set, the shared one otherwise.
  endpoint="${!endpoint_var:-${STORAGE_S3_ENDPOINT:-}}"
  region="${!region_var:-${STORAGE_S3_REGION:-}}"
  key="${!key_var:-}"
  secret="${!secret_var:-}"
  configured_bucket="${!bucket_var:-}"
  public_url="${!url_var:-}"

  missing=""
  [ -n "$endpoint" ] || missing="$missing $endpoint_var(or STORAGE_S3_ENDPOINT)"
  [ -n "$key" ] || missing="$missing $key_var"
  [ -n "$secret" ] || missing="$missing $secret_var"
  [ -n "$public_url" ] || missing="$missing $url_var"
  if [ -n "$missing" ]; then
    echo "!! missing from .env:$missing"
    failed=$((failed + 1))
    continue
  fi
  # Not fatal on its own — a blank *_STORAGE_S3_BUCKET is the documented "reuse another
  # service's bucket" shape (AUTH/CUSTOMER/PAYMENT can do this) — but THESE three services
  # never do, and a bucket that IS set but disagrees with the name we are about to police
  # means the two have drifted and this run would silently police the wrong one.
  if [ -n "$configured_bucket" ] && [ "$configured_bucket" != "$bucket" ]; then
    echo "!! $bucket_var=$configured_bucket, not $bucket — .env and this script have drifted"
    failed=$((failed + 1))
    continue
  fi

  # The verifier does the work AND the proof: policy → ACL private → probe object → public
  # GET → anonymous LIST must not be 200. It exits non-zero if the index is still readable.
  #
  # Each bucket runs as its OWN process. A loop that ran them in one `&&` chain would stop
  # at the first failure and leave the rest unexamined, which is how a second open bucket
  # hides behind the first one.
  if STORAGE_S3_ENDPOINT="$endpoint" \
     STORAGE_S3_REGION="$region" \
     STORAGE_S3_ACCESS_KEY_ID="$key" \
     STORAGE_S3_SECRET_ACCESS_KEY="$secret" \
     STORAGE_S3_BUCKET="$bucket" \
     STORAGE_PUBLIC_BASE_URL="$public_url" \
     node scripts/verify-object-storage.mjs; then
    echo "--- $bucket OK"
  else
    echo "--- $bucket STILL OPEN"
    failed=$((failed + 1))
  fi
done

echo ""
if [ "$failed" -gt 0 ]; then
  echo "$failed bucket(s) failed — see !! lines above. A still-open one needs the ACL set to"
  echo "private in the provider console; a missing/drifted credential needs .env fixed first."
  exit 1
fi
echo "every bucket serves objects and refuses its index."
