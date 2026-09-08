#!/usr/bin/env bash
# CA-1-49 — a self-check for check-i18n.mjs.
#
# The gate reported "no hardcoded Indonesian copy in apps/web/src" while thirteen real
# strings were on screen, and nothing could tell the difference between a clean tree and a
# blind scanner: both print the same green line. So the fixture below carries one of each
# shape the widened patterns were added for, plus noise that must NOT be reported.
#
# The shapes that used to slip through:
#   - a `description=` / `message=` / `subtitle=` prop (the name list was shorter)
#   - a prop whose value is a template literal (only quoted strings were ever matched)
set -euo pipefail

FIXTURE=apps/web/src/components/zz-i18n-gate-fixture.tsx
OUT=/tmp/i18n-gate.out
cleanup() { rm -f "$FIXTURE"; }
trap cleanup EXIT

cat > "$FIXTURE" <<'TSX'
export function ZzI18nGateFixture({ depot, count }: { depot: string; count: number }) {
  return (
    <div>
      <Panel description="Setiap baris menjadi usulan harga dan menunggu persetujuan." />
      <ErrorState message="Gagal memuat data karyawan" />
      <Header subtitle={`Pencapaian bulan ${depot}`} />
      <Chip label="Draft" />
      <Meter value={count} className="max-w-[1216px]" data-testid="zz-meter" />
    </div>
  );
}
TSX

if node scripts/check-i18n.mjs >"$OUT" 2>&1; then
  echo 'FAIL: the gate passed a file with three hardcoded Indonesian strings in it'
  cat "$OUT"
  exit 1
fi

for expected in 'usulan harga' 'Gagal memuat data karyawan' 'Pencapaian bulan'; do
  grep -q "$expected" "$OUT" || {
    echo "FAIL: the gate did not report \"$expected\""
    cat "$OUT"
    exit 1
  }
done

# A gate that fires on everything is as useless as one that never fires. None of these is
# Indonesian copy: an English word, a Tailwind class, a test id.
for noise in 'Draft' 'max-w-' 'zz-meter'; do
  if grep -q "$noise" "$OUT"; then
    echo "FAIL: the gate reported $noise, which is not Indonesian copy"
    cat "$OUT"
    exit 1
  fi
done
echo 'ok: props and template literals are read, presentation is left alone'

cleanup
if ! node scripts/check-i18n.mjs >"$OUT" 2>&1; then
  echo 'FAIL: the unmodified tree does not pass its own i18n gate'
  cat "$OUT"
  exit 1
fi
echo 'ok: the unmodified tree passes'
