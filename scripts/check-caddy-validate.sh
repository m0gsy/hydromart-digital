#!/usr/bin/env bash
# `caddy validate` of infra/caddy/ with the Caddy image docker-compose.prod.yml pins by digest:
# the real Caddyfile and every site under sites/, as the box loads them.
#
#   bash scripts/check-caddy-validate.sh
#
# Twice: as git holds it (the staging login is only the unusable 00-locked.caddy, which is how
# the box is until a password is set), and with a stand-in 10-staging.caddy, the file the deploy
# writes from the STAGING_AI_PASSWORD secret. A reload that fails validation keeps the old config
# but blocks every later Caddy change, so a bad site file is caught here, not on the box.
# Needs docker; hash-password has no network use, validate makes no certificate request.
set -euo pipefail
cd "$(dirname "$0")/.."

image="$(sed -n 's/^ *image: *\(caddy:[^ ]*@sha256:[0-9a-f]\{64\}\).*/\1/p' docker-compose.prod.yml | head -1)"
[ -n "$image" ] || { echo "check-caddy-validate: no pinned caddy image in docker-compose.prod.yml" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
validate() { # <label> <dir>
  # The directory is copied into a container, not mounted: it works the same on a laptop and on CI.
  local id
  id="$(docker create -e WEB_DOMAIN=web.example.test -e API_DOMAIN=api.example.test "$image" \
    caddy validate --config /etc/caddy/Caddyfile)"
  docker cp "$2/." "$id:/etc/caddy/" >/dev/null
  if out="$(docker start -a "$id" 2>&1)"; then
    echo "check-caddy-validate: $1: valid"
  else
    echo "$out" | tail -20 >&2
    docker rm -f "$id" >/dev/null
    echo "check-caddy-validate: $1: caddy refused the config" >&2
    exit 1
  fi
  docker rm -f "$id" >/dev/null
}

cp -r infra/caddy "$work/as-in-git"
validate "as in git (no staging password)" "$work/as-in-git"

cp -r infra/caddy "$work/with-hash"
hash="$(printf 'check-caddy-validate-password\n' | docker run --rm -i "$image" caddy hash-password --algorithm bcrypt --bcrypt-cost 10)"
case "$hash" in '$2a$'*) ;; *) echo "check-caddy-validate: hash-password did not print a bcrypt hash" >&2; exit 1 ;; esac
printf 'staging %s\n' "$hash" >"$work/with-hash/staging-auth/10-staging.caddy"
validate "with a staging login hash" "$work/with-hash"
