#!/usr/bin/env bash
# The runnable check for scripts/check-sweep-coverage.mjs.
#
#   bash scripts/check-sweep-coverage.test.sh
#
# A coverage gate that cannot go red is a comment. Each case below hands the gate a small copy of
# the two file trees (a pass file and an app folder) built to be wrong in one specific way, and
# asserts it names that way — plus the clean case, and the real repository.
set -uo pipefail
# CI runs self-checks as `bash -e file`, and every negative case below is SUPPOSED to exit 1.
set +e
cd "$(dirname "$0")/.."

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
fails=0
ok() { echo "  ok   $1"; }
bad() {
  echo "  FAIL $1"
  fails=$((fails + 1))
}

# A pass file whose five lists cover /a, /b/detail, /c, /d, /e; the gate wants >=5 lists.
make_pass() {
  cat >"$1" <<EOF
const HQ = R(\`
/a $2
\`);
const OPS = R(\`
/b/detail
\`);
const MANAGER = R(\`
/c
\`);
const DRIVER = R(\`
/d
\`);
const SHOP = R(\`
/e
\`);
EOF
}
make_app() {
  rm -rf "$1"
  # hq/login is the one page the gate exempts by name, so the clean tree has it.
  for route in a b/detail c d e hq/login "$@"; do
    [ "$route" = "$1" ] && continue
    mkdir -p "$1/$route"
    echo "export default function P() { return null; }" >"$1/$route/page.tsx"
  done
}

echo "check-sweep-coverage:"

# --- clean: every page swept ------------------------------------------------------------------
make_pass "$WORK/pass.mjs" ""
make_app "$WORK/app"
OUT="$(node scripts/check-sweep-coverage.mjs --pass "$WORK/pass.mjs" --app "$WORK/app" 2>&1)"
[ $? -eq 0 ] && ok "passes when every page is swept and every swept route is a page" || bad "clean case failed: $OUT"

# --- an unswept page (the 42 that were found) --------------------------------------------------
mkdir -p "$WORK/app/hr/employees"
echo "export default function P() { return null; }" >"$WORK/app/hr/employees/page.tsx"
OUT="$(node scripts/check-sweep-coverage.mjs --pass "$WORK/pass.mjs" --app "$WORK/app" 2>&1)"
if [ $? -ne 0 ] && echo "$OUT" | grep -q "/hr/employees is a page no sweep list visits"; then
  ok "goes red on a page that no list visits, and names it"
else
  bad "an unswept page was not caught: $OUT"
fi
rm -rf "$WORK/app/hr"

# --- a phantom route (the 404s that read as broken screens) -----------------------------------
make_pass "$WORK/pass.mjs" "/ghost"
OUT="$(node scripts/check-sweep-coverage.mjs --pass "$WORK/pass.mjs" --app "$WORK/app" 2>&1)"
if [ $? -ne 0 ] && echo "$OUT" | grep -q "lists /ghost, which has no page.tsx"; then
  ok "goes red on a listed route with no page, and names it"
else
  bad "a phantom route was not caught: $OUT"
fi
make_pass "$WORK/pass.mjs" ""

# --- a route group adds no URL segment ----------------------------------------------------------
mkdir -p "$WORK/app/(shop)/f"
echo "export default function P() { return null; }" >"$WORK/app/(shop)/f/page.tsx"
OUT="$(node scripts/check-sweep-coverage.mjs --pass "$WORK/pass.mjs" --app "$WORK/app" 2>&1)"
if [ $? -ne 0 ] && echo "$OUT" | grep -q "/f is a page no sweep list visits"; then
  ok "reads a page inside a (route group) as /f, not /(shop)/f"
else
  bad "route group not stripped: $OUT"
fi
rm -rf "$WORK/app/(shop)"

# --- a pass file the reader cannot parse must not read as "no problems" -------------------------
echo "// nothing here" >"$WORK/empty.mjs"
OUT="$(node scripts/check-sweep-coverage.mjs --pass "$WORK/empty.mjs" --app "$WORK/app" 2>&1)"
if [ $? -ne 0 ] && echo "$OUT" | grep -q "found only 0 route list"; then
  ok "refuses to pass when it cannot find the route lists"
else
  bad "an unreadable pass file passed: $OUT"
fi

# --- the real repository ------------------------------------------------------------------------
OUT="$(node scripts/check-sweep-coverage.mjs 2>&1)"
[ $? -eq 0 ] && ok "the repository itself is covered" || bad "the repository has a coverage gap: $OUT"

echo
if [ "$fails" -gt 0 ]; then
  echo "check-sweep-coverage: $fails failure(s)"
  exit 1
fi
echo "check-sweep-coverage: all checks passed"
