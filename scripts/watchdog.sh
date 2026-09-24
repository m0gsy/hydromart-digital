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
