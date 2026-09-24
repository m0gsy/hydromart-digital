#!/usr/bin/env bash
# The runnable check for the running-but-unhealthy half of scripts/watchdog.sh.
#
#   bash scripts/watchdog.test.sh
#
# The watchdog restarts what STOPPED. A container that stays `running` while failing its
# healthcheck was neither restarted nor reported — a hung `web` (which Prometheus does not
# scrape) would have taken the customer app down with no message anywhere. This drives the
# real script against a fake `docker compose` and a fake `curl`, and shows: nothing on the
# first sighting, one message on the second, silence while it stays unhealthy, and one message
# when it recovers. Nothing is ever restarted for being unhealthy.
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

# A stand-in for `docker compose ... ps --all --format '<template>'`: reads the scenario file.
# Three fields when the template asks for health, two when it does not.
cat > "$WORK/compose" <<'SH'
#!/usr/bin/env bash
case "$*" in
  *'.Health'*) cat "$SCENARIO" ;;
  *) awk '{print $1, $2}' "$SCENARIO" ;;
esac
SH
chmod +x "$WORK/compose"

# A stand-in for curl: records the JSON body the alert would have posted.
mkdir -p "$WORK/bin"
cat > "$WORK/bin/curl" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$SENT"
SH
chmod +x "$WORK/bin/curl"

export SCENARIO="$WORK/scenario" SENT="$WORK/sent"
export COMPOSE="$WORK/compose" STACK_LOCK="$WORK/stack.lock" WATCHDOG_STATE="$WORK/state"
export ALERT_WEBHOOK_URL="http://webhook.invalid/x" PATH="$WORK/bin:$PATH"

run() { bash "$ROOT/scripts/watchdog.sh" > "$WORK/out" 2>&1; RC=$?; }
sent() { [ -f "$SENT" ] && wc -l < "$SENT" | tr -d ' ' || echo 0; }

echo "watchdog (running but unhealthy):"

printf 'auth running healthy\nweb running unhealthy\n' > "$SCENARIO"

run
[ "$RC" = 0 ] && [ "$(sent)" = 0 ] && ok "first sighting: no message (a container may just be starting)" ||
  bad "first run should stay quiet (rc=$RC, sent=$(sent))"
[ "$(cat "$WATCHDOG_STATE" 2>/dev/null)" = "web|0" ] && ok "  ...and it remembers what it saw" ||
  bad "state should be 'web|0', got: $(cat "$WATCHDOG_STATE" 2>/dev/null)"

run
[ "$RC" = 0 ] && [ "$(sent)" = 1 ] && ok "second run, still unhealthy: exactly one message" ||
  bad "second run should send one message (rc=$RC, sent=$(sent))"
grep -q 'UNHEALTHY' "$SENT" && grep -q 'web' "$SENT" && ok "  ...naming the container" || bad "the message should name web: $(cat "$SENT")"

run
[ "$(sent)" = 1 ] && ok "third run, same state: silent (no repeat every five minutes)" || bad "must not repeat (sent=$(sent))"

printf 'auth running healthy\nweb running healthy\n' > "$SCENARIO"
run
[ "$(sent)" = 2 ] && grep -q 'healthy again' "$SENT" && ok "recovery is announced once" || bad "recovery should be announced (sent=$(sent))"
[ ! -e "$WATCHDOG_STATE" ] && ok "  ...and the memory is cleared" || bad "state should be gone after recovery"

run
[ "$(sent)" = 2 ] && ok "a healthy stack stays silent" || bad "healthy run must send nothing (sent=$(sent))"

# A container that never alerted and then cleared says nothing at all.
rm -f "$SENT"
printf 'web running unhealthy\n' > "$SCENARIO"
run
printf 'web running healthy\n' > "$SCENARIO"
run
[ "$(sent)" = 0 ] && ok "a blip that cleared before it was reported is not reported" || bad "blip must stay silent (sent=$(sent))"

# Nothing here may restart anything: no converge, no docker, no compose in the function.
if sed -n '/^health_watch()/,/^}/p' scripts/watchdog.sh | grep -vE '^[[:space:]]*#' |
  grep -qE 'converge|docker (compose )?(up|restart|start|stop|kill)|\$COMPOSE'; then
  bad "health_watch must only report; it can act on containers"
else
  ok "health_watch only reports — it cannot restart anything"
fi

if [ "$fails" -gt 0 ]; then
  echo "watchdog: $fails check(s) failed" >&2
  exit 1
fi
echo "watchdog: all checks passed"
