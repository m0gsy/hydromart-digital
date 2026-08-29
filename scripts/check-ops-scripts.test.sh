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

# And it must name the RIGHT place. This assertion previously demanded the opposite, and the
# opposite was wrong: `registry_mode()` (deploy-common.sh:37) is `[ -n "${IMAGE_PREFIX:-}" ]`,
# IMAGE_PREFIX is empty on this deployment, so rebuild-stale.sh:75 runs `compose build` and
# the build reads `NEXT_PUBLIC_SENTRY_DSN: ${SENTRY_DSN_WEB:-}` (docker-compose.prod.yml:694)
# out of the box's own .env. Every deploy that touches web prints `rebuilding: web`.
#
# The GitHub repo variable is real and also unset, but it feeds images.yml, whose images this
# box never pulls. It becomes the fix on the day registry mode is switched on, and not before.
if grep -qE 'Fix: set SENTRY_DSN_WEB in THIS .env' scripts/deploy.sh; then
  ok "the Sentry probe points at the .env this box actually builds from"
else
  bad "the Sentry probe names the wrong remediation — this box BUILDS its images, so .env is where the DSN goes"
fi

# The claim that made it wrong. It must not come back.
if grep -qE 'this box pulls images' scripts/deploy.sh; then
  bad "deploy.sh still claims this box pulls images — it builds them (rebuild-stale.sh:75, and every deploy prints 'rebuilding:')"
else
  ok "nothing claims this box pulls its images"
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

# --- a franchise depot with no commission scheme is REPORTED -----------------------------
#
# payout.service.ts:179 is `(await this.schemes.currentForDepot(depotId))?.pct ?? 0`, so a
# WARALABA depot with no commission_schemes row accrues nothing for HQ — and the ledger
# BALANCES, the statement PRINTS, every number reconciles. There is no broken thing to
# notice, only money that never arrived. The order-service detector catches it on the first
# ORDER; this catches it before one is placed.
if grep -qE 'franchise commission probe' scripts/deploy.sh; then
  ok "deploy reports active WARALABA depots with no commission scheme"
else
  bad "nothing reports a franchise depot with no commission scheme — HQ would take 0% and the ledger would still balance"
fi

if grep -qE 'franchise commission probe cannot read' scripts/deploy.sh; then
  ok "an unreadable answer is a finding here too"
else
  bad "the franchise commission probe can fail to read and stay silent"
fi

# --- variables that exist and never arrive ------------------------------------------------
#
# Three separate features were unreachable rather than merely off: the code read an env var,
# .env.example documented it, and docker-compose.prod.yml passed it to nothing. There was no
# value anybody could have set. That is a worse failure than a bug, because every layer looks
# correct on its own.
#
# SENTRY_DSN: packages/platform/src/nest/sentry.ts:26 returns immediately when blank, so
# every 5xx across ~19 services aggregated nowhere.
if grep -qE '^  SENTRY_DSN:' docker-compose.prod.yml; then
  ok "SENTRY_DSN reaches the services that read it"
else
  bad "SENTRY_DSN is read by every service and passed to none — backend error reporting cannot be switched on at all"
fi

# RATE_LIMIT_*: documented in .env.example since they were written, passed to no container,
# so production ran the Joi defaults and an operator editing .env during an incident changed
# nothing whatsoever.
RL_MISSING=''
for V in RATE_LIMIT_TTL_SECONDS RATE_LIMIT_MAX RATE_LIMIT_BURST_MAX RATE_LIMIT_OTP_MAX; do
  grep -qE "^      $V:" docker-compose.prod.yml || RL_MISSING="$RL_MISSING $V"
done
if [ -z "$RL_MISSING" ]; then
  ok "all four rate-limit knobs reach the gateway"
else
  bad "rate-limit knobs the gateway never receives:$RL_MISSING - turning them in .env would do nothing"
fi

