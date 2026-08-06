#!/usr/bin/env bash
# Shared plumbing for deploy.sh / rollback.sh / rebuild-stale.sh / watchdog.sh.
# Source it from the repo root:  . scripts/lib/deploy-common.sh
#
# It lives here because the three copies had already drifted, and the drift was the
# bug: rollback.sh built its own COMPOSE without the tls profile, never converged the
# stack and gated on the gateway alone — so the automatic rollback could re-create the
# exact four-hour outage deploy.sh had just learned to catch. One definition, four
# callers, no copy left to forget the next fix.

# Caddy sits behind `profiles: ["tls"]`, so a plain compose call excludes it: never
# started, never converged, absent from `ps`. Enable the profile only when a domain is
# configured, so the documented bare-IP (no-TLS) path still works and does not try to
# bind 80/443 without a hostname.
TLS_PROFILE=""
if [ -n "${WEB_DOMAIN:-}" ] || grep -qsE '^WEB_DOMAIN=.+' .env; then
  TLS_PROFILE="--profile tls"
fi
# Overridable so a local run can layer an extra overlay (e.g. dropping postgres's host
# port when another project already publishes 5432) without editing any script.
COMPOSE="${COMPOSE:-docker compose -f docker-compose.yml -f docker-compose.prod.yml $TLS_PROFILE}"
GATEWAY_HEALTH="${GATEWAY_HEALTH:-http://localhost:8080/health}"

# H-31/H-35: registry mode. Compose reads .env itself for interpolation, but these scripts
# have to KNOW whether images come from a registry — that decides whether a deploy builds
# on the production box at all. So read that one key here.
#
# Unset (the default, and every existing box) keeps the old behaviour exactly: build
# locally, tag `hydromart-<svc>:local`. Set IMAGE_PREFIX to the registry path prefix (e.g.
# ghcr.io/owner/hydromart-) and the deploy pulls SHA-tagged images instead.
if [ -z "${IMAGE_PREFIX:-}" ] && [ -f .env ]; then
  IMAGE_PREFIX="$(sed -n 's/^IMAGE_PREFIX=//p' .env | tail -1)"
fi
export IMAGE_PREFIX="${IMAGE_PREFIX:-}"

# True when this box deploys pre-built images rather than building its own.
registry_mode() { [ -n "${IMAGE_PREFIX:-}" ]; }

# In registry mode every compose call needs a tag, not just the deploy — the watchdog's
# `up -d` would otherwise ask for `:local`, which does not exist in the registry, and a
# recovery would fail exactly when it is needed. HEAD is the deployed commit (deploy.sh
# resets the tree before it converges), so it is always the right answer here.
if [ -n "${IMAGE_PREFIX:-}" ] && [ -z "${IMAGE_TAG:-}" ]; then
  export IMAGE_TAG="$(git rev-parse HEAD 2>/dev/null || echo local)"
fi

# One writer at a time on this compose project.
#
# The watchdog runs every five minutes; a deploy runs for tens of them. On 2026-08-05
# they collided: the watchdog saw the containers deploy.sh was in the middle of
# recreating as stopped, ran its own converge, and the deploy died on
# `Error response from daemon: removal of container ... is already in progress`. The
# stack ended up fine — the watchdog finished the recreate — but the deploy exited 1
# before its health gate, so `last-good-sha` was never written and a deploy that HAD
# converged reported failure. Every deploy crosses a watchdog tick, so this was not a
# one-off.
#
# One lock file, held for the whole run. The deploy waits, because a watchdog pass is
# seconds; the watchdog gives up at once, because a deploy converging IS the recovery it
# would have performed. A nested call (deploy.sh -> rollback.sh) inherits rather than
# deadlocks on itself.
STACK_LOCK="${STACK_LOCK:-.deploy/stack.lock}"
stack_lock() {
  # Already held by the script that invoked this one.
  [ -n "${HYDROMART_STACK_LOCKED:-}" ] && return 0
  # ponytail: no flock (git-bash, macOS default) = exactly the old behaviour. The box
  # that runs deploys has it; a laptop that does not is not racing anything.
  command -v flock >/dev/null 2>&1 || return 0
  mkdir -p "$(dirname "$STACK_LOCK")"
  exec 9>>"$STACK_LOCK"
  flock -w "${1:-0}" 9 || return 1
  export HYDROMART_STACK_LOCKED=1
}

