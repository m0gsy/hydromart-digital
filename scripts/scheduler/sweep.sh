#!/bin/sh
# POST an internal sweep endpoint on a service, authed by the shared key.
# Invoked by crond (see crontab). Arg 1 is the route after /api/v1/; arg 2 is the
# target service host:port (default order:3004).
#   sh sweep.sh subscriptions/process-due
#   sh sweep.sh proofs/purge-expired delivery:3006
set -eu
. /tmp/sweep.env   # exports INTERNAL_SERVICE_KEY (crond children don't inherit it)

path="$1"
host="${2:-order:3004}"
now="$(date -u +%FT%TZ)"
if wget -q -O- --header="x-internal-key: ${INTERNAL_SERVICE_KEY}" \
    --post-data='' "http://${host}/api/v1/${path}"; then
  echo "${now} swept ${path}"
else
  echo "${now} FAILED ${path}" >&2
fi
