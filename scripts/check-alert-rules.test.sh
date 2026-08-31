#!/usr/bin/env bash
# The runnable check for ops/alert-rules.yml.
#
#   bash scripts/check-alert-rules.test.sh
#
# Fourteen alert rules shipped for months with nothing that could evaluate one. Prometheus
# only reports a rule that fails to PARSE; a rule that parses and can never match is
# indistinguishable, from outside, from a rule that is simply never true — which is the
# state a good alert is in most of the time. So "no alerts fired" was read as "nothing is
# wrong" for both.
#
# promtool evaluates rules against a synthetic timeline and asserts which alerts fire at a
# given instant. It ships inside prom/prometheus, which docker-compose.prod.yml already runs
# and which is therefore already on any box that runs this stack — no new binary, no
# download, no version to keep in step with the server's.
#
# Skips (exit 0) when docker is not available, and says so. A check that cannot run must say
# it did not run: silently passing is the failure class the file it tests exists to close.
set -uo pipefail
cd "$(dirname "$0")/.."

IMAGE="$(sed -n 's/.*image: *\(prom\/prometheus:[^ ]*\).*/\1/p' docker-compose.prod.yml | head -1)"
IMAGE="${IMAGE:-prom/prometheus:v2.54.1}"

fails=0
echo "alert rules:"

# --- static, and it runs with or without docker -------------------------------------------
# promtool proves the two rules that exist. This proves the NEXT one: a rule added later with
# `sum(...) == 0` and no `or vector(0)` is the same defect, and nobody writes a fixture for a
# rule they have just written wrong. `sum(...) or vector(0)` is the only shape that turns an
# absent series into the zero the comparison needs.
#
# Scoped to `sum(`: `up == 0` and `pg_up == 0` are correct as they stand, because a target
# Prometheus is scraping always HAS a series — that is what `up` means.
# grep, not a paren-matching regex: `sum\([^)]*\)[^)]*== *0` was the first attempt and it
# could not go red, because `[^)]*` stops at the FIRST `)` and every one of these
# expressions nests — `sum(increase(...))`. Two flat conditions on the same line say the
# same thing and cannot be defeated by nesting.
BAD="$(grep -n '== *0' ops/alert-rules.yml | grep 'sum(' | grep -v 'or vector(0)' || true)"
if [ -n "$BAD" ]; then
  echo '  FAIL a rule compares an aggregate to 0 with no `or vector(0)`, so an absent series'
  echo "       (every deploy, until the first request) makes it silently unfirable:"
  echo "$BAD" | sed 's/^/         /'
  fails=$((fails + 1))
else
  echo "  ok   every aggregate compared to 0 survives an absent series"
fi

# --- every rule has a fixture, and this is the check that keeps it that way ----------------
# Three of sixteen rules had one. That is the same coverage shape that let DiskSpaceLow
# select `mountpoint="/rootfs"` — a label this host has never emitted — and sit in the file
# for months looking exactly like protection. promtool can only prove the rules somebody
# remembered to write a fixture for, and the rule most likely to be wrong is the one nobody
# thought about twice.
#
# This runs WITHOUT docker, so a machine that cannot run promtool still reports the gap.
UNTESTED=""
for a in $(grep -oE '^ *- alert: [A-Za-z0-9]+' ops/alert-rules.yml | awk '{print $3}'); do
  grep -qE "alertname: ${a}$" ops/alert-rules.test.yml || UNTESTED="$UNTESTED $a"
done
if [ -n "$UNTESTED" ]; then
  echo "  FAIL these rules have no promtool fixture, so nothing has ever proved they can"
  echo "       fire at all:$UNTESTED"
  fails=$((fails + 1))
else
  echo "  ok   every alert rule has at least one promtool fixture"
fi

if ! docker version >/dev/null 2>&1; then
  echo "  SKIPPED — docker is not available, so promtool cannot run here."
  echo "  Run it directly if you have promtool:  promtool test rules ops/alert-rules.test.yml"
  exit "$fails"
fi

# Git Bash rewrites /-leading arguments into Windows paths before docker sees them, so the
# container-side `-w` argument arrived as a drive-letter path and the daemon rejected it as
# not absolute. `pwd -W` gives the mount SOURCE the form the daemon wants; MSYS_NO_PATHCONV
# leaves the container-side paths alone. Both are no-ops off Windows.
#
# (Spelling that mangled path out literally here is what check-hardcoded-paths.mjs caught on
# the first run of this file — correctly: it cannot tell a path in prose from one in code.)
HOST_PWD="$(pwd -W 2>/dev/null || pwd)"
export MSYS_NO_PATHCONV=1

echo "alert rules:"
# --entrypoint: the image's own entrypoint is /bin/prometheus, so `promtool` arrives as an
# argument to the server and comes back "unexpected promtool" rather than running anything.
if docker run --rm -v "$HOST_PWD:/w" -w /w/ops --entrypoint promtool "$IMAGE" \
  test rules alert-rules.test.yml 2>&1 | sed 's/^/  /'; then
  [ "$fails" -eq 0 ] && { echo "alert rules: all checks passed"; exit 0; }
  echo "alert rules: $fails check(s) failed" >&2
  exit 1
fi
echo "alert rules: promtool reported a failing unit test" >&2
exit 1
