#!/usr/bin/env bash
# Self-check for check-money-literals.mjs. Two ways this gate could be useless — never
# firing, or firing on everything — and both look identical in a green CI run, so the
# fixture below carries one of each: two numbers that ARE business rules, and four that are
# not (a poll interval, a Tailwind width, an input placeholder, a percent conversion).
set -euo pipefail

FIXTURE=apps/web/src/components/zz-money-gate-fixture.tsx
cleanup() { rm -f "$FIXTURE"; }
trap cleanup EXIT

cat > "$FIXTURE" <<'TSX'
export function ZzMoneyGateFixture({ total, onTimeRate }: { total: number; onTimeRate: number }) {
  const discounted = total * 0.05;
  const poll = 15_000;
  const pct = Math.round(onTimeRate * 100);
  return (
    <div className="mx-auto max-w-[1216px]" data-poll={poll} data-pct={pct}>
      <p>Setoran galon Rp20.000 per tabung.</p>
      <input placeholder="20000" />
      <span>{discounted}</span>
    </div>
  );
}
TSX

if node scripts/check-money-literals.mjs >/tmp/money-gate.out 2>&1; then
  echo 'FAIL: a rate literal and rupiah in copy both passed the gate'
  cat /tmp/money-gate.out
  exit 1
fi
grep -q 'total \* 0.05' /tmp/money-gate.out || {
  echo 'FAIL: the discount rate was not reported'
  cat /tmp/money-gate.out
  exit 1
}
grep -q 'Rp20.000' /tmp/money-gate.out || {
  echo 'FAIL: rupiah written into copy was not reported'
  cat /tmp/money-gate.out
  exit 1
}
for noise in '15_000' 'max-w-\[1216px\]' 'placeholder' '\* 100'; do
  if grep -q "$noise" /tmp/money-gate.out; then
    echo "FAIL: the gate reported $noise, which is not a business rule"
    cat /tmp/money-gate.out
    exit 1
  fi
done
echo 'ok: business numbers refused, presentation left alone'

cleanup
if ! node scripts/check-money-literals.mjs >/tmp/money-gate.out 2>&1; then
  echo 'FAIL: the unmodified tree does not pass its own money gate'
  cat /tmp/money-gate.out
  exit 1
fi
echo 'ok: the unmodified tree passes'
