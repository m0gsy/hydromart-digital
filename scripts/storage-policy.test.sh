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
cat > "$tmp/.env" <<'EOF'
STORAGE_S3_ENDPOINT=https://storage.invalid
FCM_PRIVATE_KEY=---- BEGIN NOT A KEY ---- body with spaces ---- END ----
STORAGE_S3_ACCESS_KEY_ID=test
STORAGE_S3_SECRET_ACCESS_KEY=test
EOF

# Stub `node`: fails for hydromart-pod, succeeds otherwise. Printed so the run is readable.
mkdir -p "$tmp/bin"
cat > "$tmp/bin/node" <<'EOF'
#!/usr/bin/env bash
echo "stub verify for ${STORAGE_S3_BUCKET}"
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

exit "$fail"