# Pull the SHA-tagged images for one commit, or fail loudly. The tag is the commit, so a
# miss means the Images workflow has not finished (or failed) for that SHA — which must
# stop the deploy rather than silently leaving the old containers running.
pull_images() {
  export IMAGE_TAG="$1"
  $COMPOSE pull --quiet
}

# Map a changed path to the compose service whose IMAGE it invalidates; echo nothing
# if it invalidates none. services/foo-service/... -> foo ; apps/web/... -> web
#
# Root-level files map to no service on purpose — docker-compose.prod.yml and
# .env.example change how containers RUN, not what is baked into them, and the answer
# to those is the converge below, not a rebuild. What must not happen is the old
# behaviour, where "no service matched" was read as "nothing to do at all".
svc_of() {
  case "$1" in
    services/*/*) echo "$1" | cut -d/ -f2 | sed 's/-service$//' ;;
    apps/*/*)     echo "$1" | cut -d/ -f2 ;;
  esac
}

# Paths that invalidate EVERY image. Shared packages are compiled into all of them,
# and every Dockerfile COPYs the root manifests + tsconfig.base.json before `npm ci` —
# so a lockfile bump changes all 20 images while matching no svc_of case. Without this
# a dependency upgrade used to deploy as "no service code changed".
# Takes the newline-separated `git diff --name-only` output.
needs_full_rebuild() {
  echo "$1" | grep -qE '^(packages/|package\.json$|package-lock\.json$|tsconfig\.base\.json$)'
}

# B-20: migration directories introduced by the incoming diff, one per line, empty if
# none. Migration execution has always been a separate manual button, so a merge that
# carries both a migration and the code that reads it deployed the code first and the
# schema whenever someone remembered — new containers against an old schema. The repo
# convention (schema ships one release BEFORE its reader) is only safe when something
# actually checks; this is that something.
# Takes the newline-separated `git diff --name-only` output.
#
# `|| true` is load-bearing, not tidiness: grep exits 1 on no match, deploy.sh runs under
# `set -euo pipefail`, and `MIGRATIONS="$(pending_migrations "$CHANGED")"` takes its status
# from the substitution. Without this, EVERY deploy whose diff carries no migration — which
# is most of them — died silently right after the reset, before a single container was
# touched. "No migrations" is the normal answer to this question, not a failure.
pending_migrations() {
  echo "$1" | grep -oE '^(services|apps)/[^/]+/prisma/migrations/[^/]+' | sort -u || true
}

# Which commit the RUNNING containers were built from. deploy.sh writes last-good-sha only
# after a green health check, so it is the only durable record of what is actually serving.
# The working tree is not that record: a deploy that dies any time after `git reset --hard`
# leaves HEAD on the incoming commit with the old images still running, and the next run —
# diffing HEAD against an identical origin/main — then finds no changed service, rebuilds
# nothing, passes the gate on the containers that were already up, and writes that SHA to
# last-good. A failed deploy quietly became a successful no-op, which is the same silence
# the early `exit 0` used to produce.
#
# Falls back to the caller's SHA when the file is missing, empty, or names a commit this
# checkout does not have (a rolled-back or rewritten history) — that is a first deploy, and
# it behaves exactly as before.
rebuild_base() {
  local file="$1" fallback="$2" sha=""
  # Guarded rather than `2>/dev/null`'d: the shell reports a failed input redirect itself,
  # and piping through `cat` to silence it would put a failing command in a pipeline this
  # function's callers run under `set -o pipefail`.
  if [ -f "$file" ]; then sha="$(tr -d '[:space:]' < "$file")"; fi
  if [ -n "$sha" ] && git cat-file -e "${sha}^{commit}" 2>/dev/null; then
    echo "$sha"
  else
    echo "$fallback"
  fi
}

