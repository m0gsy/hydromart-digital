#!/usr/bin/env bash
# Keep the stack converged between deploys, and record WHY it ever wasn't.
#
# Host cron, every 5 minutes — installed by `bash scripts/install-host-cron.sh` (Q-10)
# together with the nightly backup and the weekly restore drill.
#
# Why this exists. On 2026-08-02 nineteen containers sat `Exited (0)` for four hours
# with RAM and disk fine. `restart: unless-stopped` cannot bring those back: exit 0 plus
# that policy means the container was stopped deliberately (a `docker stop`/`compose
# stop`, or a daemon shutdown), and Docker then honours the stop until someone asks for
# it again. Nothing did — the deploy gate is the only thing that ever converged the
# stack, and it runs only when someone merges. We never found what issued the stop, and
# by the time we looked the daemon's event buffer had rolled over.
#
# So this closes both halves: `up -d` is the ask that a stopped container needs, and the
# incident dump captures exit codes, OOM flags, container logs and the daemon's stop/die
# events while they still exist — so a second occurrence is diagnosed, not guessed at.
#
# ponytail: cron + `up -d`, not a supervisor. Idempotent and ~1s when all is well; swap
# for a real orchestrator only when there is a second node to schedule onto.
set -euo pipefail

cd "$(dirname "$0")/.."
. scripts/lib/deploy-common.sh

# A deploy recreates containers, and a container mid-recreate looks exactly like one that
# stopped. Converging it underneath the deploy is what killed the 2026-08-05 deploy.
if ! stack_lock 0; then
  echo "[watchdog] $(date -Is) deploy in progress — it converges the stack itself; skipping"
  exit 0
fi

# Running-but-unhealthy is a different failure from stopped, and nothing looked for it: a hung
# web container (which Prometheus does not scrape) stayed `running`, was never restarted, and
# alerted nobody. Report it — only report: a hung process needs a person to look at its logs,
# not a blind restart that erases the evidence. Two consecutive runs (5 minutes) before it
# speaks, because a container that is `starting` after a restart is not an incident.
health_watch() {
  local state="${WATCHDOG_STATE:-.deploy/watchdog-unhealthy}" cur prev_names="" prev_flag=0 out
  local new_names new_flag action
  cur="$(unhealthy_services | tr ' ' '\n' | sed '/^$/d' | sort | tr '\n' ' ' | sed 's/ $//')"
  if [ -f "$state" ]; then IFS='|' read -r prev_names prev_flag < "$state" || true; fi
  out="$(watchdog_unhealthy_step "$prev_names" "${prev_flag:-0}" "$cur")"
  IFS='|' read -r new_names new_flag action <<< "$out"
  if [ -n "$new_names" ]; then
    mkdir -p "$(dirname "$state")"
    printf '%s|%s\n' "$new_names" "$new_flag" > "$state"
  else
    rm -f "$state"
  fi
  case "$action" in
    alert)
      echo "[watchdog] $(date -Is) running but UNHEALTHY: $cur"
      alert "containers running but UNHEALTHY for 5+ minutes: ${cur} — the watchdog does not restart these; read docker compose logs before deciding"
      ;;
    recovered)
      echo "[watchdog] $(date -Is) healthy again: $prev_names"
      alert "containers healthy again: ${prev_names}"
      ;;
  esac
}

