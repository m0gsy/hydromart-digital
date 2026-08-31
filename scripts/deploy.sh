#!/usr/bin/env bash
# Zero-drama CD for the single-VPS deploy. Runs ON the VPS, in the repo root.
# Reuses the existing serial rebuild + db backup so a build never OOMs the box
# and every deploy is recoverable. On a failed health check it auto-rolls-back
# to the last-good commit — so a bad merge can't leave the site down.
#
# Usage (on VPS):
#   bash scripts/deploy.sh            # fetch origin/main, rebuild changed svcs
#   bash scripts/deploy.sh --all      # force-rebuild every service
#
# ponytail: no blue-green / no image registry. Single box, compose-built images,
# in-place restart with auto-rollback. Add a registry + swap when there's a 2nd node.
set -euo pipefail

cd "$(dirname "$0")/.."
# ONE-RELEASE LAG, and it has been mistaken for "the fix did not work" twice.
#
# This sources the helpers HERE, and `git reset --hard "$NEW_SHA"` is ~40 lines below. Bash
# has already parsed every function body by then, so a deploy runs the helpers belonging to
# the PREVIOUS release. Any change to deploy-common.sh — or to this file past this point —
# takes effect on the deploy AFTER the one that ships it.
#
# Proved on the box, same .env, two consecutive runs: the release that narrowed the env
# warning still printed the old 75 keys, and the next one printed 7. The release that fixed
# `throwaway_storage_driver` still exited 1 for the reason it had just fixed.
#
# So when judging a deploy-script change, read the run AFTER its merge. Not a bug to fix by
# re-exec: a script that replaces itself mid-run is a far worse failure mode than waiting
# one release.
. scripts/lib/deploy-common.sh

STATE_DIR=".deploy"; mkdir -p "$STATE_DIR"
LAST_GOOD="$STATE_DIR/last-good-sha"
BRANCH="${DEPLOY_BRANCH:-main}"

log() { echo "[deploy] $*"; }

# Held for the whole deploy: the watchdog must not converge the containers this is in the
# middle of recreating, and two deploys must not interleave. Waits rather than fails,
# because the only thing normally holding it is one watchdog pass.
if ! stack_lock 900; then
  log "!! the stack lock is still held after 15 minutes — refusing to deploy over it"
  exit 1
fi

PREV_SHA="$(git rev-parse HEAD)"
log "current HEAD $PREV_SHA"

# M15. The dump used to run HERE, first thing after the stack lock, on EVERY deploy — before
# this script has even fetched the new commit, so before it can possibly know whether the
# release carries a migration. Most do not, and for those the dump buys nothing: rolling a
# non-migrating deploy back is re-deploying the previous image against an unchanged schema.
#
# It has NOT been deleted, it has been moved to the one place it is the safety net for: just
# above `migrate-prod.sh`, which is the only step in a deploy that can make the schema
# unrollable. `pending_migrations` (line ~134 below) is where this script first knows the
# answer, which is why the dump could not simply stay here and be made conditional.
#
# The invariant that must not break, stated so a later reader can check it: A DEPLOY THAT
# APPLIES A MIGRATION STILL HOLDS A PRE-MIGRATION DUMP. `migrate-prod.sh` takes its own
# backup unless told otherwise, and deploy passes `MIGRATE_SKIP_BACKUP=1` precisely because
# it has just taken one itself — so the two halves have to move together, and they did.

git fetch origin "$BRANCH"
TIP_SHA="$(git rev-parse "origin/$BRANCH")"

# M26 — ship the commit whose CI went green, not whatever the tip is by the time we get here.
#
# The workflow gate checks its TRIGGER (`workflow_run.conclusion == 'success'`) while this
# script picked its own target, so the guarantee that actually held was "some commit is
# green", not "this commit is green". Measured on 2026-08-22: #230 merged at 16:30, #232 at
# 16:57, CI(#230) went green at 17:13, and the deploy it fired reset to #232 — which ran in
# production for 41 minutes under #230's CI, and missed being caught a second time by 28
# seconds. The realistic failure is not "a red PR lands" (nobody merges one); it is two PRs
# each green alone and red together, which C6 and C11 were on e2e that same day.
#
# DEPLOY_SHA arrives from the workflow (`workflow_run.head_sha`); a manual dispatch leaves it
# empty and keeps the old behaviour of taking the tip deliberately.
NEW_SHA="${DEPLOY_SHA:-$TIP_SHA}"
if [ -n "${DEPLOY_SHA:-}" ]; then
  if ! git merge-base --is-ancestor "$NEW_SHA" "$TIP_SHA" 2>/dev/null; then
    log "!! $NEW_SHA is not on origin/$BRANCH — refusing to deploy it"
    exit 1
  fi
  # CI runs finish out of order, so the green SHA can be OLDER than what is already serving.
  # Deploying it would roll production backwards with no failure anywhere to explain why.
  # `--is-ancestor X X` is true, so this also makes a repeat deploy of the same commit a
  # no-op rather than a rebuild.
  if git merge-base --is-ancestor "$NEW_SHA" "$PREV_SHA" 2>/dev/null; then
    log "$NEW_SHA is already contained in the running $PREV_SHA — nothing to deploy"
    exit 0
  fi
  if [ "$NEW_SHA" != "$TIP_SHA" ]; then
    log "deploying the green commit $NEW_SHA (tip is $TIP_SHA — its own deploy will follow)"
  fi
fi

# Decide which services to rebuild BEFORE moving the working tree. The diff is computed
# unconditionally now — --all changes what gets rebuilt, not whether the incoming commit
# carries migrations.
# Diff against what the CONTAINERS were built from, not against the tree. After a deploy
# that died past the reset, those two are different commits, and only the first one gives
# the real rebuild set. PREV_SHA stays the tree's HEAD because that is the rollback target.
CHANGED="$(git diff --name-only "$(rebuild_base "$LAST_GOOD" "$PREV_SHA")" "$NEW_SHA")"
if [ "${1:-}" = "--all" ]; then
  SERVICES=(--all)
else
  if needs_full_rebuild "$CHANGED"; then
    log "shared package or root build input changed → full rebuild"
    SERVICES=(--all)
  else
    mapfile -t SERVICES < <(echo "$CHANGED" | while read -r f; do svc_of "$f"; done | sort -u | grep -v '^$' || true)
  fi
fi

git reset --hard "$NEW_SHA"

# A rebuild is not atomic: rebuild-stale.sh builds and `up -d`s in serial batches, so a
# failure in batch 3 of 5 leaves the first two services running NEW code against services
# still on the OLD image. `set -e` used to end the script right there — no converge, no
# health check, no rollback — so the workflow went red while production sat in a state
# nobody chose and nothing reported. Roll back on that failure exactly as on a failed
# health check, because it is the same situation: this commit is not serving. (H-17)
rebuild_or_rollback() {
  if bash scripts/rebuild-stale.sh "$@"; then return 0; fi
  log "!! rebuild FAILED partway — services may be split across two commits"
  log "!! rolling back to $PREV_SHA"
  alert "deploy rebuild failed at $NEW_SHA; rolling back to $PREV_SHA"
  bash scripts/rollback.sh "$PREV_SHA"
  exit 1
}

# B-20 — schema before code, enforced instead of remembered.
#
# Migration execution used to be a separate manual button in the Deploy workflow, so a
# merge carrying both a migration and the code that reads it shipped the code now and the
# schema whenever someone remembered. New containers then ran against the old schema.
#
# This runs AFTER the reset because the migration files only exist in the incoming tree,
# and BEFORE any container is rebuilt or started, so the new code never meets the old
# schema. If it fails, the tree goes back and the running stack is never touched at all.
#
# Direction of the remaining risk is deliberate: a later health failure rolls the CODE
# back to $PREV_SHA and leaves the schema ahead of it. That is the repo's own convention
# (a column ships one release before its reader) and is the survivable half.
MIGRATIONS="$(pending_migrations "$CHANGED")"
if [ -n "$MIGRATIONS" ]; then
  log "incoming commit adds migrations:"
  echo "$MIGRATIONS" | sed 's/^/  /'
  if [ "${DEPLOY_MIGRATE:-apply}" = "apply" ]; then
    # H-39, the half that was only ever a note. Every migration builds its indexes with a
    # plain `CREATE INDEX IF NOT EXISTS`, which blocks writes to the table for the whole
    # build — the split that makes that safe is "build it CONCURRENTLY first, let the
    # migration find it already there". Nothing ran that first half: deploy fires by itself
    # on merge, so a human remembering to ssh in beforehand is not a mechanism. On 2026-08-14
    # two indexes shipped this way and locked their tables inside the migration; both tables
    # were near-empty, so it cost nothing and proved nothing.
    #
    # Idempotent (every statement is IF NOT EXISTS) and a no-op when the indexes are already
    # there, so it runs on every migrating deploy rather than being conditional on which
    # index changed. Fails CLOSED: an index it could not build concurrently is one the
    # migration is about to build under a write lock instead.
    log "building new indexes concurrently first (writes stay open)"
    if ! bash scripts/create-indexes.sh; then
      log "!! concurrent index build FAILED — refusing to let the migration build it under a lock"
      log "   fix the index by hand (the script names it), then re-run this deploy"
      git reset --hard "$PREV_SHA"
      alert "deploy aborted: concurrent index build failed on $NEW_SHA (stack still serving $PREV_SHA)"
      exit 1
    fi
    log "applying them before any container starts on the new code"
    # The backup at the top of this script is minutes old — do not take a second one.
    # M15: the pre-migration dump, taken here now rather than on every deploy. This is the
    # step it protects — `MIGRATE_SKIP_BACKUP=1` below is only honest because of this line.
    log "backing up databases before migrating (rollback safety net)"
    if ! bash scripts/backup-db.sh; then
      log "!! backup failed — refusing to migrate without one"
      alert "deploy aborted: pre-migration backup failed"
      exit 1
    fi
    if ! MIGRATE_SKIP_BACKUP=1 bash scripts/migrate-prod.sh; then
      log "!! migration FAILED — restoring the tree to $PREV_SHA, running stack untouched"
      git reset --hard "$PREV_SHA"
      alert "deploy aborted: migration failed on $NEW_SHA (stack still serving $PREV_SHA)"
      exit 1
    fi
  else
    log "!! DEPLOY_MIGRATE=${DEPLOY_MIGRATE} — refusing to start new code against an un-migrated schema"
    log "   apply them yourself (bash scripts/migrate-prod.sh), then re-run this deploy"
    git reset --hard "$PREV_SHA"
    exit 1
  fi
