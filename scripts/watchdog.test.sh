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
echo compose >> "$ORDER_LOG"
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
echo docker >> "$ORDER_LOG"
printf '%s\n' "$*" >> "$DOCKER_LOG"
case "$1" in
  ps) [ -f "$AI_SCENARIO" ] && awk '{print $1}' "$AI_SCENARIO" ;;
  inspect) awk -v id="${*: -1}" '$1 == id {print $2, $3, $4, $5}' "$AI_SCENARIO" ;;
  start) case " ${START_FAIL:-} " in *" $2 "*) exit 1 ;; esac ;;
esac
exit 0
SH
chmod +x "$WORK/bin/docker"

# And for timeout: records how the AI web half is bounded, then runs it; with TIMEOUT_EXPIRES set
# it stands for a half that ran past its limit (exit 124, the half never finished).
cat > "$WORK/bin/timeout" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$TIMEOUT_LOG"
[ -n "${TIMEOUT_EXPIRES:-}" ] && exit 124
shift
exec "$@"
SH
chmod +x "$WORK/bin/timeout"

export SCENARIO="$WORK/scenario" SENT="$WORK/sent"
export COMPOSE="$WORK/compose" STACK_LOCK="$WORK/stack.lock" WATCHDOG_STATE="$WORK/state"
export ALERT_WEBHOOK_URL="http://webhook.invalid/x" PATH="$WORK/bin:$PATH"
export AI_SCENARIO="$WORK/ai-scenario" DOCKER_LOG="$WORK/docker.log" WATCHDOG_AIWEB_STATE="$WORK/ai-state"
export ALERT_MEMORY_DIR="$WORK/alerted" TIMEOUT_LOG="$WORK/timeout.log" ORDER_LOG="$WORK/order.log"
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
said() { if [ -f "$SENT" ]; then grep -c -- "$1" "$SENT"; else echo 0; fi; }

# The app stopped; the database runs; a finished one-shot migration sits exited, as it should, and
# so does a migrate container `up --profile migrate` would leave (not a one-off, same service).
ai 'd1 db running healthy False' 'a1 aiweb exited none False' 'm1 migrate exited none True' 'm2 migrate exited none False'
run
grep -qx 'start a1' "$DOCKER_LOG" && ok "a stopped (exited) aiweb is started again (docker start, the same container)" ||
  bad "aiweb was not started: $(tr '\n' ';' < "$DOCKER_LOG")"
grep -qE '^start m[12]' "$DOCKER_LOG" && bad "a migration container was started" || ok "the migration job is never touched, one-off or not"
grep -q '^start d1' "$DOCKER_LOG" && bad "a running database was started again" || ok "a running database is left alone"
grep -q 'started stopped AI web containers again: aiweb' "$SENT" && ok "  ...and says so once" || bad "no message for the AI web restart: $(cat "$SENT" 2>/dev/null)"
[ "$RC" = 0 ] && ok "  ...and hydromart's exit is still its own (0)" || bad "the AI web half changed hydromart's exit ($RC)"

# Both stopped: the database first, then the app that needs it. `created` (never started) counts.
ai 'a1 aiweb exited none False' 'd1 db created none False'
run
[ "$(grep '^start' "$DOCKER_LOG" | tr '\n' ' ')" = "start d1 start a1 " ] && ok "a created db and an exited aiweb: db is started first" ||
  bad "start order: $(grep '^start' "$DOCKER_LOG" | tr '\n' ' ')"

# A crash loop is `restarting`: Docker is already retrying it, and a start would succeed and
# change nothing, so it used to say "started again" every five minutes for ever.
rm -f "$SENT" "$WATCHDOG_AIWEB_STATE"
rm -rf "$ALERT_MEMORY_DIR"
ai 'd1 db running healthy False' 'a1 aiweb restarting none False'
run
[ "$(said 'aiweb has been restarting')" = 0 ] && ok "restarting, first sighting: quiet" || bad "a first sighting of restarting spoke: $(cat "$SENT")"
run
grep -q '^start' "$DOCKER_LOG" && bad "a restarting container was started" || ok "  ...never started"
[ "$(said 'aiweb has been restarting for 5+ minutes')" = 1 ] && ok "  ...and said once over two runs (the second sighting)" ||
  bad "restarting should be said once over two runs: $(cat "$SENT" 2>/dev/null)"
