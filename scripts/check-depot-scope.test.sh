#!/usr/bin/env bash
# Proof that check-depot-scope.mjs can go red.
#
#   bash scripts/check-depot-scope.test.sh
#
# The gate exists because DepotScopeGuard says, in its own class comment, that it cannot see
# by-id routes — and two Kritis IDORs then lived in that blind spot for months. A gate that
# cannot fail would be the same silence wearing a green tick, so the five shapes below are
# the five this one has to get right:
#
#   1. a by-id route reachable by a depot-scoped role, with no depot assertion anywhere
#   2. the same route with the assertion in the CONTROLLER
#   3. the same route with the assertion in the SERVICE it forwards to  <- the subtle one:
#      the first version of the checker ended the handler body on `@ApiOperation({ … })`,
#      which reads EVERY guarded handler as unguarded and would have flooded the baseline
#   4. a route whose parameter is named `:depotId` — the guard already sees it, so it is
#      not a by-id route at all
#   5. a route only unscoped roles can reach — not this gate's business
#
# Everything runs against a throwaway fixture tree. A test that edits the repo's own
# controllers to prove a point is a test that leaves the repo broken when interrupted.
set -uo pipefail
# CI invokes shell checks as `bash -e file`, and cases here run commands that are SUPPOSED
# to exit 1. Under -e the first one kills the run and blames this script.
set +e
cd "$(dirname "$0")/.."

