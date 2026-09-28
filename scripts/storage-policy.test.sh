#!/usr/bin/env bash
# One thing worth proving about storage-policy.sh: a failing bucket must not end the run.
#
# A loop written as `a && b && c` stops at the first failure, and the second open bucket
# then hides behind the first — you fix one, re-run, and discover another, one release at a
# time. This drives the script with a stub `node` so no credentials and no network are
# involved: the stub fails for one bucket and succeeds for the others.
#
#   bash scripts/storage-policy.test.sh
set -uo pipefail

cd "$(dirname "$0")/.."
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# A .env with just enough for the guards, and an obviously fake key.
#
# The PEM line is not padding. The live .env holds `FCM_PRIVATE_KEY=-----BEGIN PRIVATE
# KEY-----…` with no quotes, and the first real run of this job died on it (`./.env: line
# 115: PRIVATE: command not found`, exit 127) before it reached a single bucket. A file that
# is READ rather than RUN does not care; one that is sourced does. So the fixture carries
# the shape that broke it.
#
# Per-service creds, not one shared `STORAGE_S3_ACCESS_KEY_ID` — the shape .env.production.example
# actually documents. There never was a single shared key; the script's first live re-run
# died proving it ("STORAGE_S3_ACCESS_KEY_ID missing from .env"). HR gets its own endpoint on
# purpose: it lives in a different NEO region (wjv-1) from the other two (jkt-1).
cat > "$tmp/.env" <<'EOF'
STORAGE_S3_ENDPOINT=https://storage.invalid
STORAGE_S3_REGION=jkt-1
FCM_PRIVATE_KEY=---- BEGIN NOT A KEY ---- body with spaces ---- END ----
DELIVERY_STORAGE_S3_ACCESS_KEY_ID=test
DELIVERY_STORAGE_S3_SECRET_ACCESS_KEY=test
DELIVERY_STORAGE_PUBLIC_BASE_URL=https://storage.invalid/hydromart-pod
PRODUCT_STORAGE_S3_ACCESS_KEY_ID=test
PRODUCT_STORAGE_S3_SECRET_ACCESS_KEY=test
PRODUCT_STORAGE_PUBLIC_BASE_URL=https://storage.invalid/hydromart-products
HR_STORAGE_S3_ENDPOINT=https://storage-hr.invalid
HR_STORAGE_S3_REGION=idn
HR_STORAGE_S3_ACCESS_KEY_ID=test
HR_STORAGE_S3_SECRET_ACCESS_KEY=test
HR_STORAGE_PUBLIC_BASE_URL=https://storage-hr.invalid/hydromart-facer
EOF

# Stub `node`: fails for hydromart-pod, succeeds otherwise. Prints the endpoint it was actually
# handed, so a test can prove hydromart-facer got HR's own (wjv-1) rather than the shared jkt-1 one.
mkdir -p "$tmp/bin"
cat > "$tmp/bin/node" <<'EOF'
#!/usr/bin/env bash
echo "stub verify for ${STORAGE_S3_BUCKET} at ${STORAGE_S3_ENDPOINT} (key=${STORAGE_S3_ACCESS_KEY_ID})"
[ "${STORAGE_S3_BUCKET}" = "hydromart-pod" ] && exit 1
exit 0
EOF
chmod +x "$tmp/bin/node"

mkdir -p "$tmp/repo/scripts"
cp scripts/storage-policy.sh scripts/load-env.sh "$tmp/repo/scripts/"
cp "$tmp/.env" "$tmp/repo/.env"

out="$(cd "$tmp/repo" && PATH="$tmp/bin:$PATH" \
  BUCKETS="hydromart-pod hydromart-products hydromart-facer" \
  bash scripts/storage-policy.sh 2>&1)"
status=$?

fail=0
check() { # name, condition-already-evaluated
  if [ "$2" = "0" ]; then echo "PASS  $1"; else echo "FAIL  $1"; fail=1; fi
}

echo "$out" | grep -q "stub verify for hydromart-pod"; check "an unquoted PEM in .env no longer kills the run" "$?"
echo "$out" | grep -q "stub verify for hydromart-products"; check "kept going past the failing bucket" "$?"
echo "$out" | grep -q "stub verify for hydromart-facer"; check "reached the last bucket too" "$?"
echo "$out" | grep -q "hydromart-pod STILL OPEN"; check "named the bucket that failed" "$?"
[ "$status" -ne 0 ]; check "exited non-zero so a job cannot go green over it" "$?"

# Each bucket gets ITS OWN service's credentials, not one shared key that never existed.
echo "$out" | grep -q "hydromart-pod at https://storage.invalid (key=test)"
check "delivery's own credentials reach the pod bucket" "$?"
echo "$out" | grep -q "hydromart-products at https://storage.invalid (key=test)"
check "product's own credentials reach the products bucket" "$?"
# HR lives in a different NEO region (wjv-1, not jkt-1) — reusing the shared endpoint would
# point the probe at the wrong region's bucket of the same name, if one even exists there.
echo "$out" | grep -q "hydromart-facer at https://storage-hr.invalid (key=test)"
check "HR's own endpoint (not the shared jkt-1 one) reaches the facer bucket" "$?"

# A credential missing from .env is refused by NAME, not handed to node as an empty string —
# an empty access key ID is a request the provider answers, just never the one intended. The
# variable comes from the FILE (load-env.sh sources it), so the fixture omits the line rather
# than trying to unset an inherited one that .env would just re-supply anyway.
grep -v '^DELIVERY_STORAGE_S3_ACCESS_KEY_ID=' "$tmp/repo/.env" > "$tmp/repo/.env.nokey"
mv "$tmp/repo/.env.nokey" "$tmp/repo/.env"
out2="$(cd "$tmp/repo" && PATH="$tmp/bin:$PATH" BUCKETS="hydromart-pod" bash scripts/storage-policy.sh 2>&1)"
status2=$?
cp "$tmp/.env" "$tmp/repo/.env"
echo "$out2" | grep -q "DELIVERY_STORAGE_S3_ACCESS_KEY_ID"
check "names the exact missing variable" "$?"
echo "$out2" | grep -q "stub verify for"; [ "$?" != "0" ]
check "never calls the verifier with a blank credential" "$?"
[ "$status2" -ne 0 ]; check "a missing credential still exits non-zero" "$?"

# A bucket whose OWN env var disagrees with what this script is policing has drifted, and
# running anyway would police the wrong bucket while reporting success for this one.
out3="$(cd "$tmp/repo" && PATH="$tmp/bin:$PATH" DELIVERY_STORAGE_S3_BUCKET=hydromart-something-else \
  BUCKETS="hydromart-pod" bash scripts/storage-policy.sh 2>&1)"
status3=$?
echo "$out3" | grep -q "DELIVERY_STORAGE_S3_BUCKET=hydromart-something-else, not hydromart-pod"
check "catches .env and this script disagreeing on which bucket DELIVERY owns" "$?"
[ "$status3" -ne 0 ]; check "a drifted bucket mapping still exits non-zero" "$?"

# An unknown bucket name has no credential mapping and must not run with an empty environment.
out4="$(cd "$tmp/repo" && PATH="$tmp/bin:$PATH" BUCKETS="hydromart-mystery" bash scripts/storage-policy.sh 2>&1)"
status4=$?
echo "$out4" | grep -q "no known credential prefix for bucket 'hydromart-mystery'"
check "refuses a bucket it has no credential mapping for" "$?"
[ "$status4" -ne 0 ]; check "an unmapped bucket still exits non-zero" "$?"

exit "$fail"
