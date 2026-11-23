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

# HD-9b: a stand-in for docker itself, for the AI web half. It reads $AI_SCENARIO
# (`<id> <service> <state> <health> <oneoff>` per container of project hydromart-ai), logs every
# call to $DOCKER_LOG, and refuses `start` for the ids in $START_FAIL.
cat > "$WORK/bin/docker" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$DOCKER_LOG"
case "$1" in
  ps) [ -f "$AI_SCENARIO" ] && awk '{print $1}' "$AI_SCENARIO" ;;
  inspect) awk -v id="${*: -1}" '$1 == id {print $2, $3, $4, $5}' "$AI_SCENARIO" ;;
  start) case " ${START_FAIL:-} " in *" $2 "*) exit 1 ;; esac ;;
esac
exit 0
SH
chmod +x "$WORK/bin/docker"

export SCENARIO="$WORK/scenario" SENT="$WORK/sent"
export COMPOSE="$WORK/compose" STACK_LOCK="$WORK/stack.lock" WATCHDOG_STATE="$WORK/state"
export ALERT_WEBHOOK_URL="http://webhook.invalid/x" PATH="$WORK/bin:$PATH"
export AI_SCENARIO="$WORK/ai-scenario" DOCKER_LOG="$WORK/docker.log" WATCHDOG_AIWEB_STATE="$WORK/ai-state"
: > "$AI_SCENARIO"

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

echo "watchdog (the AI web, HD-9b):"
printf 'auth running healthy\nweb running healthy\n' > "$SCENARIO"
rm -f "$SENT"
ai() { printf '%s\n' "$@" > "$AI_SCENARIO"; : > "$DOCKER_LOG"; }

# The app stopped; the database runs; a finished one-shot migration sits exited, as it should, and
# so does a migrate container `up --profile migrate` would leave (not a one-off, same service).
ai 'd1 db running healthy False' 'a1 aiweb exited none False' 'm1 migrate exited none True' 'm2 migrate exited none False'
run
grep -qx 'start a1' "$DOCKER_LOG" && ok "a stopped aiweb is started again (docker start, the same container)" ||
  bad "aiweb was not started: $(tr '\n' ';' < "$DOCKER_LOG")"
grep -qE '^start m[12]' "$DOCKER_LOG" && bad "a migration container was started" || ok "the migration job is never touched, one-off or not"
grep -q '^start d1' "$DOCKER_LOG" && bad "a running database was started again" || ok "a running database is left alone"
grep -q 'started stopped AI web containers again: aiweb' "$SENT" && ok "  ...and says so once" || bad "no message for the AI web restart: $(cat "$SENT" 2>/dev/null)"
[ "$RC" = 0 ] && ok "  ...and hydromart's half still runs to its end (exit 0)" || bad "the AI web half changed hydromart's exit ($RC)"

# Both stopped: the database first, then the app that needs it.
ai 'a1 aiweb exited none False' 'd1 db exited none False'
run
[ "$(grep '^start' "$DOCKER_LOG" | tr '\n' ' ')" = "start d1 start a1 " ] && ok "both stopped: db is started before aiweb" ||
  bad "start order: $(grep '^start' "$DOCKER_LOG" | tr '\n' ' ')"

# A container that will not start is said, not retried in silence.
rm -f "$SENT"
ai 'd1 db running healthy False' 'a1 aiweb exited none False'
START_FAIL=a1 run
grep -q 'would not start again: aiweb' "$SENT" && ok "a container that would not start is reported" || bad "a failed start went unreported: $(cat "$SENT" 2>/dev/null)"

# Never a pull, never compose, never anything that changes an image or makes a container.
if grep -qE '^(pull|compose|image|rmi|run|create|rm|load|tag)( |$)|^(container (create|rm))' "$DOCKER_LOG"; then
  bad "the AI web half changed images or containers: $(grep -E '^(pull|compose|image|rmi|run|create|rm)' "$DOCKER_LOG" | head -2)"
else
  ok "only ps, inspect and start: no pull, no compose up, no image change"
fi

# Running but unhealthy: reported on the second sighting, once; recovery said once.
rm -f "$SENT" "$WATCHDOG_AIWEB_STATE"
ai 'd1 db running healthy False' 'a1 aiweb running unhealthy False'
run
[ ! -s "$SENT" ] && ok "unhealthy aiweb, first sighting: quiet" || bad "first sighting spoke: $(cat "$SENT")"
run
grep -q 'AI web containers running but UNHEALTHY for 5+ minutes: aiweb' "$SENT" && ok "second sighting: one message naming aiweb" ||
  bad "no unhealthy message: $(cat "$SENT" 2>/dev/null)"
run
[ "$(grep -c 'UNHEALTHY' "$SENT")" = 1 ] && ok "third sighting: no repeat" || bad "repeated the unhealthy message"
grep -q '^start' "$DOCKER_LOG" && bad "an unhealthy container was restarted" || ok "unhealthy is reported, never restarted"
ai 'd1 db running healthy False' 'a1 aiweb running healthy False'
run
grep -q 'AI web containers healthy again: aiweb' "$SENT" && ok "recovery is said once" || bad "recovery unsaid: $(cat "$SENT")"

# No AI web on this box: nothing to do and nothing said.
rm -f "$SENT"
ai
: > "$AI_SCENARIO"
run
[ ! -s "$SENT" ] && ! grep -q '^start' "$DOCKER_LOG" && ok "no AI web container here: silent" || bad "an absent AI web made noise"

# The stack lock: a deploy in progress means hands off, the AI web included.
lock_line="$(grep -n 'if ! stack_lock 0' scripts/watchdog.sh | cut -d: -f1)"
ai_line="$(grep -n '^aiweb_watch ||' scripts/watchdog.sh | cut -d: -f1)"
[ -n "$lock_line" ] && [ -n "$ai_line" ] && [ "$lock_line" -lt "$ai_line" ] &&
  ok "the AI web half runs only after the stack lock is taken" || bad "aiweb_watch must run after stack_lock (lock $lock_line, call $ai_line)"
if command -v flock >/dev/null 2>&1; then
  ai 'd1 db running healthy False' 'a1 aiweb exited none False'
  ( flock 9; run; echo "$RC" > "$WORK/locked-rc" ) 9>>"$STACK_LOCK"
  grep -q '^start' "$DOCKER_LOG" && bad "it started an AI web container while a deploy held the lock" ||
    ok "while a deploy holds the lock: no AI web container is touched"
else
  echo "  skip the lock held by a deploy: no flock here (it runs on CI)"
fi

if [ "$fails" -gt 0 ]; then
  echo "watchdog: $fails check(s) failed" >&2
  exit 1
fi
echo "watchdog: all checks passed"
