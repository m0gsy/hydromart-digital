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

# HD-9b — the AI web (infra/aiweb/docker-compose.yml), the second project on this box: the same
# two answers for its long-running services, `db` and `aiweb`, and never for `migrate` (a one-shot
# job that is SUPPOSED to be exited). Under the lock taken above.
#
# A stopped one is STARTED again with `docker start`, never `compose up`: start reuses the
# container exactly as deploy left it, image included. `up` would read the compose file, and
# after a release PR whose deploy has not run (or failed) that file names images this box does
# not have: the watchdog would then pull or swap the AI web's release, which only deploy may do.
# A container that does not exist at all is left to deploy too. Unhealthy is reported, not
# restarted, with the same two-sighting rule as hydromart's.
aiweb_watch() {
  local project ids id line svc state health oneoff stopped='' started='' still='' cur=''
  local state_file="${WATCHDOG_AIWEB_STATE:-.deploy/watchdog-aiweb-unhealthy}" prev_names='' prev_flag=0 out new_names new_flag action
  project="$(sed -n 's/^name:[[:space:]]*//p' infra/aiweb/docker-compose.yml 2>/dev/null | tr -d "\"' \r")"
  [ -n "$project" ] || return 0
  ids="$(docker ps -aq --filter "label=com.docker.compose.project=$project" 2>/dev/null || true)"
  [ -n "$ids" ] || return 0
  for id in $ids; do
    line="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}} {{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} {{index .Config.Labels "com.docker.compose.oneoff"}}' "$id" 2>/dev/null || true)"
    read -r svc state health oneoff <<<"$line"
    [ "$oneoff" = True ] && continue
    case "$svc" in db | aiweb) ;; *) continue ;; esac
    if [ "$state" != running ]; then
      stopped="$stopped $svc:$id"
    elif [ "$health" = unhealthy ]; then
      cur="$cur $svc"
    fi
  done
  # The database first, so the app it depends on starts against a running one.
  for svc in db aiweb; do
    for id in $stopped; do
      [ "${id%%:*}" = "$svc" ] || continue
      if docker start "${id#*:}" >/dev/null 2>&1; then started="$started $svc"; else still="$still $svc"; fi
    done
  done
  if [ -n "$started$still" ]; then
    echo "[watchdog] $(date -Is) AI web: started again:${started:- none}; would not start:${still:- none}"
    if [ -n "$still" ]; then
      alert "AI web containers would not start again:${still} (the watchdog only starts what stopped; read docker logs, then deploy)"
    else
      alert "watchdog started stopped AI web containers again:${started}"
    fi
  fi
  cur="$(printf '%s\n' $cur | sed '/^$/d' | sort | tr '\n' ' ' | sed 's/ $//')"
  if [ -f "$state_file" ]; then IFS='|' read -r prev_names prev_flag <"$state_file" || true; fi
  out="$(watchdog_unhealthy_step "$prev_names" "${prev_flag:-0}" "$cur")"
  IFS='|' read -r new_names new_flag action <<<"$out"
  if [ -n "$new_names" ]; then
    mkdir -p "$(dirname "$state_file")"
    printf '%s|%s\n' "$new_names" "$new_flag" >"$state_file"
  else
    rm -f "$state_file"
  fi
  case "$action" in
    alert)
      echo "[watchdog] $(date -Is) AI web running but UNHEALTHY: $cur"
      alert "AI web containers running but UNHEALTHY for 5+ minutes: ${cur} - the watchdog does not restart these; read their logs first"
      ;;
    recovered)
      echo "[watchdog] $(date -Is) AI web healthy again: $prev_names"
      alert "AI web containers healthy again: ${prev_names}"
      ;;
  esac
}
# Its own failure must never stop hydromart's half below.
aiweb_watch || echo "[watchdog] $(date -Is) !! the AI web check itself failed; hydromart's runs on"

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
