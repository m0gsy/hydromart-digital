#!/usr/bin/env bash
# The runnable check for scripts/install-host-docker-daemon.sh.
#
#   bash scripts/install-host-docker-daemon.test.sh
#
# That script restarts the Docker daemon on the one production box there is. It is exercised
# here against a stand-in `docker` and `sudo`, with the "live daemon.json" a temporary file, so
# the refusals, the happy path and the rollback on a failed restart are proven before it is ever
# pressed for real.
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

mkdir -p "$WORK/bin" "$WORK/etc"
export STATE="$WORK/state" CALLS="$WORK/calls"
export DAEMON_JSON_SRC="$WORK/repo-daemon.json" DAEMON_JSON_DEST="$WORK/etc/daemon.json"
export PATH="$WORK/bin:$PATH" SUDO="$WORK/bin/fakesudo" PROBE_CONTAINER="test-gateway"

cat > "$WORK/repo-daemon.json" <<'JSON'
{
  "live-restore": true,
  "log-driver": "json-file",
  "log-opts": { "max-size": "50m", "max-file": "3" }
}
JSON

# sudo stand-in: runs the command directly (everything it touches is under $WORK). Whether the
# restart itself fails is the systemctl stub's job, below.
cat > "$WORK/bin/fakesudo" <<'SH'
#!/usr/bin/env bash
[ "${NO_SUDO:-}" = 1 ] && [ "$1" = true ] && exit 1
echo "sudo $*" >> "$CALLS"
exec "$@"
SH
# docker stand-in: `info` answers "up" unless DOWN is set; `inspect` reports whatever log-opts
# the fixture says the probe container currently has.
cat > "$WORK/bin/docker" <<'SH'
#!/usr/bin/env bash
case "$1" in
  info) [ "${DOWN:-}" = 1 ] && exit 1; exit 0 ;;
  inspect) cat "$STATE/opts" 2>/dev/null || echo '{}' ;;
esac
SH
# systemctl stand-in: this host has no systemd at all — only `restart docker` is ever called.
cat > "$WORK/bin/systemctl" <<'SH'
#!/usr/bin/env bash
[ "$1" = restart ] && [ "$2" = docker ] || exit 0
[ "${FAIL_RESTART:-}" = 1 ] && exit 1
exit 0
SH
chmod +x "$WORK"/bin/*

reset() {
  rm -f "$CALLS"
  mkdir -p "$STATE"
  echo '{"max-size":"10m","max-file":"1"}' > "$STATE/opts"
  rm -f "$DAEMON_JSON_DEST"
  unset NO_SUDO FAIL_RESTART DOWN
}
run() { bash "$ROOT/scripts/install-host-docker-daemon.sh" "$@" > "$WORK/out" 2>&1; RC=$?; }
sudo_calls() { [ -f "$CALLS" ] && wc -l < "$CALLS" | tr -d ' ' || echo 0; }

echo "host docker daemon.json:"

reset
run --check
[ "$RC" = 0 ] && [ "$(sudo_calls)" = 0 ] && grep -q 'MISSING' "$WORK/out" && grep -q 'ONE-TIME exception' "$WORK/out" &&
  ok "--check on a box with no daemon.json: says the restart is the one-time uncovered one, changes nothing" ||
  bad "--check (missing file) must warn and change nothing (rc=$RC): $(cat "$WORK/out")"

reset
echo '{"live-restore":false}' > "$DAEMON_JSON_DEST"
run --check
[ "$RC" = 0 ] && [ "$(sudo_calls)" = 0 ] && grep -q 'does not have live-restore on' "$WORK/out" &&
  ok "--check with live-restore off: names the same one-time exception, changes nothing" ||
  bad "--check (live-restore off) must warn (rc=$RC): $(cat "$WORK/out")"

reset
cp "$DAEMON_JSON_SRC" "$DAEMON_JSON_DEST"
run --check
[ "$RC" = 0 ] && [ "$(sudo_calls)" = 0 ] && grep -q 'already on — restarting Docker will not stop' "$WORK/out" &&
  ok "--check with live-restore already on: says a restart is safe, still changes nothing" ||
  bad "--check (live-restore on) must say the restart is safe (rc=$RC): $(cat "$WORK/out")"

reset
cp "$DAEMON_JSON_SRC" "$DAEMON_JSON_DEST"
echo '{"max-size":"50m","max-file":"3"}' > "$STATE/opts"
run --check
[ "$RC" = 0 ] && [ "$(sudo_calls)" = 0 ] && grep -q 'Nothing to do' "$WORK/out" &&
  ok "already fully installed and already carried by a container: exits clean, touches nothing" ||
  bad "an already-correct box must be a no-op (rc=$RC): $(cat "$WORK/out")"

reset
NO_SUDO=1 run
[ "$RC" = 2 ] && [ ! -f "$DAEMON_JSON_DEST" ] && ok "no passwordless sudo: refuses before installing anything" ||
  bad "must refuse without sudo (rc=$RC)"

reset
run
[ "$RC" = 0 ] && diff -q "$DAEMON_JSON_SRC" "$DAEMON_JSON_DEST" >/dev/null 2>&1 &&
  grep -q 'sudo systemctl restart docker' "$CALLS" && grep -q 'docker restarted and is answering' "$WORK/out" &&
  ok "installs the file and restarts the daemon" || bad "the install did not land (rc=$RC): $(cat "$WORK/out")"

reset
echo "old config" > "$DAEMON_JSON_DEST"
run
[ "$RC" = 0 ] && ls "$WORK/etc"/daemon.json.bak.* >/dev/null 2>&1 &&
  ok "backs up an existing daemon.json before overwriting it" || bad "must keep a backup of the old file (rc=$RC)"

reset
echo "old config" > "$DAEMON_JSON_DEST"
FAIL_RESTART=1 run
[ "$RC" = 1 ] && grep -q 'restoring the previous' "$WORK/out" && [ "$(cat "$DAEMON_JSON_DEST")" = "old config" ] &&
  ok "a failed restart rolls the file back and says so" ||
  bad "a failed restart must roll back (rc=$RC): $(cat "$WORK/out")"

reset
DOWN=1 run
[ "$RC" = 1 ] && grep -q 'did not answer again within' "$WORK/out" &&
  ok "docker never comes back up: reported as a failure, not a success" ||
  bad "a daemon that never answers again must not read as success (rc=$RC): $(cat "$WORK/out")"

reset
echo 'not json' > "$DAEMON_JSON_SRC"
run --check
[ "$RC" = 2 ] && [ "$(sudo_calls)" = 0 ] && ok "a malformed repo file is refused before it can reach systemctl" ||
  bad "must refuse invalid JSON (rc=$RC)"

[ "$fails" -eq 0 ] && echo "host docker daemon.json: all checks passed" || {
  echo "host docker daemon.json: $fails check(s) failed"
  exit 1
}
