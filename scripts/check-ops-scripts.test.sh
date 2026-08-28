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

# --- the OTP channel is probed on the box ------------------------------------------------
#
# scripts/check-launch-blockers.mjs asks this of the REPO's .env, on a laptop, and is never
# executed on the box (grep it across .github/ and scripts/ — only the script and its own
# self-test). So the credential pair standing between a stranger and an account had no
# measurement anywhere near production, while VAPID and FCM — strictly less critical — both
# had one.
if grep -qE 'otp probe — channel' scripts/deploy.sh; then
  ok "deploy probes the OTP channel's credentials inside auth"
else
  bad "nothing measures the OTP credentials on the box: VAPID and FCM are probed and the one that gates every sign-in is not"
fi

# `console` prints the code into the container log. A stack left on it is one log read away
# from signing in as any customer, so it must shout rather than pass quietly.
if grep -qE 'OTP codes are only logged, not sent' scripts/deploy.sh; then
  ok "an OTP channel of console raises an alert"
else
  bad "a box on OTP_DELIVERY_CHANNEL=console must alert — the code is in the log"
fi

# --- the env contract can SEE the production OTP credentials -----------------------------
#
# deploy-common.sh compares the box's .env against .env.example, so a variable absent from
# the example is a variable the per-deploy gate is structurally blind to. ZENZIVA_* was
# absent while production ran on that channel.
if grep -qE '^ZENZIVA_USERKEY=' .env.example && grep -qE '^ZENZIVA_PASSKEY=' .env.example; then
  ok ".env.example declares the Zenziva credentials, so the env-contract gate can see them"
else
  bad ".env.example omits ZENZIVA_* while production runs that channel — the env gate cannot see the two keys every sign-in needs"
fi

# And ONLY those two. ZENZIVA_BASE_URL carries a Joi default that IS the production value
# (env.validation.ts:91), so a box that never sets it is a box that is working — listing it
# here made the contract gate warn on the first deploy after it was added, about nothing. A
# line that can never indicate a fault is noise in a gate whose entire value is being read.
if grep -qE '^ZENZIVA_BASE_URL=' .env.example; then
  bad "ZENZIVA_BASE_URL is back in .env.example — it has a default equal to the production value, so it can only ever produce a false warning"
else
  ok "the contract lists the two Zenziva keys that can actually be wrong, and not the one that cannot"
fi

# --- the Sentry probe reads the IMAGE, not a file nothing reads --------------------------
#
# It used to read SENTRY_DSN_WEB from the box's .env and advise "set it in .env and REBUILD".
# Both halves were wrong: deploy.sh PULLS images and never builds one, and the image is built
# by images.yml:148 from the GitHub repo VARIABLE `vars.SENTRY_DSN_WEB`. So the advice pointed
# at a file where the value has no effect, on a machine that does no builds.
if grep -qE 'exec -T web .*NEXT_PUBLIC_SENTRY_DSN' scripts/deploy.sh; then
  ok "the Sentry probe reads the DSN baked into the running web image"
else
  bad "the Sentry probe still reads .env — this box pulls images, so that value affects nothing"
fi

if grep -qE 'Setting it in this .env does NOTHING' scripts/deploy.sh; then
  ok "and it says plainly that editing .env would not help"
else
  bad "the Sentry probe must name the GitHub repo VARIABLE as the fix; .env is a dead end here"
fi

# --- a depot with nowhere for money to land is REPORTED ----------------------------------
#
# payments.ts hides TRANSFER without a bank account and QRIS without an image, and never
# filters CASH — so a depot with all four columns blank sells quietly, cash only, and nothing
# on any screen says two methods were removed rather than declined. The check that would have
# said so already existed (check-launch-blockers.mjs L2.3) and had never run on the box;
# measured 2026-08-29, all three production depots were in exactly that state.
if grep -qE 'depot payment probe' scripts/deploy.sh; then
  ok "deploy reports active depots with no payment destination"
else
  bad "nothing tells the box that a depot takes cash only — the L2.3 question is asked by a gate that never runs here"
fi

# An unreadable answer must be a FINDING. The outbox probe next to it printed "unreadable"
# for its whole life and proved nothing, quietly.
if grep -qE 'depot payment probe cannot read' scripts/deploy.sh; then
  ok "an unreadable depot database is treated as a finding, not a pass"
else
  bad "the depot payment probe can fail to read and stay silent — that is the outbox bug again"
fi

exit "$fails"
