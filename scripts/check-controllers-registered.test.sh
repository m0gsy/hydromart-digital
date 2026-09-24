#!/usr/bin/env bash
# The runnable check for scripts/check-controllers-registered.mjs.
#
#   bash scripts/check-controllers-registered.test.sh
#
# A gate that has never gone red proves nothing, so this builds a throwaway repo tree and
# shows it red for the defect that shipped (a controller nobody mounts) and for the shape
# that would slip past a naive check (mounted only by an import).
set -uo pipefail
# CI invokes this as `bash -e file`; the negative cases below are SUPPOSED to exit non-zero.
set +e
cd "$(dirname "$0")/.."
GATE="$PWD/scripts/check-controllers-registered.mjs"

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
cat > "$SRC/a.controller.ts" <<'TS'
import { Controller, Get } from '@nestjs/common';
@Controller({ path: 'alpha', version: '1' })
export class AlphaController {
  @Get()
  list() {}
}
TS
cat > "$SRC/b.controller.ts" <<'TS'
import { Controller, Get } from '@nestjs/common';
@Controller({ path: 'beta', version: '1' })
export class BetaController {
  @Get()
  list() {}
}
TS

run() {
  OUT="$(HYDROMART_ROOT="$WORK" node "$GATE" 2>&1)"
  RC=$?
}

echo "check-controllers-registered:"

# 1. Both mounted -> green.
cat > "$SRC/demo.module.ts" <<'TS'
import { Module } from '@nestjs/common';
import { AlphaController } from './a.controller';
import { BetaController } from './b.controller';
@Module({ controllers: [AlphaController, BetaController] })
export class DemoModule {}
TS
run
[ "$RC" = 0 ] && ok "green when every controller is mounted" || bad "should pass: $OUT"

# 2. The kasbon shape: written, tested by hand, never listed.
cat > "$SRC/demo.module.ts" <<'TS'
import { Module } from '@nestjs/common';
import { AlphaController } from './a.controller';
@Module({ controllers: [AlphaController] })
export class DemoModule {}
TS
run
[ "$RC" = 1 ] && ok "RED when a controller is not mounted" || bad "an unmounted controller must fail (rc=$RC)"
case "$OUT" in *BetaController*) ok "  ...and names it" ;; *) bad "  expected BetaController in: $OUT" ;; esac

# 3. Imported but never listed: the name is in the file, the route is not in the app.
cat > "$SRC/demo.module.ts" <<'TS'
import { Module } from '@nestjs/common';
import { AlphaController } from './a.controller';
import { BetaController } from './b.controller';
@Module({ controllers: [AlphaController] })
export class DemoModule {}
TS
run
[ "$RC" = 1 ] && ok "RED when a controller is only imported" || bad "an import must not count as mounting (rc=$RC)"

# 4. A mention in a comment is not a mount either.
cat > "$SRC/demo.module.ts" <<'TS'
import { Module } from '@nestjs/common';
import { AlphaController } from './a.controller';
// BetaController is registered elsewhere (it is not)
@Module({ controllers: [AlphaController] })
export class DemoModule {}
TS
run
[ "$RC" = 1 ] && ok "RED when the name only appears in a comment" || bad "a comment must not count (rc=$RC)"

# 5. And the real repository passes today.
OUT="$(node "$GATE" 2>&1)"
RC=$?
[ "$RC" = 0 ] && ok "the repository itself passes" || bad "repo should pass: $OUT"

if [ "$fails" -gt 0 ]; then
  echo "check-controllers-registered: $fails check(s) failed" >&2
  exit 1
fi
echo "check-controllers-registered: all checks passed"
