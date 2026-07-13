#!/bin/sh
# POST an internal sweep endpoint on order-service, authed by the shared key.
# Invoked by crond (see crontab). Arg is the route after /api/v1/.
#   sh sweep.sh subscriptions/process-due
set -eu
. /tmp/sweep.env   # exports INTERNAL_SERVICE_KEY (crond children don't inherit it)

path="$1"
now="$(date -u +%FT%TZ)"
if wget -q -O- --header="x-internal-key: ${INTERNAL_SERVICE_KEY}" \
    --post-data='' "http://order:3004/api/v1/${path}"; then
  echo "${now} swept ${path}"
else
  echo "${now} FAILED ${path}" >&2
fi