# NEXT_PUBLIC_* is inlined by `next build`, so a runtime-only value is one the bundle never
# sees. Same failure shape as NEXT_PUBLIC_SENTRY_DSN.
if grep -qE 'ARG NEXT_PUBLIC_COURIER_HOTLINE' apps/web/Dockerfile; then
  ok "the courier hotline is a build arg, so the bundle can actually carry it"
else
  bad "NEXT_PUBLIC_COURIER_HOTLINE is not a build ARG — the courier help screen's call and WhatsApp buttons can never appear"
fi

# And the stale number that hid the whole class: .env.example advertised 100 while production
# ran 600, and neither reached a container, so nobody found out.
# --- and the contract stays free of lines that cannot indicate a fault -------------------
#
# deploy-common.sh:329 compares the box's .env against .env.example key by key and warns about
# every key the box does not set. So a variable whose BLANK is a correct, working state costs
# a warning on every single deploy and buys nothing.
#
# This is the ZENZIVA_BASE_URL lesson (#384) a second time, and I caused it a second time: the
# first deploy after the compose passthrough landed printed six such keys at once. All four
# rate-limit knobs default to exactly what production runs, and COURIER_HOTLINE blank correctly
# hides both buttons. Their reference lives in .env.production.example, which is the operator's
# document and is not compared against anything.
NOISE=''
for V in RATE_LIMIT_TTL_SECONDS RATE_LIMIT_MAX RATE_LIMIT_BURST_MAX RATE_LIMIT_OTP_MAX COURIER_HOTLINE; do
  grep -qE "^$V=" .env.example && NOISE="$NOISE $V"
done
if [ -z "$NOISE" ]; then
  ok ".env.example carries no key whose blank is already correct"
else
  bad "keys back in .env.example whose absence can never be a fault:$NOISE - every deploy would warn about a working box"
fi

# SENTRY_DSN is the one that stays. Blank there is not a working state dressed as a gap: it
# means ~19 services aggregate their 5xx nowhere, and nothing else on the box reports it.
if grep -qE '^SENTRY_DSN=' .env.example; then
  ok "the contract still asks about backend error reporting, which nothing else measures"
else
  bad "SENTRY_DSN dropped from the contract — blank means every 5xx goes nowhere and no probe would say so"
fi

# And the reference the operator actually reads must carry all of them.
MISSING=''
for V in RATE_LIMIT_TTL_SECONDS RATE_LIMIT_MAX RATE_LIMIT_BURST_MAX RATE_LIMIT_OTP_MAX COURIER_HOTLINE SENTRY_DSN; do
  grep -qE "^$V=" .env.production.example || MISSING="$MISSING $V"
done
if [ -z "$MISSING" ]; then
  ok ".env.production.example documents every knob, including the ones the contract skips"
else
  bad "knobs missing from the operator's reference:$MISSING"
fi

# --- which face verifier is running, and whether it can work -----------------------------
#
# FACE_VERIFIER_DRIVER defaults to `onnx` in three places at once — the Joi schema, the
# compose default, and .env.production.example — while the comment above the compose line
# says production is meant to be `neo`. No .onnx file is committed and nothing downloads one,
# so a box on the default answers 503 on every enrolment and every check-in: attendance
# simply does not work, quietly. Nothing measured which of those it was.
if grep -qE 'face verifier probe' scripts/deploy.sh; then
  ok "deploy reports which face verifier is running"
else
  bad "nothing says which face verifier the box runs — on the default it 503s every check-in and reports nothing"
fi

# `stub` accepts ANY frame. Fine on a laptop; on a real box it turns the biometric gate into
# a formality, and that must never pass quietly.
if grep -qE 'ACCEPTS ANY FACE' scripts/deploy.sh; then
  ok "a stub face verifier is called out rather than passing quietly"
else
  bad "a box running the stub face verifier would report nothing — the biometric check would accept anyone"
fi