# Every service the compose project defines must be RUNNING. The gateway probe alone is
# not a deploy gate: gateway is built last, so it can be healthy while every batch
# before it sits stopped. Prints the stopped names, empty if none.
#
# This is the WATCHDOG's question, not the deploy gate's: `up -d` is the remedy for a
# container that is not running, and it is no remedy at all for one that is running and
# broken. See unhealthy_services below for the stricter gate.
stopped_services() {
  $COMPOSE ps --all --format '{{.Service}} {{.State}}' 2>/dev/null |
    awk '$2 != "running" { print $1 }' | sort -u | tr '\n' ' '
}

# H-32: pure half of the deploy gate, so it can be tested without a Docker daemon.
# Reads `<service> <state> <health>` lines on stdin and prints the ones that fail.
#
# `running` was never the right question. Every app service declares a healthcheck, and a
# container whose /health has been failing since boot stays `running` the whole time — so
# the old gate passed a deploy that had just taken the site down, and then wrote that SHA
# to last-good-sha. A service with NO healthcheck (empty third field) can still only be
# judged on running, which is what it was before; one that has a healthcheck must say
# `healthy`, and `starting` fails in a way the retry loop below lets resolve.
filter_unhealthy() {
  awk '$2 != "running" { print $1; next } $3 != "" && $3 != "healthy" { print $1 }' |
    sort -u | tr '\n' ' '
}

# Services that fail the deploy gate: not running, or running without a healthy verdict.
unhealthy_services() {
  $COMPOSE ps --all --format '{{.Service}} {{.State}} {{.Health}}' 2>/dev/null | filter_unhealthy
}

# Names compose DECLARES for this project. Parsed from the YAML, which is why it still
# answers when the daemon is the broken thing.
declared_services() {
  $COMPOSE config --services 2>/dev/null | sort -u
}

# Declared names that `ps --all` did not list at all. PURE — takes the two newline lists
# as arguments — so it is tested without Docker.
#
# H-17: this is the gap `stopped_services` cannot see. It reports containers whose STATE
# is wrong; a service that was never created has no state and no row, so a rebuild that
# died in batch 3 of 5 left the remaining services absent and the gate read "nothing
# stopped" as "everything fine". The same blind spot turns a dead daemon into a pass:
# `ps` fails, prints nothing, and an empty list of stopped services looks like health.
absent_services() {
  comm -23 \
    <(printf '%s\n' "$1" | sed '/^[[:space:]]*$/d' | sort -u) \
    <(printf '%s\n' "$2" | sed '/^[[:space:]]*$/d' | sort -u) | tr '\n' ' '
}

# The live version of the above: declared minus whatever compose can actually see.
missing_services() {
  absent_services "$(declared_services)" \
    "$($COMPOSE ps --all --format '{{.Service}}' 2>/dev/null)"
}

# Bring the whole project to its declared state. Idempotent: a no-op when everything
# already runs, a recreate for any container whose compose config moved, a start for
# anything left stopped by anyone. This — not svc_of — is what makes a root-file change
# take effect.
converge() {
  $COMPOSE up -d --remove-orphans
}

