#!/usr/bin/env bash
# Proof that check-stale-writes.mjs can go red — and that a guarded write is left alone.
#
#   bash scripts/check-stale-writes.test.sh
#
# A ratchet whose count never moves looks identical whether it is measuring something or
# nothing at all. These three cases are the difference.
set -uo pipefail
set +e
cd "$(dirname "$0")/.."

fails=0
ok() { echo "  ok   $1"; }
bad() { echo "  FAIL $1"; fails=$((fails + 1)); }

FIXTURE=apps/web/src/app/hq/zz-stale-write-fixture/page.tsx
mkdir -p "$(dirname "$FIXTURE")"
trap 'rm -rf "$(dirname "$FIXTURE")"' EXIT

run() { node scripts/check-stale-writes.mjs 2>&1; }

# --- case 1: a new blind write ------------------------------------------------
cat > "$FIXTURE" <<'TSX'
export default function ZzStaleWriteFixture() {
  async function save() {
    await api.put(endpoints.admin.security, { idleTimeoutMinutes: 15 }, true);
  }
  return <button onClick={save}>Simpan</button>;
}
TSX
OUT="$(run)"; RC=$?
if [ "$RC" = "1" ] && echo "$OUT" | grep -q "zz-stale-write-fixture"; then
  ok "a new write that cannot tell an edit from an overwrite is caught"
else
  bad "a new blind write was not reported (rc=$RC): $OUT"
fi

# --- case 2: the same write, carrying the version it started from -------------
cat > "$FIXTURE" <<'TSX'
export default function ZzStaleWriteFixture() {
  async function save() {
    await api.put(
      endpoints.admin.security,
      { idleTimeoutMinutes: 15, seenUpdatedAt: policy.updatedAt },
      true,
    );
  }
  return <button onClick={save}>Simpan</button>;
}
TSX
OUT="$(run)"; RC=$?
if [ "$RC" = "0" ]; then
  ok "a write that sends back what it was shown is left alone"
else
  bad "a guarded write was reported as a defect (rc=$RC): $OUT"
fi

# --- case 3: prose naming the field is not the field --------------------------
cat > "$FIXTURE" <<'TSX'
export default function ZzStaleWriteFixture() {
  async function save() {
    // This one still needs seenUpdatedAt — the endpoint returns no updatedAt yet.
    await api.put(endpoints.admin.security, { idleTimeoutMinutes: 15 }, true);
  }
  return <button onClick={save}>Simpan</button>;
}
TSX
OUT="$(run)"; RC=$?
if [ "$RC" = "1" ] && echo "$OUT" | grep -q "zz-stale-write-fixture"; then
  ok "a comment promising the fix does not count as the fix"
else
  bad "a commented-out promise satisfied the gate (rc=$RC): $OUT"
fi

rm -rf "$(dirname "$FIXTURE")"
OUT="$(run)"; RC=$?
if [ "$RC" = "0" ]; then
  ok "the unmodified tree passes its own gate"
else
  bad "the tree does not pass (rc=$RC): $OUT"
fi

echo
if [ "$fails" -eq 0 ]; then
  echo "PASS — the stale-write ratchet catches a new blind write, and only that."
  exit 0
fi
echo "FAIL — $fails assertion(s) above."
exit 1