# --- /metrics is asked of the SERVER, not of the disk -------------------------------------
#
# check-public-metrics.mjs has always supported `--url`, and its own header says why: "a
# config that is not deployed protects nothing". CI runs it WITHOUT one, so it read the
# Caddyfile on disk, found the block, and passed — while the live API answered 200 with
# 404 KB of the platform's traffic for two days. The block was committed and never reached
# the container: the Caddyfile was bind-mounted as a single FILE, and that mount pins an
# inode, so `git reset --hard` wrote a new file the container could not see.
if grep -qE 'check-public-metrics.mjs --url' scripts/deploy.sh; then
  ok "deploy asks the live API whether /metrics is public"
else
  bad "nothing asks the SERVER about /metrics — the gate reads a file, and a file is not a deployment"
fi

# The mount is the root cause, and it must stay a directory.
if grep -qE '^      - \./infra/caddy:/etc/caddy:ro' docker-compose.prod.yml; then
  ok "the Caddyfile is mounted as a directory, so a new file is visible to the container"
else
  bad "the Caddyfile is bind-mounted as a single file again — the mount pins an inode and every deploy silently serves the old config"
fi

# --- W6: something must verify the RELEASE, not only the containers -----------------------
#
# The whole deploy gate was health_ok(): gateway /health answers 200 and no container is
# unhealthy. Neither question touches a business path. `scripts/smoke.sh` drives a real
# customer flow and `grep -n smoke scripts/deploy.sh` was EMPTY — it existed only as a
# manual mode in deploy.yml:204, so it ran when somebody remembered, which on this repo's
# own evidence is never.
if grep -qE 'release smoke probe' scripts/deploy.sh; then
  ok "deploy asks the live API a business question after health_ok"
else
  bad "nothing verifies the release works: health_ok proves the containers are up, and a container that answers /health while its routes 500 is exactly the gap smoke.sh was written for"
fi

# ...and it must be able to ROLL BACK, or it is one more line in a log. A release whose
# customer-facing reads do not answer is not serving, which is the same situation health_ok
# already rolls back for (H-17).
if grep -A 40 -E 'release smoke probe' scripts/deploy.sh | grep -qE 'rollback\.sh'; then
  ok "a release that cannot serve its public reads is rolled back, not narrated"
else
  bad "the smoke probe reports and continues — a finding nobody acts on is the failure class this repo keeps re-buying"
fi

# The WRITE half must stay opt-in. smoke.sh grants loyalty points, redeems a reward into a
# real depot's pickup queue, stores a payment method and renames the demo profile — running
# that on every deploy manufactures production data forever. So deploy may invoke it, but
# only behind an explicit switch.
if grep -qE 'bash scripts/smoke\.sh' scripts/deploy.sh; then
  if grep -qE 'DEPLOY_SMOKE' scripts/deploy.sh; then
    ok "the write-path smoke is behind an explicit opt-in"
  else
    bad "deploy.sh runs scripts/smoke.sh unconditionally — every deploy would grant points, redeem a reward into a depot queue and add a payment method to a real account"
  fi
else
  ok "the write-path smoke is not wired in unconditionally"
fi

# --- the disk that holds the database AND its own backups --------------------------------
#
# PARTLY ALREADY BUILT, and that is the finding: ask-the-box.sh:200-230 asks `df -Pk /`,
# judges it at 85/95 and lists `pg_database_size` per database. Nothing SCHEDULES it — not
# the deploy, not the host cron (only ci.yml's self-test and registry-check's manual
# `diagnose` mode name the file). A judgement a human must SSH in to read is the same
# category as the three weekly scripts that sat in the installer and never ran.
if grep -qE 'disk probe —' scripts/deploy.sh; then
  ok "every deploy records free disk on the box"
else
  bad "no deploy has ever asked how much disk is left: a full disk on the machine holding both the database and its dumps is the one failure here that destroys data rather than uptime"
fi

if grep -qE 'pg_database_size' scripts/deploy.sh; then
  ok "and how big the databases actually are"