fi

# W7 — the image step is TIMED, because it is the same work a rollback has to do. Nothing
# in this repo had ever measured it: rebuild-stale.sh:30 still quotes a 40-minute deploy
# timeout that deploy.yml:226 raised to 120m, which is what a written-down number becomes.
# Written to .deploy/image-cost and read back by the rollback-cost probe below, so the
# figure an operator reads at 2am is one this machine produced minutes earlier.
IMAGE_T0="$(date +%s)"
# The images compose actually names — 19 of them, and exactly the set a `pull` fetches.
IMAGE_TOTAL="$(grep -c 'image: ${IMAGE_PREFIX' docker-compose.prod.yml 2>/dev/null || true)"
IMAGE_TOTAL="${IMAGE_TOTAL:-0}"
IMAGE_N=0
IMAGE_MODE=none

if registry_mode; then
  IMAGE_MODE=pull; IMAGE_N="$IMAGE_TOTAL"
  # H-31/H-35: images were built in CI and tagged with this exact commit. Nothing is
  # compiled on the box that serves customers — no 1.5 GB build peak beside Postgres, no
  # layers on the production disk, and no repeat of the BuildKit daemon panic that stopped
  # all 25 containers on 2026-08-02.
  log "registry mode (IMAGE_PREFIX=$IMAGE_PREFIX) — pulling images tagged $NEW_SHA"
  # M10. deploy.yml and images.yml are BOTH triggered by `workflow_run: CI completed`, so
  # they run in PARALLEL — this can and does arrive before the images it needs. The abort
  # below is safe (the tree goes back and the stack keeps serving PREV_SHA), but safe still
  # meant a deploy somebody had to notice and re-run by hand, which is the kind of chore
  # that makes a mode get switched back off.
  #
  # So wait for the publish rather than racing it. Bounded, because waiting forever on a
  # workflow that FAILED is just a slower way of never deploying.
  image_wait=0
  until pull_images "$NEW_SHA"; do
    if [ "$image_wait" -ge "${IMAGE_WAIT_SECONDS:-600}" ]; then
      log "!! no images for $NEW_SHA after ${image_wait}s — the Images workflow has not published them"
      log "   restoring the tree to $PREV_SHA; the running stack was not touched"
      git reset --hard "$PREV_SHA"
      alert "deploy aborted: no images published for $NEW_SHA (stack still serving $PREV_SHA)"
      exit 1
    fi
    log "   images for $NEW_SHA not published yet (${image_wait}s) — Images runs beside this one; waiting"
    sleep 30
    image_wait=$((image_wait + 30))
  done
  # The images for this commit exist and are local now, so record the tag where a bare
  # `docker compose` can find it. Written AFTER the pull, never before: a tag in .env that
  # names images nobody has is worse than no tag at all.
  persist_image_tag "$NEW_SHA" ||
    log '!! could not write IMAGE_TAG to .env — manual compose calls will ask for :local'
elif [ "${SERVICES[0]:-}" = "--all" ]; then
  IMAGE_MODE=build; IMAGE_N="$IMAGE_TOTAL"
  log "rebuilding ALL services"
  rebuild_or_rollback --all
elif [ "${#SERVICES[@]}" -eq 0 ]; then
  # No image is stale — but that is NOT "nothing to do". docker-compose.prod.yml,
  # .env.example, Caddyfile and the scripts themselves all change how the stack RUNS
  # while matching no service, and the old early `exit 0` here meant every one of those
  # deploys reported success without a single container being touched. It was also the
  # reason a fix to these very scripts only took effect on some later, unrelated deploy.
  log "no service image is stale — converging config only"
else
  IMAGE_MODE=build; IMAGE_N="${#SERVICES[@]}"
  log "rebuilding: ${SERVICES[*]}"
  rebuild_or_rollback "${SERVICES[@]}"
fi

# Only when images were actually handled: a config-only deploy measures nothing, and
# overwriting a real measurement with a zero would make the probe below lie in the
# reassuring direction.
if [ "$IMAGE_N" -gt 0 ]; then
  echo "$IMAGE_MODE $IMAGE_N $(( $(date +%s) - IMAGE_T0 )) $(date -Is)" \
    > "$STATE_DIR/image-cost" || log "!! could not record the image-step cost"
fi

# rebuild-stale only `up -d`s the services it rebuilt, so anything outside that set
# (Caddy, and any container an earlier batch or anything else left down) stays stopped.
# One idempotent converge brings the whole project to its declared state — and is what
# makes a compose/env change actually recreate the containers it affects.
log "converging the full stack (recreates changed containers, starts anything stopped)"
converge

# The scheduler bind-mounts scripts/scheduler/ and its entrypoint COPIES the crontab to
# /etc/crontabs/root at container start. So a release that only edits the crontab changes
# nothing compose can see: converge leaves the container running, crond keeps the schedule
# it read at boot, and the new jobs never fire. Silently — which is the same failure mode
# as the ownership bug the entrypoint comment describes, found the same way, too late.
if ! git diff --quiet "$PREV_SHA" "$NEW_SHA" -- scripts/scheduler/ 2>/dev/null; then
  log "scheduler scripts changed — restarting it so crond re-reads the crontab"
  $COMPOSE restart scheduler || log "!! scheduler restart failed — new cron jobs are NOT live"
fi

# The same class of bug as the crontab above, and it hid for twenty days. Compose recreates
# on a DEFINITION change; the CONTENT of a bind-mounted file is not part of one, so a
# release that only edits ops/prometheus.yml or the Caddyfile leaves the container running
# the copy it opened at boot. Prometheus served a pre-Q-9 ruleset from 5 August — 13 rules
# where the repo had 16, and NoOrdersCreated and PaymentConfirmFailing, the only two alerts
# the on-call runbook calls customer-visible, never loaded at all. Caddy shipped neither
# HSTS nor CSP for twenty days, because they landed the day after its container started.
#
# A restart re-resolves the mount (check-config-drift.test.sh proves it), so the containers
# nobody notices restarting are restarted here. Anything user-facing is named instead of
# touched mid-deploy: an operator picks that moment, not a script.
DRIFTED="$(bash scripts/check-config-drift.sh --list 2>/dev/null || true)"
for stale in $DRIFTED; do
  case "$stale" in
    *prometheus*|*alertmanager*|*grafana*|*exporter*)
      log "$stale is running a stale config file — restarting it"
      docker restart "$stale" >/dev/null 2>&1 ||
        log "!! $stale restart FAILED — it is still running the old config"
      ;;
    *caddy*)
      # Caddy RELOADS. That is the whole difference.
      #
      # The rule above — name a user-facing container rather than restart it mid-deploy —
      # exists because a restart drops in-flight requests, and the front door is the worst
      # place to do that. `caddy reload` has no such cost: it validates the new Caddyfile
      # first and swaps the config with the listeners still open. So the reason not to touch
      # it automatically does not apply, and leaving the fix as advice cost twenty days of
      # missing HSTS and CSP once already.
      #
      # `--force` because the config on disk can be byte-identical to the one Caddy holds
      # after an earlier failed adopt; without it that reload is a no-op that reports success.
      if docker exec "$stale" caddy reload --config /etc/caddy/Caddyfile --force >/dev/null 2>&1; then
        log "$stale reloaded its Caddyfile (no connections dropped)"
      else
        # A reload that fails means the new Caddyfile did not VALIDATE — Caddy keeps serving
        # the old one, which is the right outcome and the wrong thing to be quiet about.
        log "!! $stale would not reload: the Caddyfile on disk did not validate."
        log "!!   It is still serving the previous config. Check it with:"
        log "!!     docker exec $stale caddy validate --config /etc/caddy/Caddyfile"
        alert "caddy refused to reload — the Caddyfile in this release does not validate"
      fi
      ;;
    *)
      log "!! $stale is running a stale config file, and this deploy did not fix it."
      log "!!   docker restart $stale   — when a brief interruption is acceptable"
      ;;
  esac
done

