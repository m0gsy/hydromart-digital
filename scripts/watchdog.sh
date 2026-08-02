#!/usr/bin/env bash
# Keep the stack converged between deploys, and record WHY it ever wasn't.
#
# Host cron, every 5 minutes:
#   */5 * * * * cd /opt/hydromart && ALERT_WEBHOOK_URL=... bash scripts/watchdog.sh >> /var/log/hydromart-watchdog.log 2>&1
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

DOWN="$(stopped_services)"
if [ -z "$DOWN" ]; then exit 0; fi

REPORT="$(diagnose_stopped)"
echo "[watchdog] $(date -Is) not running: $DOWN — diagnostics: $REPORT"
converge

# Re-check rather than trust `up -d`: a container that exits again immediately is a
# crash loop, which is a different problem and must not be reported as recovered.
sleep 20
STILL="$(stopped_services)"
if [ -z "$STILL" ]; then
  echo "[watchdog] recovered: $DOWN"
  # Service names only — no untrusted input reaches the JSON body.
  alert "watchdog restarted stopped containers: ${DOWN}(see $REPORT for why)"
else
  echo "[watchdog] !! still down after converge: $STILL"
  alert "containers still down after watchdog converge: ${STILL}(see $REPORT)"
  exit 1
fi