# HD-9b — the AI web (infra/aiweb/docker-compose.yml), the second project on this box: its
# long-running services, `db`, `aiweb` and (AI-5) `n8n`, and never `migrate` or `n8n-setup` (one-shot
# jobs that are SUPPOSED to be exited). n8n switched off (its kill switch) has no container at all,
# which is left to deploy like any other missing one.
#
# Only a container that is `exited` or `created` is STARTED again, with `docker start`, never
# `compose up`: start reuses the container exactly as deploy left it, image included. `up` would
# read the compose file, and after a release PR whose deploy has not run (or failed) that file
# names images this box does not have: the watchdog would then pull or swap the AI web's release,
# which only deploy may do. A container that does not exist at all is left to deploy too.
#
# Every other state is reported and never acted on, on the second run in a row it is seen, as
# hydromart's unhealthy containers are: running but unhealthy, and `restarting` (a crash loop
# Docker is already retrying, where a start succeeds and changes nothing), `paused`, `dead` and
# `removing`. Those reports and a start that fails are said once per container (alert_once
# aiweb-watch-<service>), and forgotten, with one "healthy again", once every one of them runs
# healthy (db and aiweb at least).
aiweb_watch() {
  local project ids id line svc state health oneoff entry stopped='' started='' cur='' seen='' good='' back='' all=''
  local state_file="${WATCHDOG_AIWEB_STATE:-.deploy/watchdog-aiweb-unhealthy}" prev_names='' prev_flag=0 out new_names new_flag action
  project="$(sed -n 's/^name:[[:space:]]*//p' infra/aiweb/docker-compose.yml 2>/dev/null | tr -d "\"' \r" || true)"
  [ -n "$project" ] || return 0
  ids="$(docker ps -aq --filter "label=com.docker.compose.project=$project" 2>/dev/null || true)"
  [ -n "$ids" ] || return 0
  for id in $ids; do
    line="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}} {{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} {{index .Config.Labels "com.docker.compose.oneoff"}}' "$id" 2>/dev/null || true)"
    read -r svc state health oneoff <<<"$line"
    [ "$oneoff" = True ] && continue
    case "$svc" in db | aiweb | n8n) ;; *) continue ;; esac
    all="$all $svc"
    case "$state:$health" in
      exited:* | created:*) stopped="$stopped $svc:$id" ;;
      running:healthy | running:none) good="$good $svc" ;;
      running:starting) ;; # no verdict yet
      running:*)
        cur="$cur $svc"
        seen="$seen $svc:unhealthy"
        ;;
      *)
        cur="$cur $svc"
        seen="$seen $svc:$state"
        ;;
    esac
  done
  # The database first, so the app and n8n, which depend on it, start against a running one.
  for svc in db aiweb n8n; do
    for entry in $stopped; do
      [ "${entry%%:*}" = "$svc" ] || continue
      if docker start "${entry#*:}" >/dev/null 2>&1; then
        started="$started $svc"
      else
        echo "[watchdog] $(date -Is) AI web: $svc would not start"
        alert_once "aiweb-watch-$svc" "AI web container would not start again: $svc (the watchdog only starts what stopped; read docker logs, then deploy)"
      fi
    done
  done
  if [ -n "$started" ]; then
    echo "[watchdog] $(date -Is) AI web: started again:$started"
    alert "watchdog started stopped AI web containers again:$started"
  fi
  cur="$(printf '%s\n' $cur | sed '/^$/d' | sort -u | tr '\n' ' ' | sed 's/ $//')"
  if [ -f "$state_file" ]; then IFS='|' read -r prev_names prev_flag <"$state_file" || true; fi
  out="$(watchdog_unhealthy_step "$prev_names" "${prev_flag:-0}" "$cur")"
  IFS='|' read -r new_names new_flag action <<<"$out"
  if [ -n "$new_names" ]; then
    mkdir -p "$(dirname "$state_file")"
    printf '%s|%s\n' "$new_names" "$new_flag" >"$state_file"
  else
    rm -f "$state_file"
  fi
  if [ "$action" = alert ]; then
    for entry in $seen; do
      echo "[watchdog] $(date -Is) AI web: ${entry%%:*} ${entry#*:} on two runs in a row"
      alert_once "aiweb-watch-${entry%%:*}" "AI web container ${entry%%:*} has been ${entry#*:} for 5+ minutes: the watchdog never restarts it; read its logs first"
    done
  fi
  # Every one running healthy, db and aiweb among them: what was said about any of them is over.
  good="$(printf '%s\n' $good | sort -u | tr '\n' ' ')"
  if [ "$good" = "$(printf '%s\n' $all | sort -u | tr '\n' ' ')" ] && [ -z "$cur$stopped" ] &&
    case "$good" in *"aiweb db "*) true ;; *) false ;; esac; then
    for svc in db aiweb n8n; do
      [ -f "$ALERT_MEMORY_DIR/aiweb-watch-$svc" ] || continue
      back="$back $svc"
      alert_clear "aiweb-watch-$svc"
    done
    if [ -n "$back" ]; then
      echo "[watchdog] $(date -Is) AI web healthy again:$back"
      alert "AI web containers healthy again:$back"
    fi
  fi
}

# `--aiweb`: the AI web half alone, as a process of its own so the trap below can bound it with
# timeout. Under the lock: run from the trap it inherits this process's (stack_lock sees
# HYDROMART_STACK_LOCKED), and run by hand it takes the lock itself.
if [ "${1:-}" = --aiweb ]; then
  aiweb_watch
  exit 0
fi
# The AI web half runs AFTER hydromart's, whichever way that ends (an exit below, or set -e),
# still under the lock, for at most 60s, and its outcome never changes hydromart's exit status.
aiweb_after() {
  local rc=$?
  timeout 60 bash scripts/watchdog.sh --aiweb ||
    echo "[watchdog] $(date -Is) !! the AI web check failed or ran past 60s; hydromart's result stands"
  exit "$rc"
}
trap aiweb_after EXIT

DOWN="$(stopped_services)"
if [ -z "$DOWN" ]; then
  health_watch
  exit 0
fi

REPORT="$(diagnose_stopped)"
echo "[watchdog] $(date -Is) not running: $DOWN — diagnostics: $REPORT"
converge

# Re-check rather than trust `up -d`: a container that exits again immediately is a
# crash loop, which is a different problem and must not be reported as recovered.
sleep 20
STILL="$(stopped_services)"
if [ -z "$STILL" ]; then
  echo "[watchdog] recovered: $DOWN"
  health_watch
  # Service names only — no untrusted input reaches the JSON body.
  alert "watchdog restarted stopped containers: ${DOWN}(see $REPORT for why)"
else
  echo "[watchdog] !! still down after converge: $STILL"
  alert "containers still down after watchdog converge: ${STILL}(see $REPORT)"
  exit 1
fi