if health_ok; then
  # W6 — health_ok proves the CONTAINERS are up. It does not prove the RELEASE works.
  #
  # It asks two questions: does the gateway answer /health, and does docker call anything
  # unhealthy. A service whose routes 500 on every request answers both of those correctly,
  # and so does one whose Prisma client cannot reach its database after a schema change.
  # `scripts/smoke.sh` was written for exactly that gap — and `grep -n smoke scripts/deploy.sh`
  # was EMPTY. It existed only as a manual mode in deploy.yml, which is to say it ran when
  # somebody remembered, which on this repo's evidence is never.
  #
  # smoke.sh is not simply called here, and the reason is not caution. It WRITES to
  # production: it grants loyalty points, redeems a reward into a real depot's pickup queue
  # (a redemption a staff member then has to hand over), stores a payment method on a real
  # account and renames that profile to "Smoke Edited". Running it on every deploy would
  # manufacture that data forever. So the gate below is the READ half — the same two public
  # endpoints smoke.sh drives, asked the way a customer's first screen asks them — and the
  # write half runs whenever the box carries a real demo CUSTOMER (DEMO_CUSTOMER_PHONE +
  # REVIEWER_OTP_CODE), and is skipped quietly otherwise. DEPLOY_SMOKE=read turns it off for
  # a release where the box must be touched as little as possible.
  #
  # This comment used to say the write half was opt-in behind DEPLOY_SMOKE=full while the
  # code below already defaulted to full — the file contradicted itself two hundred lines
  # apart, and the self-test asserted the comment rather than the behaviour.
  #
  # Both paths are @Public() by declaration (loyalty reward.controller.ts:25,
  # depot depot.controller.ts:68), so a 401 here is a finding, not an expected answer.
  # An EMPTY but valid list is a PASS: an empty catalogue is a data state, not a broken
  # release, and a gate that rolls back over one would roll back forever on a fresh box.
  SMOKE_BASE="${GATEWAY_HEALTH%/health}"
  SMOKE_ASKED=""
  SMOKE_DEAD=""
  SMOKE_ODD=""
  for round in 1 2 3 4 5 6; do
    SMOKE_ASKED=""; SMOKE_DEAD=""; SMOKE_ODD=""
    for path in ${DEPLOY_SMOKE_PATHS:-/loyalty/api/v1/rewards/catalog /depots/api/v1/depots}; do
      # `|| true`: curl exits non-zero when the connection itself fails, and under
      # `set -euo pipefail` that status would end the deploy inside the assignment — the
      # same trap the scheduler-TZ probe a few lines below documents, twice paid for.
      # A dead endpoint is what this exists to SEE, so it must survive seeing one: 000.
      CODE="$(curl -s -o /dev/null -m 15 -w '%{http_code}' "$SMOKE_BASE$path" || true)"
      SMOKE_ASKED="$SMOKE_ASKED $path:${CODE:-000}"
      case "${CODE:-000}" in
        200) ;;
        000|5*) SMOKE_DEAD="$SMOKE_DEAD $path:${CODE:-000}" ;;
        *)      SMOKE_ODD="$SMOKE_ODD $path:$CODE" ;;
      esac
    done
    [ -z "$SMOKE_DEAD" ] && break
    # health_ok has already waited; this is for a service that answers its healthcheck
    # before its first real query works. Short, because a release that needs a minute of
    # grace past health_ok is a release that is failing.
    [ "$round" -lt 6 ] && sleep 10
  done
  log "release smoke probe (path:http) —$SMOKE_ASKED"
  if [ -n "$SMOKE_DEAD" ]; then
    log "!! the release does not serve its public reads:$SMOKE_DEAD"
    log "   Every container is running and healthy, so nothing else here would have said so."
    log "!! rolling back to $PREV_SHA"
    alert "deploy rolled back: $NEW_SHA is healthy but does not serve$SMOKE_DEAD"
    bash scripts/rollback.sh "$PREV_SHA"
    exit 1
  fi
  if [ -n "$SMOKE_ODD" ]; then
    # Not a rollback: a 4xx on a route declared @Public() means the route CONTRACT moved,
    # which the previous release would answer the same way. Rolling back would not fix it
    # and would hide it.
    log "!! a public read answered something other than 200:$SMOKE_ODD"
    log "   Both paths are @Public(); a 401/404 here means the route moved, not that it is down."
    alert "public read answered$SMOKE_ODD after deploying $NEW_SHA"
  fi
  # The write half. It was behind DEPLOY_SMOKE=full for a real reason: every run granted
  # loyalty points, parked a redemption in a real depot's pickup queue for staff to hand
  # over, stored one more payment method on a real account and renamed that customer to
  # "Smoke Edited" — permanently, once per release. Opt-in was the honest answer to that.
  #
  # Its price was that the customer money path was verified on approximately no release at
  # all, which is the same failure class as the twenty green checks that proved nothing.
  #
  # smoke.sh now UNDOES all of it before it exits — cancel the redemption (which refunds the
  # points, restores stock and takes the row out of the depot queue), DELETE the payment
  # method, PATCH the real name back — using endpoints that already existed. That is proved
  # by RUNNING it against a stub in check-ops-scripts.test.sh, not by reading it. So the
  # reason to keep it off is gone, and DEPLOY_SMOKE=read is the way to turn it off for a
  # release where the box must be touched as little as possible.
  #
  # It ALERTS and never rolls back, and it can never fail this script. The read gate above
  # is what protects the release; this goes deeper, needs a demo account, and a failure here
  # is something to look at — not a reason to take a working release off a healthy box.
  # A deploy that reports failure while production is fine is the trap this file has already
  # paid for twice.
  SMOKE_CRED="$(tr -d '\r' < .env 2>/dev/null | sed -n 's/^REVIEWER_OTP_CODE=//p' | head -1 || true)"
  # DEMO_CUSTOMER_PHONE, not just the OTP. smoke.sh falls back to REVIEWER_PHONE when it is
  # unset (smoke.sh:57-58), and on this box REVIEWER_PHONE is a KEPALA_DEPOT staff account —
  # which answers 403 to redeem, vouchers and payment-methods because those are customer
  # routes. smoke then exits 1 and this block alerts, on every deploy, with production
  # perfectly healthy. .env.production.example:122-125 blesses leaving it blank ("leave blank
  # and both degrade quietly"), so blank must stay quiet here too — a `!!` nobody can act on
  # is a line people stop reading, which is the trap this file has already paid for twice.
  SMOKE_WHO="$(tr -d '\r' < .env 2>/dev/null | sed -n 's/^DEMO_CUSTOMER_PHONE=//p' | head -1 || true)"
  if [ "${DEPLOY_SMOKE:-full}" = "read" ]; then
    log "DEPLOY_SMOKE=read — write-path smoke skipped for this release"
  elif [ -z "$SMOKE_CRED" ] || [ -z "$SMOKE_WHO" ]; then
    # No alert. A box with no demo account is a legitimate state, and a `!!` on every single
    # deploy is a line people stop reading — the reviewer probe below learned this already.
    if [ -z "$SMOKE_CRED" ]; then
      log "write-path smoke skipped: REVIEWER_OTP_CODE is unset, so nothing here can learn an OTP."
    else
      log "write-path smoke skipped: DEMO_CUSTOMER_PHONE is unset. REVIEWER_PHONE is staff on"
      log "   this box, and a staff token is 403 on the customer routes smoke drives."
    fi
    log "   Set REVIEWER_PHONE + REVIEWER_OTP_CODE + DEMO_CUSTOMER_PHONE in .env and every"
    log "   deploy verifies the redeem/payment/profile path end to end. It cleans up after"
    log "   itself now, so it costs the demo account nothing permanent."
  else
    log "write-path smoke (real requests, all writes undone before it exits)"
    if ! bash scripts/smoke.sh; then
      log "!! the write-path smoke FAILED — the release is serving reads but a customer flow is broken"
      log "   Read its ❌ lines: one naming a row it could not undo means residue was left behind."
      alert "write-path smoke failed after deploying $NEW_SHA"
    fi
  fi

  echo "$PREV_SHA" > "$STATE_DIR/prev-sha"   # one step back, for manual rollback
  echo "$NEW_SHA" > "$LAST_GOOD"
  log "DEPLOY OK → $NEW_SHA (previous good: $PREV_SHA)"
  # C1 — prove the scheduler's clock instead of assuming it. Compose sets TZ on that
  # container, but alpine had no zone files to read it with, so it ran UTC and every cron
  # time landed seven hours late while looking perfectly healthy. Asking the container what
  # TZ it was given, and comparing what it makes of it against the same TZ on this host,
  # needs nothing from .env and cannot drift out of date.
  # `|| true` on both probes, deliberately: this runs under `set -euo pipefail`, and pipefail
  # makes a failed `compose exec` fail the whole assignment. A stopped scheduler is a
  # legitimate state (DEPLOY.md documents `up -d --scale scheduler=0`), so without this a
  # deploy that WORKED would exit non-zero straight after logging DEPLOY OK — the one
  # signal anybody reads, wrong in the dangerous direction (H-17 again).
  SCHED_TZ="$($COMPOSE exec -T scheduler printenv TZ 2>/dev/null | tr -d '\r\n' || true)"
  if [ -z "$SCHED_TZ" ]; then
    log "!! could not read the scheduler's TZ — its cron times are unverified"
  else
    SCHED_CLOCK="$($COMPOSE exec -T scheduler date '+%Z%z' 2>/dev/null | tr -d '\r\n' || true)"
    WANT_CLOCK="$(TZ="$SCHED_TZ" date '+%Z%z')"
    if [ "$SCHED_CLOCK" = "$WANT_CLOCK" ]; then
      log "scheduler clock $SCHED_CLOCK (TZ=$SCHED_TZ) — cron times are local, as written"
    else
      log "!! scheduler clock is $SCHED_CLOCK but TZ=$SCHED_TZ means $WANT_CLOCK —"
      log "   every sweep is firing at the wrong hour. Check /usr/share/zoneinfo in it."
    fi
  fi
  MISSING="$(missing_env_keys)"
  if [ -n "$MISSING" ]; then
    log "!! .env.example declares keys the live .env does not set: $MISSING"
  fi
  BAD_STORAGE="$(throwaway_storage_driver)"
  if [ -n "$BAD_STORAGE" ]; then
    log "!! object storage is running off the container disk: $BAD_STORAGE"
    log "   Nothing mounts a volume for it, so every PoD photo, avatar and product image"
    log "   written this way dies with the next deploy, and its URL serves nothing."
    log "   Fix: set STORAGE_DRIVER=s3 in .env and recreate the affected services."
    alert "STORAGE_DRIVER is not s3 ($BAD_STORAGE) — uploads are going to disposable container disk"
  fi
  # Alertmanager reads its destination from a file the operator creates (it is a secret,
  # so it is not in the repo). Without it every alert is routed, rendered and dropped —
  # silently, because a monitoring stack that alerts nobody looks exactly like a quiet
  # week. It was in that state on this box from the day monitoring shipped.
  if [ ! -s ops/alertmanager.webhook-url ]; then
    log "!! ops/alertmanager.webhook-url is empty — every Prometheus alert goes nowhere."
    log "   Fix: printf '%s' \"\$ALERT_WEBHOOK_URL\" > ops/alertmanager.webhook-url && \\"
    log "        $COMPOSE restart alertmanager"
  fi
  # G1 — a bucket policy can be reset from the provider console, and nothing would say so.
  # Measured 2026-08-17: hydromart-pod and hydromart-products answered 200 to an anonymous
  # `?list-type=2`, handing a stranger the index of every proof-of-delivery photo. Serving
  # an object to whoever holds its URL is the intent; serving the index is not. Asked the
  # way an outsider asks — no credentials — because that is the only answer that matters.
  #
  # Bucket names come from the .env keys themselves (`AUTH_`/`DELIVERY_`/`PRODUCT_`/`HR_`
  # prefixed on this box), not from a list in here, so a new bucket is covered the day it
  # is configured rather than the day somebody remembers this check.
  #
  # It reports what it ASKED, not only what it found. A probe that prints nothing when it
  # passes is indistinguishable from a probe that never ran — which is exactly how the
  # watchdog below stayed blind for seven days while every deploy said OK.
  OPEN_BUCKETS=""
  CHECKED_BUCKETS=""
  S3_ENDPOINT="$(tr -d '\r' < .env 2>/dev/null | sed -n 's/^STORAGE_S3_ENDPOINT=//p' | head -1 || true)"
  if [ -n "$S3_ENDPOINT" ]; then
    for bucket in $(storage_buckets); do
      LIST_CODE="$(curl -s -o /dev/null -m 15 -w '%{http_code}' "${S3_ENDPOINT%/}/$bucket?list-type=2&max-keys=1" || true)"
      CHECKED_BUCKETS="$CHECKED_BUCKETS $bucket:$LIST_CODE"
      [ "$LIST_CODE" = "200" ] && OPEN_BUCKETS="$OPEN_BUCKETS $bucket"
    done
    if [ -n "$CHECKED_BUCKETS" ]; then
      log "anonymous bucket LIST probe (bucket:http) —$CHECKED_BUCKETS"
    else
      log "!! STORAGE_S3_ENDPOINT is set but storage_buckets() named no bucket: nothing was probed."
    fi
  else
    log "!! no STORAGE_S3_ENDPOINT in .env — the anonymous-listing probe did not run at all."
  fi
  if [ -n "$OPEN_BUCKETS" ]; then
    log "!! anonymous LIST is OPEN on:$OPEN_BUCKETS"
    log "   Anyone can enumerate every object key in those buckets — for hydromart-pod that"
    log "   is recipient signatures, faces and house fronts (UU 27/2022 personal data)."
    log "   Fix: bash scripts/storage-policy.sh"
    alert "anonymous bucket listing is open on:$OPEN_BUCKETS"
  fi
  # G2 — the watchdog spent ~7 days logging `./.env: line 115: PRIVATE: not found` 2130
  # times because the host crontab sourced .env by EXECUTING it, so every variable after
  # the unquoted PEM was never exported. The repo fix existed the whole time and had simply
  # never been installed. A silent watchdog looks exactly like a quiet week, so the deploy
  # asks the host crontab directly rather than trusting that somebody ran the installer.
  # Install them, rather than ask whether somebody did.
  #
  # `install-host-cron.sh` is idempotent by construction — its own header says so: the block
  # is delimited by markers and replaced wholesale. And yet the box has now been caught TWICE
  # running an out-of-date copy of it:
  #
  #   2026-08-25  three weekly safety scripts from #323 were in the repo, in the installer,
  #               and had never once run
  #   2026-08-27  backup-offsite.sh and check-backup-freshness.sh, added with the CMP work,
  #               same story — the deploy reported them missing and nothing installed them
  #
  # The second time is the answer to the first. Adding a line to the installer does nothing
  # until a human SSHes in and re-runs it, so "scheduled" meant "scheduled in git". A step
  # that must be remembered is a step that will be forgotten, and it was — including by the
  # people who wrote the probe that noticed.
  #
  # Tolerant of its own failure, deliberately: a box with no `crontab` binary, or a locked
  # crontab, must not abort a deploy that is otherwise fine. The probe below is what stays
  # strict — and it now measures what this line just did rather than what somebody once did.
  if [ -f scripts/install-host-cron.sh ]; then
    if bash scripts/install-host-cron.sh >/dev/null 2>&1; then
      log "host cron installed/updated from scripts/install-host-cron.sh"
    else
      log "!! could not install the host crontab — the probe below will say what is missing."
      alert "install-host-cron.sh failed on deploy; host cron jobs may be stale"
    fi
  fi

  HOST_CRON="$(crontab -l 2>/dev/null || true)"
  if printf '%s' "$HOST_CRON" | grep -q 'set -a'; then
    log "!! the host crontab still sources .env by EXECUTING it (\`set -a; . ./.env\`)."
    log "   An unquoted value with spaces aborts the shell, and everything declared after"
    log "   it never reaches the job. Fix: bash scripts/install-host-cron.sh"
    alert "host crontab still executes .env — watchdog/backup run on a truncated environment"
  elif ! printf '%s' "$HOST_CRON" | grep -q 'scripts/watchdog.sh'; then
    log "!! the host crontab has no watchdog line — nothing converges a container that"
    log "   stops between deploys. Fix: bash scripts/install-host-cron.sh"
    alert "host crontab has no watchdog line"
  fi
  # MEASURED 2026-08-25 by `scripts/ask-the-box.sh`: the installer schedules SIX jobs and the
  # box's crontab had THREE. Missing were check-tls-expiry.sh, check-log-retention.sh and
  # rollback-drill.sh — the three weekly safety scripts added in #323. They were in the repo,
  # they were in the installer, and they had never once run.
  #
  # The probe above could not see that, and that is the actual defect: it asks two questions
  # (does the crontab still execute .env, is the watchdog line there) and answers "fine" to
  # everything else. So every cron job added after the watchdog inherited a deploy that
  # reported health while the job did not exist. A check that passes when its subject is
  # absent is the shape this repo keeps finding.
  #
  # The expected list is DERIVED from the installer rather than restated here, so the next
  # job added to it is covered without anyone remembering to update this.
  if [ -n "$HOST_CRON" ] && [ -f scripts/install-host-cron.sh ]; then
    CRON_MISSING=""
    for want in $(grep -oE 'bash scripts/[a-z-]+\.sh' scripts/install-host-cron.sh |
                    sed 's|bash scripts/||' | sort -u |
                    grep -v '^install-host-cron\.sh$'); do
      printf '%s' "$HOST_CRON" | grep -q "scripts/$want" || CRON_MISSING="$CRON_MISSING $want"
    done
    if [ -n "$CRON_MISSING" ]; then
      log "!! the host crontab is missing jobs the installer schedules:$CRON_MISSING"
      log "   These do not run at all — a weekly check that was never installed looks exactly"
      log "   like a weekly check that keeps passing. Fix: bash scripts/install-host-cron.sh"
      alert "host crontab missing scheduled jobs:$CRON_MISSING"
    fi
  fi
  if [ -z "$HOST_CRON" ]; then
    # An empty read is not a clean crontab. Saying so beats reporting silence as health.
    log "!! 'crontab -l' returned nothing, so this probe asked nothing. Check the deploy"
    log "   user's crontab access before reading the absence of findings as good news."
  else
    log "host crontab probe — $(printf '%s\n' "$HOST_CRON" | grep -c 'scripts/') repo job(s) scheduled, watchdog present, .env sourced (not executed)"
  fi

  # ---------------------------------------------------------------- three standing proofs
  #
  # Each of these was a line in a verification checklist: something a person was supposed to
  # ssh in and confirm, once, after a release. A checklist item that needs a human is an item
  # that is true on the day somebody checks it and unknown every other day — and all three of
  # these describe states that can come BACK.
  #
  # So they are asked on every deploy, and each one says what it ASKED, not only what it
  # found. Silence proves nothing; that lesson cost seven blind watchdog days.

  # 1. The outbox must DRAIN. A queue that only grows is a set of events nobody downstream
  # ever received — loyalty points not awarded, notifications never sent — and from outside
  # it looks exactly like a quiet week.
  PG="${PG_CONTAINER:-hydromart-postgres}"
  if docker exec "$PG" true >/dev/null 2>&1; then
    OUTBOX="$(docker exec "$PG" psql -U hydromart -d hydromart_order -tAc \
      "SELECT coalesce(string_agg(status || '=' || n, ' '), 'empty') FROM (SELECT status, count(*) AS n FROM outbox_messages GROUP BY 1) t" 2>/dev/null || echo 'unreadable')"
    log "outbox_messages probe — $OUTBOX"
    if [ "$OUTBOX" = "unreadable" ]; then
      # This probe asked `order_outbox` for its whole life. No such table has ever existed;
      # it is `outbox_messages`. So every deploy printed "unreadable" and then skipped the
      # alert below, because PENDING is parsed out of the answer and there was no answer. The
      # check whose entire point is that a queue which only grows looks exactly like a quiet
      # week proved nothing at all, quietly, from the day it was written.
      #
      # An unreadable answer is now a FINDING. A probe that cannot read is not a probe.
      log "!! the outbox could not be read; this check is proving NOTHING until that is fixed."
      alert "outbox probe cannot read outbox_messages - the drain check is blind"
    fi
    PENDING="$(printf '%s' "$OUTBOX" | sed -n 's/.*PENDING=\([0-9]*\).*/\1/p')"
    if [ -n "$PENDING" ] && [ "$PENDING" -gt "${OUTBOX_PENDING_ALERT:-100}" ]; then
      log "!! $PENDING event(s) PENDING in outbox_messages — the dispatcher is not draining it."
      alert "outbox_messages has $PENDING pending events — downstream effects are not happening"
    fi
  else
    log "!! cannot reach the Postgres container ($PG) — the outbox was NOT probed."
  fi

  # 1b. The PR-J fit trigger, because a threshold written in a comment tells nobody.
  #
  # The forecast machinery is built and the heuristic runs; a FITTED model waits on data, and
  # the plan named the number: 90 days of completed orders AND at least 200 of them, per
  # depot. Nothing watched it. "It will happen by itself" was true of the heuristic and false
  # of the trigger — a comment does not notice a depot crossing a line.
  #
  # Read off depot_daily_revenue, which order-service feeds on COMPLETED: one row per depot
  # per day carrying that day's order count, so both halves of the trigger are one query.
  if docker exec "$PG" true >/dev/null 2>&1; then
    READY="$(docker exec "$PG" psql -U hydromart -d hydromart_forecast -tAc       "SELECT coalesce(string_agg(depot_id::text || ' (' || days || 'd/' || orders || ')', ', '), 'none')
         FROM (SELECT depot_id, count(*) AS days, sum(order_count) AS orders
                 FROM depot_daily_revenue WHERE depot_id IS NOT NULL GROUP BY 1) t
        WHERE days >= ${FIT_TRIGGER_DAYS:-90} AND orders >= ${FIT_TRIGGER_ORDERS:-200}" 2>/dev/null || echo 'unreadable')"
    if [ "$READY" = "none" ] || [ "$READY" = "unreadable" ]; then
      log "forecast fit trigger — no depot has ${FIT_TRIGGER_DAYS:-90}d + ${FIT_TRIGGER_ORDERS:-200} orders yet; the heuristic keeps running"
    else
      log "forecast fit trigger REACHED — $READY"
      log "   A fitted model is now worth ATTEMPTING for those depots, not switching on:"
      log "   run scripts/forecast-eval.mjs and let it beat the baseline on held-out data first."
      alert "forecast fit trigger reached: $READY — a candidate model can finally be measured"
    fi
  fi

  # 1b. A depot with nowhere for money to land.
  #
  # `apps/web/src/lib/payments.ts:66-70` hides TRANSFER when there is no bank account and QRIS
  # when there is no image, and never filters CASH. So a depot with all four columns blank
  # sells perfectly quietly — cash only, no error anywhere, and nothing on any screen says the
  # other two methods were removed rather than declined.
  #
  # The check that would have said so ALREADY EXISTS: check-launch-blockers.mjs L2.3 asks this
  # exact question. It has never run here — `grep -n check-launch-blockers scripts/` finds it
  # only in the script itself and its self-test. Measured on 2026-08-29: all three production
  # depots returned `acceptsTransfer:false, acceptsQris:false`, and nobody had been told.
  #
  # Same fixture exclusion as the gate, so the demo depot and test rows do not cry wolf.
  if docker exec "$PG" true >/dev/null 2>&1; then
    NOPAY="$(docker exec "$PG" psql -U hydromart -d hydromart_depot -tAc       "SELECT coalesce(string_agg(code, ', ' ORDER BY code), '') FROM depots
        WHERE active
          AND code !~ '^(E2E|UAT|HIER|DEMO)-'
          AND coalesce(nullif(trim(\"paymentBankAccountNumber\"), ''), nullif(trim(\"paymentQrisImageUrl\"), '')) IS NULL" 2>/dev/null || echo 'unreadable')"
    if [ "$NOPAY" = "unreadable" ]; then
      # An unreadable answer is a finding, not a pass — the outbox probe above learned that
      # the hard way, printing "unreadable" for its whole life and proving nothing.
      log "!! the depot payment probe could not read hydromart_depot; it is proving NOTHING."
      alert "depot payment probe cannot read hydromart_depot - the payable check is blind"
    elif [ -n "$NOPAY" ]; then
      log "!! depot payment probe — these active depots have NO payment destination: $NOPAY"
      log "   Customers there are offered CASH only: transfer and QRIS are hidden, not refused,"
      log "   so nothing on any screen says a method was removed."
      log "   Fix: /dashboard/depots as MANAGER or SUPER_ADMIN (that screen has the real QRIS"
      log "   uploader; the HQ form only takes a raw URL and will happily save one that 404s)."
      alert "depots with no payment destination: $NOPAY - cash only, silently"
    else
      log "depot payment probe — every active depot has a bank account or a QRIS image"
    fi
  fi

  # 1c. A franchise depot with no commission scheme.
  #
  # The detector in order-service alerts when an ORDER books 0% — but only once an order has
  # been placed. This asks the question before that: which active WARALABA depots have no
  # `commission_schemes` row at all. `check-launch-blockers.mjs` already performs exactly this
  # query and, like L2.3, has never run on the box.
  #
  # Two databases, so two queries and the join is here. hydromart_payout keys schemes by
  # depotId; hydromart_depot knows which depots are franchises.
  if docker exec "$PG" true >/dev/null 2>&1; then
    FRANCHISE="$(docker exec "$PG" psql -U hydromart -d hydromart_depot -tAc       "SELECT coalesce(string_agg(id::text || '=' || code, ',' ORDER BY code), '') FROM depots
        WHERE active AND \"ownershipType\" = 'WARALABA' AND code !~ '^(E2E|UAT|HIER|DEMO)-'" 2>/dev/null || echo 'unreadable')"
    if [ "$FRANCHISE" = "unreadable" ]; then
      log "!! the franchise commission probe could not read hydromart_depot; it is proving NOTHING."
      alert "franchise commission probe cannot read hydromart_depot"
    elif [ -z "$FRANCHISE" ]; then
      log "franchise commission probe — no active WARALABA depot yet, so nothing to cover"
    else
      SCHEMED="$(docker exec "$PG" psql -U hydromart -d hydromart_payout -tAc         "SELECT coalesce(string_agg(DISTINCT \"depotId\"::text, ','), '') FROM commission_schemes" 2>/dev/null || echo '')"
      UNCOVERED=''
      for PAIR in $(printf '%s' "$FRANCHISE" | tr ',' ' '); do
        DID="${PAIR%%=*}"
        case ",$SCHEMED," in
          *",$DID,"*) ;;
          *) UNCOVERED="$UNCOVERED ${PAIR#*=}" ;;
        esac
      done
      if [ -z "$UNCOVERED" ]; then
        log "franchise commission probe — every active WARALABA depot has a commission scheme"
      else
        log "!! franchise depots with NO commission_schemes row:$UNCOVERED"
        log "   payout falls back to 0%, so HQ takes nothing and the ledger still balances —"
        log "   there is no broken thing to notice, only money that never arrived."
        alert "franchise depots with no commission scheme:$UNCOVERED - HQ is taking 0%"
      fi
    fi
  fi

  # 1d. Which face verifier is actually running, and whether it can work.
  #
  # `FACE_VERIFIER_DRIVER` defaults to `onnx` in three places at once — the Joi schema
  # (hr-service/src/config/env.validation.ts:53), this stack's compose default
  # (docker-compose.prod.yml:593), and .env.production.example:80 — while the comment right
  # above the compose line says production is meant to be `neo`. No `.onnx` file is committed
  # to this repo and nothing downloads one, so a box that took the default answers 503 on
  # every face enrolment and every check-in, quietly, with attendance simply not working.
  #
  # Nothing measured which of those it was. This asks the container.
  if $COMPOSE ps --status running --services 2>/dev/null | grep -qx hr; then
    FACE_DRIVER="$($COMPOSE exec -T hr printenv FACE_VERIFIER_DRIVER 2>/dev/null | tr -d '\r\n' || true)"
    case "${FACE_DRIVER:-onnx}" in
      onnx)
        MODEL="$($COMPOSE exec -T hr printenv HR_FACE_MODEL_PATH 2>/dev/null | tr -d '\r\n' || true)"
        MODEL="${MODEL:-./models/arcface.onnx}"
        if $COMPOSE exec -T hr sh -c "[ -f '$MODEL' ]" >/dev/null 2>&1; then
          log "face verifier probe — driver 'onnx', model present at $MODEL"
        else
          log "!! face verifier is 'onnx' and the model is NOT at $MODEL inside hr."
          log "   Every face enrolment and every attendance check-in answers 503, silently:"
          log "   staff cannot clock in at all. Either ship the model to that path or set"
          log "   FACE_VERIFIER_DRIVER=neo in .env and recreate hr."
          alert "face verifier onnx has no model at $MODEL - attendance check-in is dead"
        fi
        ;;
      neo|http)
        log "face verifier probe — driver '$FACE_DRIVER' (remote gallery, no local model needed)"
        ;;
      stub)
        # `stub` accepts any frame. Fine on a laptop, and a hole on a real box: it turns the
        # biometric gate into a formality nobody is told about.
        log "!! face verifier is 'stub' — it ACCEPTS ANY FACE. Attendance proves nothing."
        alert "face verifier is 'stub' on this deployment - the biometric check accepts anyone"
        ;;
      *)
        log "!! face verifier driver is '$FACE_DRIVER', which hr-service does not recognise"
        alert "unknown FACE_VERIFIER_DRIVER '$FACE_DRIVER'"
        ;;
    esac
  fi

  # 1e. /metrics, asked of the SERVER.
  #
  # scripts/check-public-metrics.mjs has always supported `--url`, and its own header says why:
  # "a config that is not deployed protects nothing". CI runs it without one (ci.yml), so for
  # two days it read the Caddyfile on disk, found the block, and passed — while
  # `curl https://api.hydromart-digital.com/metrics` answered 200 with 404 KB of the platform's
  # traffic: request counts by route and status, install counts per build, heap and event-loop
  # figures. The block was committed on 2026-08-27 and never reached the container, because the
  # Caddyfile was bind-mounted as a single FILE and the mount pinned the old inode.
  #
  # CI cannot reach production. This can, and it runs after the release is live, which is the
  # only moment the answer means anything.
  API_HOST="$(tr -d '\r' < .env 2>/dev/null | sed -n 's/^API_DOMAIN=//p' | head -1 || true)"
  WEB_HOST="$(tr -d '\r' < .env 2>/dev/null | sed -n 's/^WEB_DOMAIN=//p' | head -1 || true)"
  if [ -n "$API_HOST" ]; then
    if node scripts/check-public-metrics.mjs --url "https://$API_HOST" >/tmp/metrics-probe.log 2>&1; then
      log "public /metrics probe — https://$API_HOST/metrics is not reachable from the internet"
    else
      log "!! /metrics IS reachable from the internet at https://$API_HOST/metrics"
      sed 's/^/   /' /tmp/metrics-probe.log | head -12
      alert "public /metrics is answering on https://$API_HOST - the platform's traffic is readable by anybody"
    fi
    rm -f /tmp/metrics-probe.log
  else
    log "!! API_DOMAIN is unset, so nothing checked whether /metrics is public."
    alert "API_DOMAIN unset - the public /metrics check could not run"
  fi


  # 1f. Sentry: is the browser ALLOWED to reach the host the DSN names?
  #
  # Every Sentry check here used to ask .env whether a string was non-empty, and that is a
  # different question. Measured 2026-08-31: the web DSN was set, the SDK downloaded, init()
  # succeeded, and every report was refused by the BROWSER — the CSP allowed
  # `*.ingest.sentry.io` while the DSN was an EU-region `*.ingest.DE.sentry.io`, and a CSP
  # wildcard matches one label. Nothing anywhere was red for a day.
  #
  # Deliberately NOT claiming the key is valid: Sentry's SaaS ingest accepts optimistically
  # and answers 200 for a wrong key AND a wrong project id, on both /envelope/ and /store/.
  # Measured, so this probe does not pretend otherwise.
  WEB_DSN="$(tr -d '\r' < .env 2>/dev/null | sed -n 's/^SENTRY_DSN_WEB=//p' | head -1 || true)"
  if [ -z "$WEB_DSN" ]; then
    log "sentry probe — SENTRY_DSN_WEB is unset, so browser crashes reach nobody (build arg: needs a rebuild once set)"
  elif [ -z "$WEB_HOST" ]; then
    log "!! SENTRY_DSN_WEB is set but WEB_DOMAIN is not, so the CSP pairing could not be checked."
  else
    CSP_CONNECT="$(curl -fsS -m 10 -D - -o /dev/null "https://$WEB_HOST/" 2>/dev/null |
      grep -aoiE 'connect-src [^;]*' | sed 's/connect-src //' || true)"
    if [ -z "$CSP_CONNECT" ]; then
      log "!! could not read the CSP from https://$WEB_HOST — the Sentry pairing is unchecked."
    elif node scripts/check-sentry-reachable.mjs --dsn "$WEB_DSN" --csp "$CSP_CONNECT" >/tmp/sentry-probe.log 2>&1; then
      log "sentry probe — the web DSN host is reachable and permitted by this site's CSP"
    else
      log "!! the web Sentry DSN cannot deliver — browser reports are being dropped:"
      sed 's/^/   /' /tmp/sentry-probe.log | head -8
      alert "web Sentry reports are being dropped on $WEB_HOST - the DSN host is unreachable or blocked by the CSP"
    fi
    rm -f /tmp/sentry-probe.log
  fi

  # 2. Web push is dead without VAPID, and dead silently: subscribing just never succeeds.
  # Presence only, never the value.
  #
  # BOTH keys, not just the public one. This probed VAPID_PUBLIC_KEY alone and reported
  # "web push probe — VAPID_PUBLIC_KEY is set inside crm", which is true and beside the
  # point: the adapter no-ops when EITHER key is blank, so a box with a public key and no
  # private one got a green line about a channel that could not send. The private half is
  # also the one more likely to be missing — it is the secret, so it is the one left out of
  # a hand-copied .env.
  VAPID_MISSING=''
  for V in VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY; do
    if ! $COMPOSE exec -T crm sh -c "[ -n \"\${$V:-}\" ]" >/dev/null 2>&1; then
      VAPID_MISSING="$VAPID_MISSING $V"
    fi
  done
  if [ -z "$VAPID_MISSING" ]; then
    log "web push probe — both VAPID keys are set inside crm"
  else
    log "!! Web push is DEAD inside the crm container — missing:$VAPID_MISSING"
    log "   This is the BROWSER transport only; Android is probed separately below."
    log "   Fix: set them in .env and recreate crm (deploy mode env-set)."
    alert "VAPID credentials missing in crm —$VAPID_MISSING — web push is dead"
  fi

  # 2a. The OTP channel, probed on the box — because nothing did.
  #
  # scripts/check-launch-blockers.mjs asks this question of the REPO's .env, on a laptop, and
  # is never executed here. So the one credential pair that stands between a stranger and an
  # account had no measurement anywhere near production. auth-service refuses to BOOT on
  # `console` under NODE_ENV=production, so a running stack proves the channel is not console
  # — it proves nothing about whether the credentials are usable.
  #
  # Presence only, never the value. This cannot tell you Zenziva ACCEPTS them; only a real SMS
  # to a real handset can. It tells you the two halves are there, which is the failure that
  # ships silently: blank credentials used to pass validation (the `when` branch concat'ed
  # `.required()` onto a base that allowed ''), boot green, and fail at the first send.
  OTP_CHANNEL="$(tr -d '\r' < .env 2>/dev/null | sed -n 's/^OTP_DELIVERY_CHANNEL=//p' | head -1 || true)"
  case "$OTP_CHANNEL" in
    zenziva) OTP_KEYS='ZENZIVA_USERKEY ZENZIVA_PASSKEY' ;;
    sms) OTP_KEYS='SMS_API_BASE_URL SMS_API_TOKEN' ;;
    *) OTP_KEYS='' ;;
  esac
  if [ -z "$OTP_CHANNEL" ] || [ "$OTP_CHANNEL" = console ]; then
    log "!! OTP_DELIVERY_CHANNEL is '${OTP_CHANNEL:-unset}' — the code is only PRINTED to the"
    log "   container log, so anyone who can read logs can sign in as any customer."
    alert "OTP channel is '${OTP_CHANNEL:-unset}' in .env — OTP codes are only logged, not sent"
  else
    OTP_MISSING=''
    for V in $OTP_KEYS; do
      if ! $COMPOSE exec -T auth sh -c "[ -n \"\${$V:-}\" ]" >/dev/null 2>&1; then
        OTP_MISSING="$OTP_MISSING $V"
      fi
    done
    if [ -z "$OTP_MISSING" ]; then
      log "otp probe — channel '$OTP_CHANNEL', both credentials set inside auth"
    else
      log "!! OTP is DEAD inside the auth container — channel '$OTP_CHANNEL' missing:$OTP_MISSING"
      log "   Nobody can register or sign in. Fix: set them in .env and recreate auth."
      alert "OTP credentials missing in auth —$OTP_MISSING — nobody can sign in"
    fi
  fi

  # 2b. CMP-05 — Android push, probed the same way, and until now not probed at all.
  #
  # The line above used to end with "Android FCM is unaffected", which is a claim, not a
  # measurement: nothing anywhere read FCM_PROJECT_ID / FCM_CLIENT_EMAIL / FCM_PRIVATE_KEY,
  # and all three default to blank. Blank disables the Android transport exactly the way
  # blank VAPID keys disable the browser one — silently, in the adapter. So the deploy could
  # print a reassurance about the one channel it had never looked at.
  #
  # That matters more than the browser half. WhatsApp and SMS are gone as transactional
  # channels, and the customer app is an Android WebView: push is the only way an order
  # update reaches somebody who does not have the app open.
  #
  # Presence only, never the value — a service-account private key must not reach a log.
  # All three, because two out of three is still a dead transport, and the private key is
  # the one most likely to be dropped (a PEM through a .env survives only escaped).
  FCM_MISSING=''
  for V in FCM_PROJECT_ID FCM_CLIENT_EMAIL FCM_PRIVATE_KEY; do
    if ! $COMPOSE exec -T crm sh -c "[ -n \"\${$V:-}\" ]" >/dev/null 2>&1; then
      FCM_MISSING="$FCM_MISSING $V"
    fi
  done
  if [ -z "$FCM_MISSING" ]; then
    log "android push probe — all three FCM service-account variables are set inside crm"
  else
    log "!! Android push is DEAD inside the crm container — missing:$FCM_MISSING"
    log "   Blank disables the FCM transport in the adapter, with no error anywhere. With"
    log "   WhatsApp and SMS retired, this is the only channel that reaches a customer who"
    log "   does not have the app open — every order update simply never arrives."
    log "   Fix: set them in .env and recreate crm (deploy mode env-set). FCM_PRIVATE_KEY"
    log "   must keep its \n escapes; a raw PEM does not survive a .env file."
    alert "FCM credentials missing in crm —$FCM_MISSING — Android push is dead"
  fi

  # 2c. N2's other half — the WEB build.
  #
  # mobile.yml refuses to publish an APK when SENTRY_DSN_MOBILE is unset, and that check is
  # real. The web image had no equivalent: `NEXT_PUBLIC_SENTRY_DSN: ${SENTRY_DSN_WEB:-}` in
  # docker-compose.prod.yml means an unset variable bakes an EMPTY string into the bundle,
  # `sentry-init.tsx` then never even downloads the SDK, and the site runs with no error
  # reporting at all. Nothing anywhere said so.
  #
  # `missing_env_keys` cannot see it: it compares KEY PRESENCE against .env.example, and
  # SENTRY_DSN_WEB is present there — as `SENTRY_DSN_WEB=`, empty. A key that exists with no
  # value is exactly the shape that passes a presence check and ships a dead feature.
  #
  # Read from the RUNNING IMAGE. Measure the baked value, then say where to change it.
  #
  # The reading is right and the ADVICE here has now been wrong twice, in opposite directions,
  # so the mechanism is worth stating once and precisely.
  #
  # This box BUILDS its images. `registry_mode()` (scripts/lib/deploy-common.sh:37) is
  # `[ -n "${IMAGE_PREFIX:-}" ]`, IMAGE_PREFIX is empty here, so deploy.sh takes the local
  # branch: rebuild-stale.sh:75 runs `$COMPOSE build`, and every deploy that touches web prints
  # `rebuilding: web`. `docker compose build` reads
  # `NEXT_PUBLIC_SENTRY_DSN: ${SENTRY_DSN_WEB:-}` (docker-compose.prod.yml:694) straight out of
  # THIS .env. So .env is exactly the right place, and the rebuild is what applies it.
  #
  # .github/workflows/images.yml:148 also builds a web image, from the repo VARIABLE
  # `vars.SENTRY_DSN_WEB` — and that variable does not exist. True, and irrelevant while
  # IMAGE_PREFIX is empty: those images go to GHCR and this box never pulls them. It becomes
  # the operative fix the day registry mode is switched on, and not before.
  #
  # Reading the container rather than .env is still the better MEASUREMENT: apps/web/
  # Dockerfile:29 does `ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN`, so this answers
  # "does the image that is RUNNING report errors" instead of "is there a string in a file" —
  # the difference between a value that was set and a value that was applied.
  if $COMPOSE exec -T web sh -c '[ -n "${NEXT_PUBLIC_SENTRY_DSN:-}" ]' >/dev/null 2>&1; then
    log "web error reporting probe — the running web image has a Sentry DSN baked in"
  else
    log "!! the running web image has NEXT_PUBLIC_SENTRY_DSN EMPTY, so the Sentry SDK is never"
    log "   loaded and every client-side crash on the site is invisible."
    log "   Fix: set SENTRY_DSN_WEB in THIS .env, then deploy - this box builds its own images"
    log "   (IMAGE_PREFIX is empty, so rebuild-stale runs compose build) and the build reads it"
    log "   from here. A restart alone will not do it: it is a build arg, not a runtime one."
    log "   The GitHub repo variable of the same name only matters in registry mode."
    alert "the running web image has no Sentry DSN — client-side crashes are invisible (audit N2)"
  fi

  # 3. SPACE — the only failure here that destroys DATA rather than uptime.
  #
  # One disk carries Postgres, all 14 nightly dumps (backup-db.sh BACKUP_KEEP=14), nineteen
  # service images and the Prometheus TSDB. A full disk on the machine that holds both the
  # database and its own backups cannot be recovered from on that machine — there is no
  # second copy to reach for and no room to write one.
  #
  # PARTLY ALREADY BUILT, and that is the point. ask-the-box.sh:200-230 asks exactly this and
  # already judges it at 85/95 — it is a MANUAL tool: ci.yml runs only its self-test and
  # registry-check.yml offers it as a button somebody presses. A judgement a human must ssh in
  # to read is the category that left three weekly safety scripts in the installer, unrun, for
  # months. So the same two questions are asked here, on a schedule that exists, by something
  # that can `alert` — which is the one thing ask-the-box.sh cannot do.
  #
  # The thresholds are ITS numbers, deliberately not new ones: 95% = Postgres is about to
  # refuse writes (WAL needs room to land well before a filesystem reaches 100%), 85% = order
  # a bigger disk this week, because nothing on this box trims itself except that 14-dump
  # window. The third test is the one a percentage cannot express: the weekly restore drill
  # materialises a SECOND full copy of the cluster in a scratch container on this same disk,
  # and a migrating deploy writes a full dump on top of that — so free space below 2x the
  # database size means the recovery path does not fit, at any percentage.
  #
  # ponytail: `/` like every other df in this repo, and no growth rate. A rate needs history
  # this script does not keep; printing both numbers every deploy is what puts that history
  # in the deploy log, where the date it fills up can finally be read off.
  DISK_AVAIL_KB="$(df -Pk / 2>/dev/null | awk 'NR==2{print $4}' || true)"
  DISK_USED_PCT="$(df -Pk / 2>/dev/null | awk 'NR==2{gsub(/%/,"",$5); print $5}' || true)"
  DB_TOTAL_KB=""
  DB_PRETTY="unreadable"
  if docker exec "$PG" true >/dev/null 2>&1; then
    DB_SIZE="$(docker exec "$PG" psql -U hydromart -d postgres -tAc       "SELECT coalesce(sum(pg_database_size(datname)),0)/1024 || '|' || pg_size_pretty(coalesce(sum(pg_database_size(datname)),0)) || ' in ' || count(*) || ' db' FROM pg_database WHERE datname LIKE 'hydromart%'"       2>/dev/null | tr -d '\r\n' || true)"
    DB_TOTAL_KB="${DB_SIZE%%|*}"
    [ "$DB_SIZE" != "${DB_SIZE#*|}" ] && DB_PRETTY="${DB_SIZE#*|}"
  fi
  if [ -z "${DISK_AVAIL_KB:-}" ]; then
    # A probe that cannot read is not a probe — the outbox lesson, one section up.
    log "!! disk probe — df returned nothing, so free space was NOT measured on this box."
  else
    log "disk probe — $((DISK_AVAIL_KB / 1024)) MB free on / (${DISK_USED_PCT:-?}% used), databases $DB_PRETTY"
    DISK_FINDING=""
    if [ "${DISK_USED_PCT:-0}" -ge 95 ]; then
      DISK_FINDING="CRITICAL: under 5% free on / — Postgres refuses writes before the disk reaches 100%"
    elif [ "${DISK_USED_PCT:-0}" -ge 85 ]; then
      DISK_FINDING="over 85% used on / — nothing here trims itself except the 14-dump window"
    elif [ -n "${DB_TOTAL_KB:-}" ] && [ "${DB_TOTAL_KB:-0}" -gt 0 ] &&
         [ "$DISK_AVAIL_KB" -lt "$((DB_TOTAL_KB * 2))" ]; then
      DISK_FINDING="free space is under 2x the database size — the weekly restore drill and the pre-migration dump both need a full second copy, and neither would fit"
    fi
    if [ -n "$DISK_FINDING" ]; then
      log "!! $DISK_FINDING"
      log "   This disk holds the database AND every backup of it. Free some: bash scripts/docker-gc.sh"
      alert "disk on $(hostname 2>/dev/null || echo box): $DISK_FINDING (databases $DB_PRETTY)"
    fi
    if [ "$DB_PRETTY" = "unreadable" ]; then
      log "!! the database sizes could not be read, so 'does a restore still fit' was not asked."
    fi
  fi

  # 4. The secrets no compose file passes, and the one whose EMPTINESS is the fault.
  #
  # missing_env_keys() compares .env.example against the box's .env and then drops every key
  # no compose file interpolates (compose_ignores_env, deploy-common.sh:374). That narrowing is
  # right — a key compose never reads is a key .env has no say over — and it leaves a blind
  # spot with a short list on it: BACKUP_OFFSITE_DEST and BACKUP_S3_* are read by scripts
  # (backup-offsite.sh, backup-db.sh) and by nothing in compose, so NO amount of listing them
  # in .env.example can make that gate see them. Only a probe that reads .env directly can,
  # exactly as the storage-driver check above already does.
  #
  # ALERT_WEBHOOK_URL is a second shape of the same hole. It is now in .env.example and compose
  # does pass it, so the gate can report it ABSENT — but that gate compares key PRESENCE, and
  # `ALERT_WEBHOOK_URL=` present-and-empty is precisely the state in which every alarm in this
  # system is raised, rendered and dropped. Emptiness is what matters for all four.
  #
  # Deliberately does NOT alert: these are standing configuration gaps only a human can close,
  # and an alarm that fires on every deploy about a state nobody can fix from here is the
  # warning-nobody-reads trap this repo has already paid for twice. There is also a joke in the
  # first line — an empty ALERT_WEBHOOK_URL is the one finding that cannot possibly be alerted
  # about, which is why it is stated in the deploy log instead.
  OPS_EMPTY=""
  for key in ALERT_WEBHOOK_URL BACKUP_OFFSITE_DEST BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY; do
    if [ -z "$(tr -d '\r' < .env 2>/dev/null | sed -n "s/^${key}=//p" | head -1)" ]; then
      OPS_EMPTY="$OPS_EMPTY $key"
    fi
  done
  if [ -z "$OPS_EMPTY" ]; then
    log "ops secrets probe — alert destination and offsite backup credentials are all set"
  else
    log "!! ops secrets probe — EMPTY in .env:$OPS_EMPTY"
    case "$OPS_EMPTY" in
      *ALERT_WEBHOOK_URL*)
        log "   ALERT_WEBHOOK_URL   no alert of any kind reaches a person — 5xx, watchdog,"
        log "                       backup failure and restore drill all land in a log file." ;;
    esac
    case "$OPS_EMPTY" in
      *BACKUP_OFFSITE_DEST*)
        log "   BACKUP_OFFSITE_DEST every copy of the database is on the disk the database is on." ;;
    esac
    case "$OPS_EMPTY" in
      *BACKUP_S3_*)
        log "   BACKUP_S3_*         the offsite job cannot authenticate even once DEST is set." ;;
    esac
  fi

  # 5. The Play reviewer must not be a real employee. REVIEWER_PHONE granted a stranger
  # holding a fixed OTP the account of a KEPALA_DEPOT at a depot with real customers on it —
  # their names, addresses and phone numbers. `scripts/seed-demo-depot.mjs` builds the
  # account they should get; this is the check that somebody pointed the variable at it.
  # REVIEWER_PHONE is a comma-separated LIST — that is how the demo customer gets a fixed
  # OTP alongside the demo staff account. Compare the first entry, which is what every
  # consumer of this variable treats as the primary reviewer sign-in.
  REVIEWER="$(tr -d '\r' < .env 2>/dev/null | sed -n 's/^REVIEWER_PHONE=//p' | head -1 || true)"
  REVIEWER="${REVIEWER%%,*}"
  DEMO="$(tr -d '\r' < .env 2>/dev/null | sed -n 's/^DEMO_PHONE=//p' | head -1 || true)"
  if [ -z "$DEMO" ] && [ -n "$REVIEWER" ]; then
    # DEMO_PHONE absent means this probe CANNOT TELL the two cases apart: a reviewer pointed
    # at a real employee, and a demo account nobody wrote down. It reported the first one,
    # so it accused on a box where REVIEWER_PHONE had just been set correctly, and it would
    # have gone on accusing on every deploy forever. A probe that cries wolf every release
    # is a probe people stop reading, which costs more than the check is worth.
    log "reviewer probe: REVIEWER_PHONE is set but DEMO_PHONE is not, so this cannot be checked."
    log "   Record DEMO_PHONE in .env (the number seed-demo built) and this becomes a real check."
  elif [ -z "$REVIEWER" ]; then
    log "reviewer probe — REVIEWER_PHONE is unset (no fixed-OTP account exists)"
  elif [ -n "$DEMO" ] && [ "$REVIEWER" = "$DEMO" ]; then
    log "reviewer probe — REVIEWER_PHONE is the demo account"
  else
    log "!! REVIEWER_PHONE is set to something other than the demo account. A Play reviewer"
    log "   signing in with a fixed OTP reads whatever that account can see — and if it is a"
    log "   real employee, that is live customer names, addresses and phone numbers."
    log "   Fix: run the seed-demo deploy mode, then point REVIEWER_PHONE at that number."
    alert "REVIEWER_PHONE is not the demo account — a Play reviewer may be reading real customer data"
  fi

  # 6. W7 — WHAT THE ESCAPE HATCH COSTS, in the mode that is actually live.
  #
  # rollback.sh is the only way out of a bad release, and it is not one thing. In registry
  # mode it PULLS the images CI already built for the target commit — seconds to minutes,
  # byte-identical to what ran before. With IMAGE_PREFIX empty it re-COMPILES them, here, on
  # the box that is by definition already unhealthy, through the same parallel-BuildKit path
  # whose daemon panic stopped all 25 containers on 2026-08-02.
  #
  # Nothing anywhere said which of those it was, so the answer was learned during the
  # incident. This says it on every healthy deploy instead.
  #
  # The number is THIS BOX'S: the image step of THIS deploy was timed a few minutes ago and
  # written to .deploy/image-cost. Quoting a figure is what rebuild-stale.sh:30 does — it
  # still cites a 40-minute deploy timeout that deploy.yml:226 raised to 120m, and that is
  # what every written-down number in this repo has eventually become.
  ROLLBACK_TARGET="$(cat "$STATE_DIR/prev-sha" 2>/dev/null || echo "$PREV_SHA")"
  COST_LINE="$(cat "$STATE_DIR/image-cost" 2>/dev/null || true)"
  COST_N="$(echo "$COST_LINE" | awk '{print $2}')"
  COST_S="$(echo "$COST_LINE" | awk '{print $3}')"
  IMAGES_TOTAL="$(grep -c 'image: ${IMAGE_PREFIX' docker-compose.prod.yml 2>/dev/null || true)"
  IMAGES_TOTAL="${IMAGES_TOTAL:-0}"
  # A missing or zero measurement must not divide, and must not be dressed up as a number.
  # Every field must be a plain number before any arithmetic happens. This whole block runs
  # AFTER "DEPLOY OK" under `set -euo pipefail`, where one failed $(( )) would report a
  # working release as a failed deploy — the H-17 shape the scheduler-TZ probe above
  # documents, and the reason a report that finds nothing must still exit 0.
  # A count of ZERO is not a small number here, it is a failed read — and printing
  # "up to 0 images, ~0 min" would be this probe reassuring somebody about a thing it never
  # managed to measure, which is the defect class the outbox probe already cost us.
  if [ "${IMAGES_TOTAL:-0}" = 0 ]; then
    IMAGES_TXT="an unknown number of (docker-compose.prod.yml unreadable)"
  else
    IMAGES_TXT="$IMAGES_TOTAL"
  fi
  COST_OK=1
  for N in "${COST_N:-}" "${COST_S:-}" "$IMAGES_TOTAL"; do
    case "$N" in '' | *[!0-9]*) COST_OK='' ;; esac
  done
  # `if`, not `&&`: a false `[ ... ] && x` is a non-zero command under `set -e`, and this
  # runs after DEPLOY OK — the one place a probe must never be able to fail the deploy.
  if [ "${COST_N:-0}" = 0 ] || [ "${IMAGES_TOTAL:-0}" = 0 ]; then COST_OK=''; fi
  if [ -n "$COST_OK" ]; then
    EST_MIN="$(( (COST_S * IMAGES_TOTAL / COST_N + 59) / 60 ))"
    MEASURED="measured here this deploy: $COST_N image(s) in ${COST_S}s"
  else
    EST_MIN=""
    MEASURED="not measured on this box yet (this deploy touched no image)"
  fi
  if registry_mode; then
    log "rollback cost probe — mode=registry ($IMAGE_PREFIX), target $ROLLBACK_TARGET"
    log "   A rollback PULLS $IMAGES_TXT prebuilt images. Nothing is compiled on this box."
    log "   ${EST_MIN:+~${EST_MIN} min at the rate }$MEASURED"
  else
    log "!! rollback cost probe — mode=BUILD (IMAGE_PREFIX is empty), target $ROLLBACK_TARGET"
    log "   A rollback COMPILES up to $IMAGES_TXT images ON THIS BOX, while it is unhealthy,"
    log "   over the parallel BuildKit path that stopped all 25 containers on 2026-08-02."
    log "   ${EST_MIN:+worst case ~${EST_MIN} min — }$MEASURED"
    log "   This is a choice, not a constraint, and it costs one line. MEASURED 2026-08-29:"
    log "   images.yml publishes all 19 service images to ghcr.io on every green CI, tagged"
    log "   with the commit SHA, and the packages are PUBLIC — an anonymous pull returned 200"
    log "   for every service at main's HEAD. No docker login, no PAT, no repo secret."
    log "   Fix: put IMAGE_PREFIX=ghcr.io/<owner>/<repo>- in .env (DEPLOY.md 'Registry mode'"
    log "   has the exact value and the one-command check), then deploy. A rollback becomes"
    log "   a pull, and the ~270 SHA tags already in the registry become reachable targets."
  fi
else
  log "!! health check FAILED after deploy — auto-rolling back to $PREV_SHA"
  bash scripts/rollback.sh "$PREV_SHA"
  exit 1
fi
