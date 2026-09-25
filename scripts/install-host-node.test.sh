#!/usr/bin/env bash
# The runnable check for scripts/install-host-node.sh.
#
#   bash scripts/install-host-node.test.sh
#
# That script edits an apt source file and reinstalls the runtime the nightly backup depends on,
# on the one box there is. It is exercised here against stand-ins for node, sudo, apt-get and
# dpkg-query, with the "repo file" a temporary file, so the refusals, the happy path and — above
# all — the ROLLBACK are proven before it is ever pressed on production.
set -uo pipefail
# CI invokes this as `bash -e file`; assertions below drive commands that exit non-zero on purpose.
set +e
cd "$(dirname "$0")/.."
ROOT="$PWD"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fails=0
ok() { echo "  ok   $1"; }
bad() {
  echo "  FAIL $1"
  fails=$((fails + 1))
}

mkdir -p "$WORK/bin"
export STATE="$WORK/state" CALLS="$WORK/calls" NODESOURCE_LIST="$WORK/nodesource.list"
export PATH="$WORK/bin:$PATH" SUDO="$WORK/bin/fakesudo"

# node reports whatever major the "installed package" currently is.
cat > "$WORK/bin/node" <<'SH'
#!/usr/bin/env bash
m="$(cat "$STATE/major" 2>/dev/null || echo 20)"
case "$1" in
  -v) echo "v$m.20.2" ;;
  -p) echo "$m" ;;
esac
SH
cat > "$WORK/bin/npm" <<'SH'
#!/usr/bin/env bash
echo 10.9.0
SH
cat > "$WORK/bin/dpkg-query" <<'SH'
#!/usr/bin/env bash
echo "20.20.2-1nodesource1"
SH
# sudo stand-in: runs the command directly (the files it touches are all under $WORK).
cat > "$WORK/bin/fakesudo" <<'SH'
#!/usr/bin/env bash
[ "${NO_SUDO:-}" = 1 ] && [ "$1" = true ] && exit 1
exec "$@"
SH
# apt-get stand-in: `install nodejs` installs whatever major the repo file names; a pinned
# `nodejs=<version>` is the downgrade and installs 20. FAIL_INSTALL / STUCK simulate the two ways it goes wrong.
cat > "$WORK/bin/apt-get" <<'SH'
#!/usr/bin/env bash
echo "apt-get $*" >> "$CALLS"
case "$*" in
  *update*) [ "${FAIL_UPDATE:-}" = 1 ] && exit 1; exit 0 ;;
  *"nodejs="*) echo 20 > "$STATE/major"; exit 0 ;;
  *install*)
    [ "${FAIL_INSTALL:-}" = 1 ] && exit 1
    [ "${STUCK:-}" = 1 ] && exit 0
    grep -oE 'node_[0-9]+' "$NODESOURCE_LIST" | head -1 | sed 's/node_//' > "$STATE/major"
    exit 0 ;;
esac
SH
chmod +x "$WORK"/bin/*

reset() {
  rm -f "$CALLS"
  mkdir -p "$STATE"
  echo 20 > "$STATE/major"
  echo 'deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main' > "$NODESOURCE_LIST"
  unset NO_SUDO FAIL_UPDATE FAIL_INSTALL STUCK
}
run() { bash "$ROOT/scripts/install-host-node.sh" "$@" > "$WORK/out" 2>&1; RC=$?; }
apt_calls() { [ -f "$CALLS" ] && wc -l < "$CALLS" | tr -d ' ' || echo 0; }
list_says() { grep -q "$1" "$NODESOURCE_LIST"; }

echo "host node upgrade:"

reset
run --check
[ "$RC" = 0 ] && [ "$(apt_calls)" = 0 ] && list_says node_20 && grep -q 'would change' "$WORK/out" && ok "--check: says what it would do, edits nothing, never calls apt" || bad "--check must change nothing (rc=$RC)"

reset
rm -f "$NODESOURCE_LIST"
printf 'Types: deb
URIs: https://deb.nodesource.com/node_20.x
Suites: nodistro
' > "$WORK/nodesource.sources"
NODESOURCE_LIST="$WORK/nodesource.sources" run
[ "$RC" = 0 ] && grep -q 'node_22.x' "$WORK/nodesource.sources" && ok "the newer deb822 nodesource.sources file is upgraded the same way" || bad "a .sources file must work too (rc=$RC): $(cat "$WORK/out")"

reset
echo 22 > "$STATE/major"
run
[ "$RC" = 0 ] && [ "$(apt_calls)" = 0 ] && ok "already on 22: exit 0 and apt is never touched" || bad "an up-to-date host must be a no-op (rc=$RC, apt=$(apt_calls))"

reset
rm -f "$NODESOURCE_LIST"
run
[ "$RC" = 2 ] && [ "$(apt_calls)" = 0 ] && ok "node not from NodeSource (no repo file): refuses, changes nothing" || bad "must refuse without the repo file (rc=$RC)"

reset
echo 'deb http://archive.ubuntu.com/ubuntu jammy universe' > "$NODESOURCE_LIST"
run
[ "$RC" = 2 ] && list_says jammy && [ "$(apt_calls)" = 0 ] && ok "a repo file with no node_<major>.x line: refuses and leaves it alone" || bad "must not edit an unrecognised repo file (rc=$RC)"

reset
NO_SUDO=1 run
[ "$RC" = 2 ] && list_says node_20 && ok "no passwordless sudo: refuses before editing anything" || bad "must refuse without sudo (rc=$RC)"

reset
run
[ "$RC" = 0 ] && list_says node_22 && [ "$(cat "$STATE/major")" = 22 ] && grep -q 'host node is now v22' "$WORK/out" &&
  ok "20 -> 22: the repo line says node_22.x, the package installed, node reports 22" || bad "the upgrade did not land (rc=$RC): $(cat "$WORK/out")"

reset
FAIL_INSTALL=1 run
[ "$RC" = 1 ] && list_says node_20 && grep -q 'nodejs=20.20.2-1nodesource1' "$CALLS" && ok "install fails: the old repo line is restored and the old version reinstalled" || bad "a failed install must roll back (rc=$RC)"

reset
FAIL_UPDATE=1 run
[ "$RC" = 1 ] && list_says node_20 && ok "apt update fails: the old repo line is restored" || bad "a failed update must roll back (rc=$RC)"

reset
STUCK=1 run
[ "$RC" = 1 ] && list_says node_20 && [ "$(cat "$STATE/major")" = 20 ] && ok "install 'succeeds' but node is still 20: rolled back, not reported as done" || bad "a no-op install must not read as success (rc=$RC)"

[ "$fails" -eq 0 ] && echo "host node upgrade: all checks passed" || {
  echo "host node upgrade: $fails check(s) failed"
  exit 1
}
