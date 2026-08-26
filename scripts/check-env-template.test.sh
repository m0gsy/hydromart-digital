#!/usr/bin/env bash
# Self-check for check-env-template.mjs. A documentation gate has two ways to be worthless
# and both look identical in a green run: never firing, or firing on everything. The
# fixture below carries one of each — a variable the template documents, one it does not,
# one documented only as a commented-out line, and one on the tooling allowlist.
#
# The fixture names deliberately share no substring: an earlier draft used DOCUMENTED_KEY
# and UNDOCUMENTED_KEY, and `grep -q DOCUMENTED_KEY` matched the second one inside the
# first. The assertion failed on a report that was in fact correct.
set -euo pipefail

WORK="$(mktemp -d)"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

cat > "$WORK/compose.yml" <<'YML'
services:
  app:
    environment:
      A: ${ALPHA_IN_TEMPLATE:-x}
      B: ${BRAVO_COMMENTED_OUT:-x}
      C: ${CHARLIE_NOWHERE:-x}
      D: ${IMAGE_TAG:-latest}
YML

cat > "$WORK/template" <<'ENV'
ALPHA_IN_TEMPLATE=value
# BRAVO_COMMENTED_OUT=a switch you are meant to leave alone
ENV

if node scripts/check-env-template.mjs "$WORK/compose.yml" "$WORK/template" >"$WORK/out" 2>&1; then
  echo 'FAIL: an undocumented compose variable passed the gate'
  cat "$WORK/out"
  exit 1
fi
grep -q 'CHARLIE_NOWHERE' "$WORK/out" || {
  echo 'FAIL: the undocumented variable was not reported'
  cat "$WORK/out"
  exit 1
}
for quiet in ALPHA_IN_TEMPLATE BRAVO_COMMENTED_OUT IMAGE_TAG; do
  if grep -q "$quiet" "$WORK/out"; then
    echo "FAIL: the gate reported $quiet, which is documented or set by tooling"
    cat "$WORK/out"
    exit 1
  fi
done
echo 'ok: undocumented refused; documented, commented-out and tooling-set left alone'

# A commented-out key must still count, or the gate would demand that every switch the
# template deliberately ships disabled be turned into a live line.
cat > "$WORK/template-full" <<'ENV'
ALPHA_IN_TEMPLATE=value
# BRAVO_COMMENTED_OUT=a switch you are meant to leave alone
CHARLIE_NOWHERE=
ENV
node scripts/check-env-template.mjs "$WORK/compose.yml" "$WORK/template-full" >"$WORK/out2" 2>&1 || {
  echo 'FAIL: a fully documented fixture did not pass'
  cat "$WORK/out2"
  exit 1
}
echo 'ok: a fully documented compose file passes'

if ! node scripts/check-env-template.mjs >"$WORK/real" 2>&1; then
  echo 'FAIL: the real tree does not pass its own env template gate'
  cat "$WORK/real"
  exit 1
fi
echo 'ok: the real tree passes'
