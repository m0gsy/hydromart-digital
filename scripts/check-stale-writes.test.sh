#!/usr/bin/env bash
# Proof that check-stale-writes.mjs can go red — and that it tells a FORM from an ACTION,
# which is the whole rule.
#
#   bash scripts/check-stale-writes.test.sh
#
# Last-write-wins only loses work when there is work to lose. A form carries a record
# somebody typed; "approve", "deactivate", "resolve" carry one decision the server already
# guards by status, and two people tapping the same one produce the same row. A gate that
# demanded a version for every write would flood the console with noise for no gain — and a
# gate that demanded one for none would be the silence this row exists to end.
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

# --- case 1: a new blind FORM write -------------------------------------------
cat > "$FIXTURE" <<'TSX'
export default function ZzStaleWriteFixture() {
  async function save() {
    await api.put(
      endpoints.depots.detail(id),
      { name: name.trim(), address: address.trim(), deliveryFee: fee, active: true },
      true,
    );
  }
  return <button onClick={save}>Simpan</button>;
}
TSX
OUT="$(run)"; RC=$?
if [ "$RC" = "1" ] && echo "$OUT" | grep -q "zz-stale-write-fixture"; then
  ok "a new form write that cannot tell an edit from an overwrite is caught"
else
  bad "a new blind form write was not reported (rc=$RC): $OUT"
fi

# --- case 2: the same form, carrying the version it started from ---------------
cat > "$FIXTURE" <<'TSX'
export default function ZzStaleWriteFixture() {
  async function save() {
    await api.put(
      endpoints.depots.detail(id),
      { name: name.trim(), address: address.trim(), seenUpdatedAt: depot.updatedAt },
      true,
    );
  }
  return <button onClick={save}>Simpan</button>;
}
TSX
OUT="$(run)"; RC=$?
if [ "$RC" = "0" ]; then
  ok "a form that sends back what it was shown is left alone"
else
  bad "a guarded form was reported as a defect (rc=$RC): $OUT"
fi

# --- case 3: a one-tap action is not a form -----------------------------------
cat > "$FIXTURE" <<'TSX'
export default function ZzStaleWriteFixture() {
  async function deactivate() {
    await api.patch(endpoints.depots.detail(id), { active: false }, true);
  }
  async function approve() {
    await api.patch(endpoints.approvals.decide(id), undefined, true);
  }
  return <button onClick={deactivate}>Nonaktifkan</button>;
}
TSX
OUT="$(run)"; RC=$?
if [ "$RC" = "0" ]; then
  ok "a one-tap decision is not asked for a version it has no use for"
else
  bad "an action was reported as a form (rc=$RC): $OUT"
fi

# --- case 4: a payload built elsewhere is still a form ------------------------
# The commonest shape in this console: validate into `parsed.value`, then send it. The
# gate must not read "no object literal here" as "nothing to overwrite".
cat > "$FIXTURE" <<'TSX'
export default function ZzStaleWriteFixture() {
  async function save() {
    const parsed = toDepotPayload(form);
    await api.patch(endpoints.depots.detail(id), parsed.value, true);
  }
  return <button onClick={save}>Simpan</button>;
}
TSX
OUT="$(run)"; RC=$?
if [ "$RC" = "1" ] && echo "$OUT" | grep -q "zz-stale-write-fixture"; then
  ok "a payload assembled elsewhere is still a record, and still caught"
else
  bad "a variable payload slipped past as an action (rc=$RC): $OUT"
fi

# --- case 5: an exemption has to say why --------------------------------------
cat > "$FIXTURE" <<'TSX'
export default function ZzStaleWriteFixture() {
  async function save() {
    // stale-write-ok: a settings STORE keyed by (scope, key) — one value, not a record.
    await api.put(endpoints.settings.put, { scope: 'GLOBAL', key: 'k', value: 1 }, true);
  }
  return <button onClick={save}>Simpan</button>;
}
TSX
OUT="$(run)"; RC=$?
if [ "$RC" = "0" ]; then
  ok "a reasoned exemption is honoured where it is written"
else
  bad "the marker was not read (rc=$RC): $OUT"
fi

# --- case 6: prose promising the fix is not the fix ---------------------------
cat > "$FIXTURE" <<'TSX'
export default function ZzStaleWriteFixture() {
  async function save() {
    // This one still needs seenUpdatedAt — the endpoint returns no updatedAt yet.
    await api.put(
      endpoints.depots.detail(id),
      { name: name.trim(), address: address.trim(), deliveryFee: fee },
      true,
    );
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
  echo "PASS — the gate catches a blind form write, and only that."
  exit 0
fi
echo "FAIL — $fails assertion(s) above."
exit 1
