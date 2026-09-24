#!/usr/bin/env bash
# The runnable check for scripts/check-retention-routes.mjs.
#
#   bash scripts/check-retention-routes.test.sh
#
# Shows the gate red for the defect it exists for — an executor whose path names a route no
# controller declares, or declares with the wrong method — and green on a registry whose
# every path resolves.
set -uo pipefail
# CI invokes this as `bash -e file`; the negative cases below are SUPPOSED to exit non-zero.
set +e
cd "$(dirname "$0")/.."
GATE="$PWD/scripts/check-retention-routes.mjs"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fails=0
ok() { echo "  ok   $1"; }
bad() {
  echo "  FAIL $1"
  fails=$((fails + 1))
}

SRC="$WORK/services/demo-service/src/modules"
mkdir -p "$SRC"
cat > "$SRC/retention.controller.ts" <<'TS'
import { Controller, Get, Post } from '@nestjs/common';
@Controller({ path: 'proofs', version: '1' })
export class RetentionController {
  @Post('purge-expired')
  purge() {}
  @Get('status')
  status() {}
}
TS

REGISTRY="$WORK/registry.ts"
run() {
  OUT="$(HYDROMART_ROOT="$WORK" RETENTION_REGISTRY="$REGISTRY" node "$GATE" 2>&1)"
  RC=$?
}

echo "check-retention-routes:"

cat > "$REGISTRY" <<'TS'
const REMOTE_DATASETS = [
  { dataset: 'proof_of_delivery', envKey: 'X_URL', path: '/api/v1/proofs/purge-expired', mode: 'DELETE' },
] as const;
TS
run
[ "$RC" = 0 ] && ok "green when every executor path is a real POST route" || bad "should pass: $OUT"

cat > "$REGISTRY" <<'TS'
const REMOTE_DATASETS = [
  { dataset: 'proof_of_delivery', envKey: 'X_URL', path: '/api/v1/proofs/purge-expired', mode: 'DELETE' },
  { dataset: 'payment_proof', envKey: 'Y_URL', path: '/api/v1/payments/internal/purge-proofs', mode: 'DELETE' },
] as const;
TS
run
[ "$RC" = 1 ] && ok "RED when an executor calls a route nothing declares" || bad "a missing route must fail (rc=$RC)"
case "$OUT" in *payment_proof*) ok "  ...and names the dataset" ;; *) bad "  expected the dataset in: $OUT" ;; esac

cat > "$REGISTRY" <<'TS'
const REMOTE_DATASETS = [
  { dataset: 'proof_of_delivery', envKey: 'X_URL', path: '/api/v1/proofs/status', mode: 'DELETE' },
] as const;
TS
run
[ "$RC" = 1 ] && ok "RED when the route exists but only as GET" || bad "the sweep POSTs; a GET-only route must fail (rc=$RC)"

cat > "$REGISTRY" <<'TS'
// { dataset: 'commented_out', path: '/api/v1/nowhere' }
const REMOTE_DATASETS = [
  { dataset: 'proof_of_delivery', envKey: 'X_URL', path: '/api/v1/proofs/purge-expired', mode: 'DELETE' },
] as const;
TS
run
[ "$RC" = 0 ] && ok "a commented-out executor is not an executor" || bad "comments must not count: $OUT"

echo 'export const nothing = [];' > "$REGISTRY"
run
[ "$RC" = 1 ] && ok "RED when the parser finds no executors at all (a stale parser proves nothing)" || bad "an empty parse must fail (rc=$RC)"

OUT="$(node "$GATE" 2>&1)"
RC=$?
[ "$RC" = 0 ] && ok "the repository itself passes" || bad "repo should pass: $OUT"

if [ "$fails" -gt 0 ]; then
  echo "check-retention-routes: $fails check(s) failed" >&2
  exit 1
fi
echo "check-retention-routes: all checks passed"
