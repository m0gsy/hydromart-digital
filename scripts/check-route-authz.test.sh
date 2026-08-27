#!/usr/bin/env bash
# Proof that check-route-authz.mjs can go red, and on the right things.
#
#   bash scripts/check-route-authz.test.sh
#
# The rule it enforces is worth exactly what its false negatives cost, and this checker has
# already produced two of them while being written:
#
#   - it read only the decorators ABOVE @Post, so a class whose @UseGuards sits below it
#     looked unguarded;
#   - it ended a route's block at the method signature, which is where @CurrentUser() lives,
#     so twelve correctly self-scoped routes were reported as unauthorised.
#
# Both are pinned below. Everything runs against a throwaway fixture tree — never the real
# services — so an interrupted run cannot leave the repo in a state that passes.
set -uo pipefail
# CI invokes shell checks as `bash -e file`, and half the cases here run a command that is
# SUPPOSED to exit 1.
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
mkdir -p "$WORK/scripts" "$WORK/services/fixture-service/src/modules"
cp scripts/check-route-authz.mjs "$WORK/scripts/"

MOD="$WORK/services/fixture-service/src/modules"

# Writes one controller file and runs the checker over it. $1 is the file body.
run_fixture() {
  cat > "$MOD/thing.controller.ts"
  ( cd "$WORK" && node scripts/check-route-authz.mjs 2>&1 )
}

expect() { # expect <want-rc> <label> <stdin=body>
  local want="$1" label="$2" out rc
  out="$(run_fixture)"
  rc=$?
  if [ "$rc" = "$want" ]; then ok "$label"; else bad "$label (want exit $want, got $rc): $out"; fi
}

# --- passes: a capability on the route -------------------------------------
expect 0 'a route with @Can passes' <<'TS'
@Controller({ path: 'things', version: '1' })
export class ThingController {
  @Can('thingRead')
  @Get('list')
  list(): Promise<void> {
    return this.things.list();
  }
}
TS

# --- passes: the guard written BELOW the verb, the way hr-service writes it -
expect 0 'a guard written below @Post still counts' <<'TS'
@Controller({ path: 'things', version: '1' })
export class ThingController {
  @Post('sweep')
  @Public()
  @UseGuards(InternalAuthGuard)
  sweep(): Promise<void> {
    return this.things.sweep();
  }
}
TS

# --- passes: class-level capability -----------------------------------------
expect 0 'a class-level @Can covers its routes' <<'TS'
@Can('thingAdmin')
@Controller({ path: 'things', version: '1' })
export class ThingController {
  @Get('list')
  list(): Promise<void> {
    return this.things.list();
  }
}
TS

# --- passes: self-scoped. THE regression case -------------------------------
# @CurrentUser() is a PARAMETER decorator: it lives in the signature, which is exactly
# where the first version of the checker stopped looking.
expect 0 'a self-scoped route passes on @CurrentUser() in its signature' <<'TS'
@Controller({ version: '1' })
export class SelfController {
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.things.forUser(user.sub);
  }
}
TS

# --- fails: nothing at all --------------------------------------------------
expect 1 'a route with no authorisation and no subject is refused' <<'TS'
@Controller({ path: 'things', version: '1' })
export class ThingController {
  @Get('everything')
  everything(): Promise<void> {
    return this.things.everything();
  }
}
TS

# --- fails: the previous method's @CurrentUser() must not cover this one ----
# The blocks are bounded by the surrounding method bodies for this reason: without that,
# one self-scoped route would vouch for every bare route written under it.
expect 1 'a bare route under a self-scoped one is still refused' <<'TS'
@Controller({ version: '1' })
export class MixedController {
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.things.forUser(user.sub);
  }

  @Get('everyone')
  everyone(): Promise<void> {
    return this.things.everyone();
  }
}
TS

# --- fails: a decorator that is only mentioned in prose ---------------------
expect 1 'a @Can named only inside a comment does not count' <<'TS'
@Controller({ path: 'things', version: '1' })
export class ThingController {
  // This used to be @Can('thingRead') before the refactor.
  @Get('list')
  list(): Promise<void> {
    return this.things.list();
  }
}
TS

# --- passes: the deliberate marker, which must carry a reason ---------------
expect 0 'a route-authz: marker with a reason is accepted' <<'TS'
@Controller({ path: 'things', version: '1' })
export class ThingController {
  /*
   * route-authz: takes no subject — the same constant for every caller.
   */
  @Get('constant')
  constantValue(): Promise<void> {
    return this.things.constant();
  }
}
TS

# --- fails: no routes at all is not a pass ----------------------------------
# A checker that goes green on an empty tree proves nothing, and is how a broken extractor
# stays broken. Everything else here would still pass if the regex stopped matching.
rm -f "$MOD/thing.controller.ts"
( cd "$WORK" && node scripts/check-route-authz.mjs >/dev/null 2>&1 )
if [ $? = 1 ]; then
  ok 'finding no routes at all is a failure, not a pass'
else
  bad 'an empty tree exited 0 — a checker that matches nothing must go red'
fi

echo
if [ "$fails" -eq 0 ]; then
  echo "PASS — the route-authz gate accepts the four legitimate shapes and refuses the three bad ones."
  exit 0
fi
echo "FAIL — $fails assertion(s) above."
exit 1
