#!/usr/bin/env bash
# Prove ops/alertmanager.yml does what its comments say, with the real Alertmanager.
#
#   bash scripts/check-alertmanager-config.sh
#
# Four things, against the same image production runs (prom/alertmanager:v0.27.0):
#   1. `amtool check-config` accepts it (merge keys, both receivers).
#   2. ROUTING: a critical alert reaches BOTH receivers, a warning and an unlabelled alert reach only the
#      primary. A second channel that also swallowed warnings, or that replaced the first instead of
#      adding to it, would pass check-config and be wrong.
#   3. It BOOTS with the secondary's URL file absent — the state of every box until somebody sets the
#      second channel. The design depends on this Alertmanager loading such a config and failing only
#      that receiver's notification; if a future version validates the file at load, alerting would
#      go down with the next deploy, which is worse than having no second channel.
#   4. The path the config reads is the path compose mounts.
#
# Skips (exit 0) when there is no Docker daemon or the image cannot be pulled, and says so — a check
# that cannot run must say it did not run.
set -uo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1

IMAGE="prom/alertmanager:v0.27.0"
fails=0
ok() { echo "  ok   $1"; }
bad() {
  echo "  FAIL $1"
  fails=$((fails + 1))
}

echo "alertmanager config:"

if ! docker version >/dev/null 2>&1; then
  echo "  SKIPPED — no Docker daemon, so the real Alertmanager cannot be asked."
  exit 0
fi
if ! docker image inspect "$IMAGE" >/dev/null 2>&1 && ! docker pull -q "$IMAGE" >/dev/null 2>&1; then
  echo "  SKIPPED — could not pull $IMAGE."
  exit 0
fi

# docker on Windows wants a native path for the mount; elsewhere the path is used as it is.
hostpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi; }
CFG="$(hostpath "$PWD/ops/alertmanager.yml")"

WORK="$(mktemp -d)"
NAME="am-check-$$"
trap 'docker rm -f "$NAME" >/dev/null 2>&1; rm -rf "$WORK"' EXIT
printf 'https://example.invalid/primary' > "$WORK/primary"
mkdir -p "$WORK/secondary"
printf 'https://example.invalid/secondary' > "$WORK/secondary/webhook-url"

amtool() {
  docker run --rm --entrypoint amtool \
    -v "$CFG:/etc/alertmanager/alertmanager.yml:ro" \
    -v "$(hostpath "$WORK/primary"):/etc/alertmanager/webhook-url:ro" \
    -v "$(hostpath "$WORK/secondary"):/etc/alertmanager/secondary:ro" \
    "$IMAGE" "$@" 2>&1
}

# 1
if out="$(amtool check-config /etc/alertmanager/alertmanager.yml)" && printf '%s' "$out" | grep -q '2 receivers'; then
  ok "amtool accepts the config (two receivers)"
else
  bad "amtool check-config failed: $out"
fi

# 2
route() { amtool config routes test --config.file=/etc/alertmanager/alertmanager.yml "$@" | tail -1; }
[ "$(route severity=critical alertname=NoOrdersCreated)" = "ops-webhook-secondary,ops-webhook" ] &&
  ok "a critical alert reaches the secondary AND the primary" || bad "critical routing is wrong: $(route severity=critical alertname=NoOrdersCreated)"
[ "$(route severity=warning alertname=HighLatencyP95)" = "ops-webhook" ] &&
  ok "a warning reaches the primary only" || bad "warning routing is wrong: $(route severity=warning alertname=HighLatencyP95)"
[ "$(route alertname=Unlabelled)" = "ops-webhook" ] &&
  ok "an alert with no severity still reaches the primary" || bad "unlabelled routing is wrong: $(route alertname=Unlabelled)"

# 3 — the real daemon, with the secondary file ABSENT (an empty directory is mounted).
rm -f "$WORK/secondary/webhook-url"
docker run -d --name "$NAME" \
  -v "$CFG:/etc/alertmanager/alertmanager.yml:ro" \
  -v "$(hostpath "$WORK/primary"):/etc/alertmanager/webhook-url:ro" \
  -v "$(hostpath "$WORK/secondary"):/etc/alertmanager/secondary:ro" \
  "$IMAGE" >/dev/null 2>&1
up=no
for _ in $(seq 1 20); do
  if docker exec "$NAME" wget -q -O /dev/null http://localhost:9093/-/healthy 2>/dev/null; then
    up=yes
    break
  fi
  sleep 1
done
[ "$up" = yes ] && ok "it boots healthy with the second channel's URL file absent" ||
  bad "it does not come up without the secondary file: $(docker logs "$NAME" 2>&1 | tail -3)"

# 4
grep -q '/etc/alertmanager/secondary/webhook-url' ops/alertmanager.yml &&
  grep -q './ops/alertmanager-secondary:/etc/alertmanager/secondary' docker-compose.prod.yml &&
  ok "the file the config reads is inside the directory compose mounts" ||
  bad "ops/alertmanager.yml and docker-compose.prod.yml disagree about the secondary path"

[ "$fails" -eq 0 ] && echo "alertmanager config: all checks passed" || {
  echo "alertmanager config: $fails check(s) failed"
  exit 1
}