# Why a container is down is knowable only while the box still has it. The four-hour
# outage was reconstructed by hand from `docker ps -a` long after the fact, and by then
# the exit reason, the OOM flag and the daemon's event buffer were gone — which is why
# "all Exited(0) at once" is still the whole story we have. Record it at the moment we
# notice instead. Prints the report path.
diagnose_stopped() {
  local out="${1:-.deploy/incident-$(date +%Y%m%d-%H%M%S).log}"
  local down cid
  down="$(stopped_services)"
  mkdir -p "$(dirname "$out")"
  {
    echo "== $(date -Is) — not running: ${down:-none}"
    echo "== host"
    free -m 2>/dev/null || true
    df -h / 2>/dev/null || true
    echo "== compose ps"
    $COMPOSE ps --all 2>&1 || true
    for s in $down; do
      cid="$($COMPOSE ps --all -q "$s" 2>/dev/null | head -1)"
      echo "-- $s ($cid)"
      # ExitCode + OOMKilled + FinishedAt separate the three candidate causes we could
      # not tell apart last time: killed by the kernel, crashed on boot, or stopped by
      # something outside these scripts (exit 0 with `restart: unless-stopped` can only
      # be a deliberate stop or a daemon shutdown).
      [ -n "$cid" ] && docker inspect --format \
        'status={{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} error={{.State.Error}} finished={{.State.FinishedAt}} restarts={{.RestartCount}}' \
        "$cid" 2>&1 || true
      $COMPOSE logs --tail 40 "$s" 2>&1 | tail -40 || true
    done
    # `--until` is what keeps `docker events` from streaming forever; `timeout` is the
    # belt to that braces, because this runs inside the deploy's health gate and a
    # hung diagnostic would be worse than a missing one.
    echo "== docker stop/die/kill events (last 6h, daemon buffer — best effort)"
    timeout 20 docker events --since 6h --until 1s \
      --filter event=stop --filter event=die --filter event=kill 2>&1 | tail -60 || true
    echo "== dockerd restarts (needs root; best effort)"
    journalctl -u docker --since '-6h' --no-pager 2>&1 | tail -40 || true
  } >"$out" 2>&1
  echo "$out"
}

# Gate: gateway answers AND every service in the project is running AND every service
# that declares a healthcheck reports healthy (H-32).
health_ok() {
  local ok=1 down
  for _ in $(seq 1 30); do
    if curl -fsS "$GATEWAY_HEALTH" >/dev/null 2>&1; then ok=0; break; fi
    sleep 2
  done
  [ "$ok" -eq 0 ] || { echo "[health] !! gateway probe never answered"; return 1; }

  # Give slow starters a moment before declaring the stack incomplete. Both questions are
  # asked every round: a container can be running-but-broken, and a container can be
  # missing entirely, and only the second one catches a rebuild that died before creating
  # it. The window is 30 rounds, not 15, because `starting` is a fail under H-32 and
  # compose healthchecks have their own start_period — 60s was not enough for 20 of them.
  local absent=""
  for _ in $(seq 1 30); do
    down="$(unhealthy_services)"
    absent="$(missing_services)"
    if [ -z "$down" ] && [ -z "$absent" ]; then return 0; fi
    sleep 4
  done
  if [ -n "$absent" ]; then
    echo "[health] !! these services have no container at all: $absent"
  fi
  if [ -n "$down" ]; then
    echo "[health] !! these services are not running or not healthy: $down"
  fi
  echo "[health] diagnostics written to $(diagnose_stopped)"
  return 1
}

# .env.example is the contract; the real .env exists only on the box and no deploy can
# write it. A key added to the example is therefore invisible until a human sets it,
# and compose reads most of them with a `:-` fallback — so the stack boots green with
# the new feature silently off. That is exactly how the meter-alert phone shipped dead.
# Prints the missing keys (empty when there are none); never fails a deploy, because a
# genuinely optional key must not take prod down.
missing_env_keys() {
  [ -f .env.example ] && [ -f .env ] || return 0
  comm -23 \
    <(sed -n 's/^\([A-Z_][A-Z0-9_]*\)=.*/\1/p' .env.example | sort -u) \
    <(sed -n 's/^\([A-Z_][A-Z0-9_]*\)=.*/\1/p' .env | sort -u) | tr '\n' ' '
}

# Fire-and-forget ops ping, same webhook the services use. No-op when unset.
alert() {
  local url="${ALERT_WEBHOOK_URL:-}" text
  [ -z "$url" ] && return 0
  text="🚨 Hydromart on $(hostname 2>/dev/null || echo host): $1"
  curl -fsS -m 10 -X POST -H 'content-type: application/json' \
    --data "{\"text\":\"${text}\",\"content\":\"${text}\"}" "$url" >/dev/null 2>&1 || true
}
