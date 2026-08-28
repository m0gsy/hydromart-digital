#!/usr/bin/env bash
# The runnable check for N13/N14: both ops scripts must FAIL when the thing they watch is
# wrong, and pass when it is right. Written because a check that cannot go red is the exact
# failure class both of them exist to close — see the twenty green checks that proved
# nothing before them.
#
#   bash scripts/check-ops-scripts.test.sh
set -euo pipefail
cd "$(dirname "$0")/.."
fails=0

# Plain pass/fail, for assertions that are not "this command exits N".
ok() { echo "ok   $1"; }
bad() {
  echo "FAIL $1"
  fails=1
}

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "ok   $label"
  else
    echo "FAIL $label (expected exit $expected, got $actual)"
    fails=1
  fi
}

run() {
  set +e
  "$@" >/dev/null 2>&1
  local code=$?
  set -e
  echo "$code"
}

# --- N13: a domain that cannot present a certificate must be reported, not skipped ------
# `.invalid` is reserved by RFC 2606 and never resolves, so this asserts the "no certificate
# at all" branch without depending on the network being up.
check "tls: unreachable host is a failure" 1 "$(run bash scripts/check-tls-expiry.sh nothing.invalid)"

# A deploy with no domains at all (bare IP) has no certificate to watch; saying so beats a
# green check that measured nothing.
check "tls: no domains is not a failure" 0 "$(WEB_DOMAIN= API_DOMAIN= run bash scripts/check-tls-expiry.sh)"

# --- N14: the log-retention check must fail when the daemon is not configured -----------
# No docker (or no hydromart-gateway container) is exactly the state a fresh host is in, and
# it must be reported rather than passed.
check "logs: unconfigured host is a failure" 1 "$(run bash scripts/check-log-retention.sh)"

# --- the deploy must INSTALL the host cron, not advise somebody to -----------------------
#
# `scripts/install-host-cron.sh` is idempotent by construction, and the box has still been
# caught twice running an out-of-date copy of it: three weekly safety scripts from #323
# (measured 2026-08-25), then backup-offsite.sh and check-backup-freshness.sh (2026-08-27).
# Both times the line was in the repo, in the installer, and had never run — because
# installing it was a step a human had to remember.
#
# deploy.sh has ALWAYS named the installer, in `Fix: bash scripts/install-host-cron.sh`
# advice text. That is why this assertion cannot just grep for the filename: the whole
# defect is the difference between mentioning a command and running one. So it looks for an
# invocation on a line that is not a log message and not a comment.
INVOKES="$(grep -nE '^[[:space:]]*(if )?bash scripts/install-host-cron\.sh' scripts/deploy.sh || true)"
if [ -n "$INVOKES" ]; then
  ok "deploy runs install-host-cron.sh rather than advising it"
else
  bad "deploy.sh never executes install-host-cron.sh — every cron job added to the installer stays unscheduled until somebody SSHes in, which is how two sets of jobs have already been missed"
fi

# And the probe that verifies the result must still be there, AFTER the install. A deploy
# that installs and does not check has replaced one blind spot with another.
INSTALL_LINE="$(grep -nE '^[[:space:]]*(if )?bash scripts/install-host-cron\.sh' scripts/deploy.sh | head -1 | cut -d: -f1)"
PROBE_LINE="$(grep -n 'missing jobs the installer schedules' scripts/deploy.sh | head -1 | cut -d: -f1)"
if [ -n "$INSTALL_LINE" ] && [ -n "$PROBE_LINE" ] && [ "$INSTALL_LINE" -lt "$PROBE_LINE" ]; then
  ok "the missing-jobs probe runs after the install, so it measures what the deploy just did"
else
  bad "the install must come before the probe (install=$INSTALL_LINE probe=$PROBE_LINE)"
fi

# --- caddy drift is RELOADED, not narrated ---------------------------------------------
#
# The drift handler restarts the observability containers and, for everything else, prints
# "this deploy did not fix it". That rule is right for a container whose restart drops
# in-flight requests — and Caddy is not one: `caddy reload` validates the new file and swaps
# the config with the listeners still open, so the reason not to touch it does not apply.
#
# Leaving it as advice cost twenty days of missing HSTS and CSP once already, and the
# production deploy printed the same line again on 2026-08-27.
if grep -qE 'caddy reload --config' scripts/deploy.sh; then
  ok "deploy reloads a stale Caddyfile instead of describing it"
else
  bad "deploy.sh only NAMES a stale caddy config — a reload costs no connections and is the whole reason the restart rule does not apply here"
fi

# A reload that fails means the Caddyfile did not validate, and Caddy keeps serving the old
# one. That is the right outcome and the wrong thing to be quiet about.
if grep -qE 'alert "caddy refused to reload' scripts/deploy.sh; then
  ok "a Caddyfile that will not validate raises an alert rather than passing quietly"
else
  bad "a failed caddy reload must alert: the release is live and the front door is not"
fi

exit "$fails"
