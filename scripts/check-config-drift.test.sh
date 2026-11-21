#!/usr/bin/env bash
# Self-check for check-config-drift.sh, and it reproduces the real trap rather than
# simulating it: a file bind-mounted into a container, then REPLACED on the host the way
# `git pull` replaces it — a new file moved into place, so a new inode. The container keeps
# reading the old one, which is the whole bug.
#
# Needs a working docker. This check inspects running containers, so unlike the other gates
# in scripts/ it belongs to the box and to deploy.sh, not to a CI lint job.
set -uo pipefail

if ! docker info >/dev/null 2>&1; then
  echo 'FAIL: no usable docker — this check cannot be verified here, and a silent skip'
  echo '      would read exactly like a pass. Run it where the stack runs.'
  exit 1
fi

NAME=hydromart-drift-selftest
# HD-1: a container of ANOTHER compose project with the same stale mount. deploy.sh restarts
# what the check lists, so it must never list this one.
OTHER=hydromart-drift-selftest-other
CONF="$(mktemp)"
cleanup() { docker rm -f "$NAME" "$OTHER" >/dev/null 2>&1; rm -f "$CONF" "$CONF.new"; }
trap cleanup EXIT
cleanup

printf 'setting = one\n' > "$CONF"
for c in "$NAME:hydromart" "$OTHER:another-project"; do
  docker run -d --name "${c%%:*}" --label "com.docker.compose.project=${c#*:}" \
    -v "$CONF:/etc/probe.conf:ro" alpine:3.20 sleep 120 >/dev/null || {
    echo 'FAIL: could not start the fixture containers'
    exit 1
  }
done

if ! bash scripts/check-config-drift.sh >/tmp/drift1.out 2>&1; then
  echo 'FAIL: reported drift while the file and the container agreed'
  cat /tmp/drift1.out
  exit 1
fi
echo 'ok: an in-sync bind mount is not reported'

# Exactly what git does: write a new file, move it over the old name. Same path, new inode.
printf 'setting = two\n' > "$CONF.new"
mv "$CONF.new" "$CONF"

if bash scripts/check-config-drift.sh >/tmp/drift2.out 2>&1; then
  echo 'FAIL: the container is running a stale file and the gate passed'
  cat /tmp/drift2.out
  exit 1
fi
grep -q "$NAME" /tmp/drift2.out || {
  echo 'FAIL: drift was reported but not for the container that has it'
  cat /tmp/drift2.out
  exit 1
}
grep -q 'restart' /tmp/drift2.out || {
  echo 'FAIL: the report does not say how to fix it'
  exit 1
}
echo 'ok: a replaced-on-disk file IS reported, naming the container and the fix'
if grep -q "$OTHER" /tmp/drift2.out; then
  echo "FAIL: reported $OTHER, a container of another compose project (deploy.sh would restart it)"
  exit 1
fi
echo 'ok: the same drift in another compose project is not reported'

# The remedy the report prints, executed. This assertion exists because the first draft of
# the checker asserted the OPPOSITE — that a restart could not clear the drift and only a
# recreate would — and running this proved that wrong. Keeping it means the advice the
# report gives is re-proven on every run instead of being folklore.
docker restart "$NAME" >/dev/null 2>&1
if ! bash scripts/check-config-drift.sh >/tmp/drift3.out 2>&1; then
  echo 'FAIL: a restart did not clear the drift, so the fix the report prints is wrong'
  cat /tmp/drift3.out
  exit 1
fi
echo 'ok: restart clears it, which is what the report tells the operator to do'