fails=0
ok() { echo "  ok   $1"; }
bad() {
  echo "  FAIL $1"
  fails=$((fails + 1))
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/scripts" "$WORK/packages/access/src" \
  "$WORK/services/fixture-service/src/modules" \
  "$WORK/services/fixture-service/src/application/services"
cp scripts/check-depot-scope.mjs "$WORK/scripts/"
echo '{ "count": 0, "routes": [] }' > "$WORK/scripts/depot-scope-baseline.json"

# `thingWrite` reaches MANAGER, which is depot-scoped. `hqOnly` does not reach any.
cat > "$WORK/packages/access/src/index.ts" <<'TS'
export const CAPABILITIES = {
  thingWrite: ['MANAGER', 'SUPER_ADMIN'],
  hqOnly: ['HEAD_OFFICE', 'SUPER_ADMIN'],
} as const;
TS

cat > "$WORK/services/fixture-service/src/application/services/thing.service.ts" <<'TS'
export class ThingService {
  async guardedInService(id: string, user?: AuthenticatedUser): Promise<Thing> {
    const row = await this.repo.findById(id);
    assertDepotAccess(user, row.depotId);
    return row;
  }

  async unguarded(id: string): Promise<Thing> {
    return this.repo.findById(id);
  }
}
TS

write_controller() {
  cat > "$WORK/services/fixture-service/src/modules/thing.controller.ts"
}
run() { ( cd "$WORK" && node scripts/check-depot-scope.mjs 2>&1 ); }

# --- case 1: the hole this gate exists for ----------------------------------
write_controller <<'TS'
@Controller({ path: 'things', version: '1' })
export class ThingController {
  @ApiOkResponse({ type: Dto })
  @Can('thingWrite')
  @Patch(':id')
  @ApiOperation({ summary: 'Update a thing' })
  update(@Param('id') id: string): Promise<Thing> {
    return this.things.unguarded(id);
  }
}
TS
OUT="$(run)"; RC=$?
if [ "$RC" = "1" ] && echo "$OUT" | grep -q "Patch :id"; then
  ok "a by-id route a manager can reach, with no depot check, is caught"
else
  bad "the unguarded by-id route did not fail as expected (rc=$RC): $OUT"
fi

# --- case 2: assertion in the controller ------------------------------------
write_controller <<'TS'
@Controller({ path: 'things', version: '1' })
export class ThingController {
  @ApiOkResponse({ type: Dto })
  @Can('thingWrite')
  @Patch(':id')
  @ApiOperation({ summary: 'Update a thing' })
  async update(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<Thing> {
    const row = await this.things.unguarded(id);
    assertDepotAccess(user, row.depotId);
    return row;
  }
}
TS
OUT="$(run)"; RC=$?
if [ "$RC" = "0" ]; then
  ok "an assertion in the controller counts"
else
  bad "a controller-guarded route was reported (rc=$RC): $OUT"
fi

# --- case 3: assertion in the service it forwards to -------------------------
# The one the first version of this checker got wrong: it stopped reading the handler at
# `@ApiOperation({ … })`, so it never saw the call and never followed it into the service.
write_controller <<'TS'
@Controller({ path: 'things', version: '1' })
export class ThingController {
  @ApiOkResponse({ type: Dto })
  @Can('thingWrite')
  @Patch(':id')
  @ApiOperation({ summary: 'Update a thing' })
  // A comment between the decorators and the signature, because real ones have them.
  update(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<Thing> {
    return this.things.guardedInService(id, user);
  }
}
TS
OUT="$(run)"; RC=$?
if [ "$RC" = "0" ]; then
  ok "an assertion in the service the handler forwards to counts"
else
  bad "a service-guarded route was reported — the handler-body reader regressed (rc=$RC): $OUT"
fi

# --- case 4: the parameter is named `:depotId` -------------------------------
write_controller <<'TS'
@Controller({ path: 'things', version: '1' })
export class ThingController {
  @ApiOkResponse({ type: Dto })
  @Can('thingWrite')
  @Patch(':depotId')
  @ApiOperation({ summary: 'Update a depot thing' })
  update(@Param('depotId') id: string): Promise<Thing> {
    return this.things.unguarded(id);
  }
}
TS
OUT="$(run)"; RC=$?
if [ "$RC" = "0" ]; then
  ok "a route whose parameter IS depotId is left to DepotScopeGuard"
else
  bad "a :depotId route was reported (rc=$RC): $OUT"
fi

# --- case 5: no depot-scoped role can reach it -------------------------------
write_controller <<'TS'
@Controller({ path: 'things', version: '1' })
export class ThingController {
  @ApiOkResponse({ type: Dto })
  @Can('hqOnly')
  @Patch(':id')
  @ApiOperation({ summary: 'Update a thing (head office)' })
  update(@Param('id') id: string): Promise<Thing> {
    return this.things.unguarded(id);
  }
}
TS
OUT="$(run)"; RC=$?
if [ "$RC" = "0" ]; then
  ok "a route no depot-scoped role can reach is not this gate's business"
else
  bad "an HQ-only route was reported (rc=$RC): $OUT"
fi

# --- case 6: the ratchet lets a KNOWN route through, and only that one -------
write_controller <<'TS'
@Controller({ path: 'things', version: '1' })
export class ThingController {
  @ApiOkResponse({ type: Dto })
  @Can('thingWrite')
  @Patch(':id')
  @ApiOperation({ summary: 'Update a thing' })
  update(@Param('id') id: string): Promise<Thing> {
    return this.things.unguarded(id);
  }
}
TS
# `--write` is how a real PR lowers the baseline, so record it the same way rather than
# hand-writing the route string this test would then be asserting against itself.
( cd "$WORK" && node scripts/check-depot-scope.mjs --write >/dev/null )
OUT="$(run)"; RC=$?
if [ "$RC" = "0" ] && echo "$OUT" | grep -q "1 unguarded by-id routes"; then
  ok "a route already in the baseline passes, and is still counted"
else
  bad "the baseline did not admit a known route (rc=$RC): $OUT"
fi

# ...and adding a SECOND one to the same file is still red.
cat >> "$WORK/services/fixture-service/src/modules/thing.controller.ts" <<'TS'

@Controller({ path: 'others', version: '1' })
export class OtherController {
  @Can('thingWrite')
  @Delete(':id')
  remove(@Param('id') id: string): Promise<void> {
    return this.things.unguarded(id);
  }
}
TS
OUT="$(run)"; RC=$?
if [ "$RC" = "1" ] && echo "$OUT" | grep -q "Delete :id"; then
  ok "the ratchet still catches a new hole next to a known one"
else
  bad "a new route beside a baselined one did not fail (rc=$RC): $OUT"
fi

echo
if [ "$fails" -eq 0 ]; then
  echo "PASS — the depot-scope gate fails on the shape it exists to catch, and only on it."
  exit 0
fi
echo "FAIL — $fails assertion(s) above."
exit 1