else
  bad "free bytes alone cannot say whether a restore would fit — nothing asks pg_database_size on a schedule"
fi

# It must ALERT, which is the one thing ask-the-box.sh cannot do (it echoes to a terminal
# somebody is already looking at).
if grep -A 30 -E 'disk probe —' scripts/deploy.sh | grep -qE 'alert "'; then
  ok "a disk about to stop Postgres reaches a human"
else
  bad "the disk probe only prints — ask-the-box.sh already prints, and printing is what has kept this unmeasured"
fi

# --- the alert destination is finally IN the contract -------------------------------------
#
# One variable decides whether every 5xx alert, the watchdog, the backup failure and the
# restore drill reach a person. It was absent from .env.example, so missing_env_keys() —
# which compares .env.example against the box's .env — was structurally incapable of ever
# reporting it. Blank is not a working state here, so it belongs in the contract next to
# SENTRY_DSN rather than in the noise list beside COURIER_HOTLINE.
if grep -qE '^ALERT_WEBHOOK_URL=' .env.example; then
  ok ".env.example declares ALERT_WEBHOOK_URL, so the env-contract gate can see it"
else
  bad ".env.example omits ALERT_WEBHOOK_URL — the deploy gate cannot report the one key that decides whether ANY alert reaches a human"
fi

# Declaring it is only half. compose_ignores_env() drops every .env.example key no compose
# file interpolates, so a key compose never mentions is filtered back out of the warning and
# the gate stays blind with the line present. docker-compose.prod.yml:23 passes this one.
if grep -qE '\$\{ALERT_WEBHOOK_URL' docker-compose.yml docker-compose.prod.yml; then
  ok "compose interpolates it, so compose_ignores_env() does not filter it back out"
else
  bad "no compose file reads ALERT_WEBHOOK_URL — compose_ignores_env() would drop it from the warning and adding it to .env.example would achieve nothing"
fi

# And the gate must still actually go RED for it. Asserted by RUNNING missing_env_keys()
# against a fixture, not by reading the two conditions above and believing them.
REPO="$PWD"
ENVFIX="$(mktemp -d)"
printf 'ALERT_WEBHOOK_URL=\n' >"$ENVFIX/.env.example"
printf 'NODE_ENV=production\n' >"$ENVFIX/.env"
printf 'services:\n  gateway:\n    environment:\n      ALERT_WEBHOOK_URL: ${ALERT_WEBHOOK_URL:-}\n' \
  >"$ENVFIX/docker-compose.prod.yml"
RED_FOR="$( (cd "$ENVFIX" && . "$REPO/scripts/lib/deploy-common.sh" >/dev/null 2>&1 && missing_env_keys) || true)"
rm -rf "$ENVFIX"
case "$RED_FOR" in
  *ALERT_WEBHOOK_URL*) ok "missing_env_keys() reports ALERT_WEBHOOK_URL when the box does not set it" ;;
  *) bad "the env gate cannot go red for ALERT_WEBHOOK_URL (it printed: '${RED_FOR:-nothing}')" ;;
esac

# --- the backup keys compose never passes -------------------------------------------------
#
# BACKUP_OFFSITE_DEST and BACKUP_S3_* are read by scripts (backup-offsite.sh, backup-db.sh),
# never by compose. So compose_ignores_env() filters them and .env.example can NEVER make the
# env gate see them, however carefully they are listed there. The only instrument that can is
# a probe that reads .env directly — which is what deploy.sh does for STORAGE_DRIVER already.
if grep -qE 'ops secrets probe —' scripts/deploy.sh; then
  ok "deploy reads the script-only backup secrets out of .env itself"
else
  bad "BACKUP_OFFSITE_DEST/BACKUP_S3_* reach no compose file, so the env-contract gate is structurally blind to them and nothing else asks — every copy of the database can sit on the database's own disk unnoticed"
fi

exit "$fails"
