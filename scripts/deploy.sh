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

log "backing up databases first (rollback safety net)"
bash scripts/backup-db.sh

git fetch origin "$BRANCH"
NEW_SHA="$(git rev-parse "origin/$BRANCH")"

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

if registry_mode; then
  # H-31/H-35: images were built in CI and tagged with this exact commit. Nothing is
  # compiled on the box that serves customers — no 1.5 GB build peak beside Postgres, no
  # layers on the production disk, and no repeat of the BuildKit daemon panic that stopped
  # all 25 containers on 2026-08-02.
  log "registry mode (IMAGE_PREFIX=$IMAGE_PREFIX) — pulling images tagged $NEW_SHA"
  if ! pull_images "$NEW_SHA"; then
    log "!! could not pull images for $NEW_SHA — the Images workflow has not published them"
    log "   restoring the tree to $PREV_SHA; the running stack was not touched"
    git reset --hard "$PREV_SHA"
    alert "deploy aborted: no images published for $NEW_SHA (stack still serving $PREV_SHA)"
    exit 1
  fi
elif [ "${SERVICES[0]:-}" = "--all" ]; then
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
  log "rebuilding: ${SERVICES[*]}"
  rebuild_or_rollback "${SERVICES[@]}"
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

if health_ok; then
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
  elif [ -z "$HOST_CRON" ]; then
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
      "SELECT coalesce(string_agg(status || '=' || n, ' '), 'empty') FROM (SELECT status, count(*) AS n FROM order_outbox GROUP BY 1) t" 2>/dev/null || echo 'unreadable')"
    log "order_outbox probe — $OUTBOX"
    PENDING="$(printf '%s' "$OUTBOX" | sed -n 's/.*PENDING=\([0-9]*\).*/\1/p')"
    if [ -n "$PENDING" ] && [ "$PENDING" -gt "${OUTBOX_PENDING_ALERT:-100}" ]; then
      log "!! $PENDING event(s) PENDING in order_outbox — the dispatcher is not draining it."
      alert "order_outbox has $PENDING pending events — downstream effects are not happening"
    fi
  else
    log "!! cannot reach the Postgres container ($PG) — the outbox was NOT probed."
  fi

  # 2. Web push is dead without VAPID, and dead silently: subscribing just never succeeds.
  # Presence only, never the value.
  if $COMPOSE exec -T crm sh -c '[ -n "${VAPID_PUBLIC_KEY:-}" ]' >/dev/null 2>&1; then
    log "web push probe — VAPID_PUBLIC_KEY is set inside crm"
  else
    log "!! VAPID_PUBLIC_KEY is EMPTY inside the crm container — web push cannot work at all."
    log "   Android FCM is unaffected. Fix: set it in .env and recreate crm (deploy mode env-set)."
    alert "VAPID_PUBLIC_KEY missing in crm — web push is dead"
  fi

  # 3. The Play reviewer must not be a real employee. REVIEWER_PHONE granted a stranger
  # holding a fixed OTP the account of a KEPALA_DEPOT at a depot with real customers on it —
  # their names, addresses and phone numbers. `scripts/seed-demo-depot.mjs` builds the
  # account they should get; this is the check that somebody pointed the variable at it.
  REVIEWER="$(tr -d '\r' < .env 2>/dev/null | sed -n 's/^REVIEWER_PHONE=//p' | head -1 || true)"
  DEMO="$(tr -d '\r' < .env 2>/dev/null | sed -n 's/^DEMO_PHONE=//p' | head -1 || true)"
  if [ -z "$REVIEWER" ]; then
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
else
  log "!! health check FAILED after deploy — auto-rolling back to $PREV_SHA"
  bash scripts/rollback.sh "$PREV_SHA"
  exit 1
fi
