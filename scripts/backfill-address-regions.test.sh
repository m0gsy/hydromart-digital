#!/usr/bin/env bash
# The runnable check for scripts/backfill-address-regions.sh (HD-20a). Needs no Docker: a fake
# `docker` on PATH records its argv.
#
#   bash scripts/backfill-address-regions.test.sh
set -uo pipefail
set +e
cd "$(dirname "$0")/.."

fails=0
ok() { echo "  ok   $1"; }
bad() {
  echo "  FAIL $1"
  fails=$((fails + 1))
}
echo "backfill-address-regions:"

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir "$T/bin"
SECRET='postgresql://u:SECRETPW@postgres:5432/db'
cat >"$T/bin/docker" <<'FAKE'
#!/usr/bin/env bash
echo "docker $*" >>"$LOG"
case "$1" in
  ps) printf '%s' "$PS_OUT" ;;
  inspect)
    case "$*" in
      *'.Image}}'*) echo sha256:img ;;
      *Networks*) printf '%b' "${NETS_OUT:-hydromart_default\nother\n}" ;;
      *Config.Env*) printf 'PATH=/bin\nCUSTOMER_DATABASE_URL=%s\nOTHER=x\n' "$SECRET" ;;
    esac ;;
  run)
    # the env file must hold exactly the one line
    for a in "$@"; do [ -f "$a" ] && echo "envfile: $(cat "$a")" >>"$LOG"; done
    cat >/dev/null
    echo "1 alamat berpin tanpa kode wilayah: fake" ;;
esac
FAKE
chmod +x "$T/bin/docker"
export SECRET LOG="$T/log" PS_OUT="hydromart-customer-1"
run() { : >"$LOG"; PATH="$T/bin:$PATH" bash scripts/backfill-address-regions.sh "$@" 2>&1; }

OUT="$(run)"; RC=$?
RUN="$(grep '^docker run' "$LOG")"
[ "$RC" = 0 ] && grep -q -- 'node --input-type=module - --dry-run' <<<"$RUN" && grep -q -- '--network hydromart_default' <<<"$RUN" &&
  grep -q -- '--memory 768m' <<<"$RUN" && grep -q -- '-w /app/packages sha256:img' <<<"$RUN" &&
  ok "a dry run starts a one-off container with --dry-run" || bad "dry run argv wrong: $RUN"
grep -q '^envfile: CUSTOMER_DATABASE_URL=' "$LOG" && ! grep -q '^envfile: .*OTHER' "$LOG" && ok "only the database URL line reaches the one-off container" || bad "the env file is wrong"
grep -q 'docker exec' "$LOG" && bad "it must never docker exec into the live container" || ok "it never docker execs into the live container"
grep -q SECRETPW <<<"$OUT" && bad "the env value leaked into the output" || ok "the env value never appears in the output"
grep -q SECRETPW <<<"$RUN" && bad "the env value is on the docker run argv" || ok "the env value is not on the docker run argv"

OUT="$(run --execute)"
[ "$?" = 2 ] && ! grep -q '^docker' "$LOG" && ok "--execute without CONFIRM exits 2 and calls no docker" || bad "--execute without CONFIRM must exit 2 and run nothing"
OUT="$(CONFIRM=wrong run --execute)"
[ "$?" = 2 ] && ! grep -q '^docker' "$LOG" && ok "a wrong CONFIRM exits 2" || bad "a wrong CONFIRM must exit 2"
OUT="$(CONFIRM=BACKFILL-ADDRESS-REGIONS run --execute)"; RC=$?
RUN="$(grep '^docker run' "$LOG")"
[ "$RC" = 0 ] && grep -q -- 'node --input-type=module -$' <<<"$RUN" && ! grep -q -- '--dry-run' <<<"$RUN" &&
  ok "with CONFIRM it passes no --dry-run" || bad "execute argv wrong: $RUN"
run --bogus >/dev/null
[ "$?" = 2 ] && ok "an unknown argument exits 2" || bad "an unknown argument must exit 2"
NETS_OUT='edge\nhydromart_default\n' run >/dev/null
grep -q -- '--network hydromart_default' "$LOG" && ok "the compose _default network wins over one that sorts first" || bad "network choice wrong: $(grep '^docker run' "$LOG")"
PS_OUT="" run >/dev/null
[ "$?" = 2 ] && ! grep -q '^docker run' "$LOG" && ok "no customer container exits 2" || bad "zero containers must exit 2"
PS_OUT=$'a\nb' run >/dev/null
[ "$?" = 2 ] && ! grep -q '^docker run' "$LOG" && ok "two customer containers exit 2" || bad "two containers must exit 2"

if [ "$fails" -gt 0 ]; then
  echo "backfill-address-regions: $fails check(s) failed" >&2
  exit 1
fi
echo "backfill-address-regions: all checks passed"
