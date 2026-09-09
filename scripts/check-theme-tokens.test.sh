#!/usr/bin/env bash
# Proof that check-theme-tokens.mjs can go red — and, just as importantly, that it stays
# quiet on the two shapes that are correct.
#
#   bash scripts/check-theme-tokens.test.sh
#
# A gate that flagged every raw colour would be worse than no gate: the dark-mode work that
# shipped before this one proved that replacing a fixed red on a `bg-red-50` card makes
# contrast WORSE, because `--danger` is a light red under dark. So the three cases below are
# the three this gate has to tell apart.
set -uo pipefail
set +e
cd "$(dirname "$0")/.."

fails=0
ok() { echo "  ok   $1"; }
bad() { echo "  FAIL $1"; fails=$((fails + 1)); }

FIXTURE=apps/web/src/components/zz-theme-token-fixture.tsx
trap 'rm -f "$FIXTURE"' EXIT

run() { node scripts/check-theme-tokens.mjs 2>&1; }

# --- case 1: ink on a themed surface — the defect this exists for -------------
cat > "$FIXTURE" <<'TSX'
export function ZzThemeFixture() {
  return <p className="text-sm text-red-600">Gagal memuat</p>;
}
TSX
OUT="$(run)"; RC=$?
if [ "$RC" = "1" ] && echo "$OUT" | grep -q "zz-theme-token-fixture"; then
  ok "ink on a themed surface is caught"
else
  bad "a raw text colour on a themed surface was not reported (rc=$RC): $OUT"
fi

# --- case 2: the same ink on a ground that is light in BOTH themes ------------
cat > "$FIXTURE" <<'TSX'
export function ZzThemeFixture() {
  return (
    <div className="rounded-lg bg-red-50 p-3">
      <p className="text-sm text-red-600">Gagal memuat</p>
    </div>
  );
}
TSX
# Note the class sits on its own line here, so the gate sees no fixed ground on THAT line —
# which is the honest limit of a line-scoped check, and why the fixture below puts them
# together the way the real sites do.
cat > "$FIXTURE" <<'TSX'
export function ZzThemeFixture() {
  return <p className="bg-red-50 p-3 text-sm text-red-600">Gagal memuat</p>;
}
TSX
OUT="$(run)"; RC=$?
if [ "$RC" = "0" ]; then
  ok "the same ink on an always-light card is left alone"
else
  bad "a correct fixed colour was reported as a defect (rc=$RC): $OUT"
fi

# --- case 3: a saturated swatch is not ink -----------------------------------
cat > "$FIXTURE" <<'TSX'
export function ZzThemeFixture() {
  return <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />;
}
TSX
OUT="$(run)"; RC=$?
if [ "$RC" = "0" ]; then
  ok "a status dot keeps its saturated colour"
else
  bad "a solid swatch was reported (rc=$RC): $OUT"
fi

# --- case 4: prose naming a class is not markup using it ---------------------
cat > "$FIXTURE" <<'TSX'
// This component used to use text-red-600, which is exactly what we removed.
export function ZzThemeFixture() {
  return <p className="text-[color:var(--danger)]">Gagal memuat</p>;
}
TSX
OUT="$(run)"; RC=$?
if [ "$RC" = "0" ]; then
  ok "a comment explaining the fix is not counted as the defect"
else
  bad "the gate flagged its own explanation (rc=$RC): $OUT"
fi

rm -f "$FIXTURE"
OUT="$(run)"; RC=$?
if [ "$RC" = "0" ]; then
  ok "the unmodified tree passes its own gate"
else
  bad "the tree does not pass (rc=$RC): $OUT"
fi

echo
if [ "$fails" -eq 0 ]; then
  echo "PASS — the theme-token gate catches ink on a themed ground, and only that."
  exit 0
fi
echo "FAIL — $fails assertion(s) above."
exit 1