run
[ "$(said 'aiweb has been restarting')" = 1 ] && ok "  ...and not again while it goes on" || bad "a crash loop was reported again"
grep -q 'started stopped AI web containers again' "$SENT" && bad "a restarting container was called started again" ||
  ok "  ...and never called started again"
# A run that catches it between two restarts (`starting`, no verdict yet) resets the sightings;
# restarting on the next two runs is still the same crash loop, and is not said again.
ai 'd1 db running healthy False' 'a1 aiweb running starting False'
run
ai 'd1 db running healthy False' 'a1 aiweb restarting none False'
run
run
[ "$(said 'aiweb has been restarting')" = 1 ] && ok "  ...even when a run in between catches it starting" ||
  bad "a crash loop caught between two restarts was reported again: $(cat "$SENT")"

ai 'd1 db running healthy False' 'a1 aiweb paused none False'
run
grep -q '^start' "$DOCKER_LOG" && bad "a paused container was started" || ok "paused: never started (a start would fail every run)"
ai 'd1 db dead none False' 'a1 aiweb removing none False'
run
grep -q '^start' "$DOCKER_LOG" && bad "a dead or removing container was started" || ok "dead and removing: never started"

# Back to healthy: said once, and the memory goes, so the next failure speaks at once.
rm -f "$SENT"
ai 'd1 db running healthy False' 'a1 aiweb running healthy False'
run
grep -q 'AI web containers healthy again: aiweb' "$SENT" && [ ! -e "$ALERT_MEMORY_DIR/aiweb-watch-aiweb" ] &&
  ok "both healthy: 'healthy again' said and the memory cleared" || bad "recovery: $(cat "$SENT" 2>/dev/null)"
run
[ "$(said 'healthy again')" = 1 ] && ok "  ...once" || bad "'healthy again' repeated"

# A container that will not start is said once, not every five minutes, and again after a recovery.
rm -f "$SENT"
ai 'd1 db running healthy False' 'a1 aiweb exited none False'
START_FAIL=a1 run
START_FAIL=a1 run
[ "$(said 'would not start again: aiweb')" = 1 ] && ok "a container that would not start: said once over two runs" ||
  bad "a failed start should be said once: $(cat "$SENT" 2>/dev/null)"
ai 'd1 db running healthy False' 'a1 aiweb running healthy False'
run
ai 'd1 db running healthy False' 'a1 aiweb exited none False'
START_FAIL=a1 run
[ "$(said 'would not start again: aiweb')" = 2 ] && ok "  ...and said again when it fails after running healthy" ||
  bad "a new failure after recovery stayed silent: $(cat "$SENT" 2>/dev/null)"

# Never a pull, never compose, never anything that changes an image or makes a container.
if grep -qE '^(pull|compose|image|rmi|run|create|rm|load|tag)( |$)|^(container (create|rm))' "$DOCKER_LOG"; then
  bad "the AI web half changed images or containers: $(grep -E '^(pull|compose|image|rmi|run|create|rm)' "$DOCKER_LOG" | head -2)"
else
  ok "only ps, inspect and start: no pull, no compose up, no image change"
fi

# Running but unhealthy: reported on the second sighting, once; recovery said once.
rm -f "$SENT" "$WATCHDOG_AIWEB_STATE"
rm -rf "$ALERT_MEMORY_DIR"
ai 'd1 db running healthy False' 'a1 aiweb running unhealthy False'
run
[ ! -s "$SENT" ] && ok "unhealthy aiweb, first sighting: quiet" || bad "first sighting spoke: $(cat "$SENT")"
run
grep -q 'AI web container aiweb has been unhealthy for 5+ minutes' "$SENT" && ok "second sighting: one message naming aiweb" ||
  bad "no unhealthy message: $(cat "$SENT" 2>/dev/null)"
run
[ "$(said 'has been unhealthy')" = 1 ] && ok "third sighting: no repeat" || bad "repeated the unhealthy message"
grep -q '^start' "$DOCKER_LOG" && bad "an unhealthy container was restarted" || ok "unhealthy is reported, never restarted"
ai 'd1 db running healthy False' 'a1 aiweb running healthy False'
run
grep -q 'AI web containers healthy again: aiweb' "$SENT" && ok "recovery is said once" || bad "recovery unsaid: $(cat "$SENT")"

# AI-5: n8n is the AI web's third long-running service. Started again when it stopped (after its
# database), reported when unhealthy and never restarted for it; its one-shot setup never touched.
rm -f "$SENT" "$WATCHDOG_AIWEB_STATE"
rm -rf "$ALERT_MEMORY_DIR"
ai 'n1 n8n exited none False' 'd1 db created none False' 'a1 aiweb running healthy False' \
  's1 n8n-setup exited none True' 's2 n8n-setup exited none False'
