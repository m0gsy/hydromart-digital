#!/usr/bin/env bash
# The runnable check for the AUTHZ-A2 half of scripts/check-depot-scope-guards.mjs.
#
#   bash scripts/check-depot-scope-guards.test.sh
#
# This gate ran green every day while the bug it is named after was live: it asked whether
# DepotScopeGuard was INSTALLED, and AUTHZ-A2 was about what the installed guard READ. So the
# first thing asserted here is that the gate goes RED against the guard as it was written
# before the fix — the actual pre-fix source, reconstructed, not a paraphrase.
set -uo pipefail
cd "$(dirname "$0")/.."

GUARD=packages/platform/src/nest/depot-scope.guard.ts
WORK="$(mktemp -d)"
cp "$GUARD" "$WORK/guard.orig"
trap 'cp "$WORK/guard.orig" "$GUARD"; rm -rf "$WORK"' EXIT

fails=0
ok() { echo "  ok   $1"; }
bad() {
  echo "  FAIL $1"
  fails=$((fails + 1))
}
run_check() {
  set +e
  OUT="$(node scripts/check-depot-scope-guards.mjs 2>&1)"
  RC=$?
  set -e
}

echo "check-depot-scope-guards (AUTHZ-A2):"

run_check
[ "$RC" = 0 ] && ok "passes on the repository as it stands" || bad "the repo should pass: $OUT"

# 1. The guard as it was: first value wins, singular collector, one includes() check.
python - "$GUARD" <<'PY'
import io, re, sys
p = sys.argv[1]
s = io.open(p, encoding='utf-8').read()
start = s.index('    const requested = DepotScopeGuard.requestedDepotIds(request);')
end = s.rindex('}\n')
old = """    const requested = DepotScopeGuard.requestedDepotId(request);
    if (!requested) {
      return true;
    }

    if ((user.depotIds ?? []).includes(requested)) {
      return true;
    }
    throw new ForbiddenException(
      'Akun ini hanya boleh mengakses depot yang menjadi tanggung jawabnya.',
    );
  }

  /** First depotId found across query, body, and route params (string values only). */
  private static requestedDepotId(request: Request): string | null {
    const q = request.query?.['depotId'];
    if (typeof q === 'string' && q.length > 0) return q;
    const b = (request.body as Record<string, unknown> | undefined)?.['depotId'];
    if (typeof b === 'string' && b.length > 0) return b;
    const p = request.params?.['depotId'];
    if (typeof p === 'string' && p.length > 0) return p;
    return null;
  }
"""
io.open(p, 'w', encoding='utf-8', newline='\n').write(s[:start] + old + s[end:])
PY
run_check
[ "$RC" = 1 ] && ok "goes RED on the pre-fix guard (first depotId wins)" || bad "AUTHZ-A2 must fail this gate (rc=$RC)"
case "$OUT" in *AUTHZ-A2*) ok "  ...and names the finding" ;; *) bad "  expected AUTHZ-A2 in the message: $OUT" ;; esac
cp "$WORK/guard.orig" "$GUARD"

# 2. A guard that collects every value but only checks that ONE of them is allowed.
sed -i 's/requested\.every(/requested.some(/' "$GUARD"
run_check
[ "$RC" = 1 ] && ok "goes RED when only one of the depots has to be allowed" || bad "\`.some(\` must fail (rc=$RC)"
cp "$WORK/guard.orig" "$GUARD"

# 3. A guard that stops reading the route params — the source the handler uses.
sed -i "s/take(request.params?\[key\]);//" "$GUARD"
python - "$GUARD" <<'PY'
import io, sys
p = sys.argv[1]
s = io.open(p, encoding='utf-8').read()
s = s.replace("      take(request.params?.[key]);\n", "")
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
PY
run_check
[ "$RC" = 1 ] && ok "goes RED when the guard stops reading route params" || bad "a blind source must fail (rc=$RC)"
cp "$WORK/guard.orig" "$GUARD"

# 4. A controller reading a selector key the guard has never heard of — the general form of
#    AUTHZ-A2, and how `depotIds` slipped past this gate on inventory/low-stock.
python - <<'PY'
import io
p = 'packages/platform/src/nest/depot-scope.guard.ts'
s = io.open(p, encoding='utf-8').read()
s = s.replace("for (const key of ['depotId', 'depotIds'])", "for (const key of ['depotId'])")
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
PY
run_check
[ "$RC" = 1 ] && ok "goes RED when a controller reads a selector the guard does not collect" || bad "an unknown selector must fail (rc=$RC)"
case "$OUT" in *depotIds*) ok "  ...and names the key" ;; *) bad "  expected the key in the message: $OUT" ;; esac
cp "$WORK/guard.orig" "$GUARD"

exit "$fails"
