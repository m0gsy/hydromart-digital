#!/bin/sh
# crond starts jobs with a stripped environment, so the shared internal key never
# reaches sweep.sh. Snapshot it to a file the jobs source, then run crond in the
# foreground (-l 8 = log to stderr, visible in `docker compose logs scheduler`).
set -eu
: "${INTERNAL_SERVICE_KEY:?INTERNAL_SERVICE_KEY not set}"
printf 'export INTERNAL_SERVICE_KEY=%s\n' "$INTERNAL_SERVICE_KEY" > /tmp/sweep.env
exec crond -f -l 8