run
[ "$(grep '^start' "$DOCKER_LOG" | tr '\n' ' ')" = "start d1 start n1 " ] && ok "an exited n8n is started again, after its database" ||
  bad "n8n start: $(grep '^start' "$DOCKER_LOG" | tr '\n' ' ')"
grep -qE '^start s[12]' "$DOCKER_LOG" && bad "n8n's setup job was started" || ok "n8n-setup is never started, one-off or not"
grep -q 'started stopped AI web containers again: db n8n' "$SENT" && ok "  ...and says so once" ||
  bad "no message for the n8n restart: $(cat "$SENT" 2>/dev/null)"
rm -f "$SENT"
ai 'd1 db running healthy False' 'a1 aiweb running healthy False' 'n1 n8n running unhealthy False'
run
run
grep -q 'AI web container n8n has been unhealthy for 5+ minutes' "$SENT" && ok "an unhealthy n8n is said on the second sighting" ||
  bad "no unhealthy message for n8n: $(cat "$SENT" 2>/dev/null)"
grep -q '^start' "$DOCKER_LOG" && bad "an unhealthy n8n was restarted" || ok "  ...and never restarted for it"
ai 'd1 db running healthy False' 'a1 aiweb running healthy False' 'n1 n8n running starting False'
run
[ -e "$ALERT_MEMORY_DIR/aiweb-watch-n8n" ] && ! grep -q 'healthy again' "$SENT" &&
  ok "n8n still starting: nothing is called healthy again yet" || bad "a starting n8n was called healthy: $(cat "$SENT")"
ai 'd1 db running healthy False' 'a1 aiweb running healthy False' 'n1 n8n running healthy False'
run
grep -q 'AI web containers healthy again: n8n' "$SENT" && [ ! -e "$ALERT_MEMORY_DIR/aiweb-watch-n8n" ] &&
  ok "n8n healthy again: said once, and forgotten" || bad "n8n recovery: $(cat "$SENT" 2>/dev/null)"

# No AI web on this box: nothing to do and nothing said.
rm -f "$SENT"
ai
: > "$AI_SCENARIO"
run
[ ! -s "$SENT" ] && ! grep -q '^start' "$DOCKER_LOG" && ok "no AI web container here: silent" || bad "an absent AI web made noise"

# After hydromart's half, bounded, and never able to change its result.
ai 'd1 db running healthy False' 'a1 aiweb running healthy False'
: > "$ORDER_LOG"
: > "$TIMEOUT_LOG"
run
awk '/^compose/ {c = NR} /^docker/ && !d {d = NR} END {exit !(c && d && c < d)}' "$ORDER_LOG" &&
  ok "the AI web half runs after hydromart's own checks" || bad "the AI web half ran before hydromart's: $(tr '\n' ' ' < "$ORDER_LOG")"
grep -qx '60 bash scripts/watchdog.sh --aiweb' "$TIMEOUT_LOG" && ok "  ...under timeout 60" ||
  bad "the AI web half is not bounded by timeout 60: $(cat "$TIMEOUT_LOG")"
TIMEOUT_EXPIRES=1 run
[ "$RC" = 0 ] && grep -q 'AI web check failed or ran past 60s' "$WORK/out" &&
  ok "an AI web half cut off at 60s is said, and hydromart's exit stays its own (0)" || bad "overrun: rc=$RC, $(cat "$WORK/out")"

# The stack lock: a deploy in progress means hands off, the AI web included.
lock_line="$(grep -n 'if ! stack_lock 0' scripts/watchdog.sh | cut -d: -f1)"
mode_line="$(grep -nF '"${1:-}" = --aiweb' scripts/watchdog.sh | cut -d: -f1)"
trap_line="$(grep -n '^trap aiweb_after EXIT' scripts/watchdog.sh | cut -d: -f1)"
[ -n "$lock_line" ] && [ -n "$mode_line" ] && [ -n "$trap_line" ] && [ "$lock_line" -lt "$mode_line" ] && [ "$lock_line" -lt "$trap_line" ] &&
  ok "the AI web half runs only after the stack lock is taken, by hand or from the trap" ||
  bad "the AI web half must come after stack_lock (lock $lock_line, --aiweb $mode_line, trap $trap_line)"
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
