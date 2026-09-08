#!/usr/bin/env bash
# Self-check for check-conflict-markers.mjs.
#
# The gate exists because four PRs merged in quick succession put `<<<<<<<` into two
# dictionaries and two components on `main`, and nothing named it. A gate that never fires
# would have been just as useless, and prints the same green line — so the fixture below
# carries one real marker set and three lookalikes that must NOT be reported.
set -euo pipefail

FIXTURE=apps/web/src/components/zz-conflict-fixture.tsx
DECOY=docs/zz-conflict-decoy.md
OUT=/tmp/conflict-gate.out
cleanup() { rm -f "$FIXTURE" "$DECOY"; }
trap cleanup EXIT

# Lookalikes: a Markdown table rule, prose about shell redirection, and a mid-line `=======`.
cat > "$DECOY" <<'MD'
| Kolom | Nilai |
| ======= | ----- |

Redirect with `cmd >>>>>>> out` and compare `a ======= b` inline.
MD

# `git ls-files` only lists TRACKED files, so the fixtures have to be added to the index.
git add -N "$DECOY"

if ! node scripts/check-conflict-markers.mjs >"$OUT" 2>&1; then
  echo 'FAIL: the gate reported a lookalike as a conflict marker'
  cat "$OUT"
  exit 1
fi
echo 'ok: table rules and prose about redirection are left alone'

printf 'export const zz = {\n<<<<<<< HEAD\n  a: 1,\n=======\n  a: 2,\n>>>>>>> other\n};\n' > "$FIXTURE"
git add -N "$FIXTURE"

if node scripts/check-conflict-markers.mjs >"$OUT" 2>&1; then
  echo 'FAIL: the gate passed a file with an unresolved conflict in it'
  cat "$OUT"
  exit 1
fi
grep -q 'zz-conflict-fixture' "$OUT" || {
  echo 'FAIL: the gate did not name the file it found'
  cat "$OUT"
  exit 1
}
echo 'ok: an unresolved conflict is refused, and named'

cleanup
git rm --cached --quiet "$FIXTURE" "$DECOY" 2>/dev/null || true
if ! node scripts/check-conflict-markers.mjs >"$OUT" 2>&1; then
  echo 'FAIL: the unmodified tree does not pass its own conflict gate'
  cat "$OUT"
  exit 1
fi
echo 'ok: the unmodified tree passes'
