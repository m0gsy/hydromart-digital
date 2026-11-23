#!/usr/bin/env bash
# HD-9: deploy the AI web (m0gsy/hydromart-ai), the second compose project on this box, and prove
# it is isolated from hydromart.
#
#   bash scripts/aiweb-deploy.sh           # scripts/deploy.sh runs this once DEPLOY OK is written
#   bash scripts/aiweb-deploy.sh --probe   # the probe alone, against what is running now
#
# The release is what infra/aiweb/docker-compose.yml pins; this script never picks a version.
#   1. Every image it names present. A missing one is pulled BY DIGEST, logged in with the deploy
#      job's own GITHUB_TOKEN (packages: read) inside a throwaway docker config, logged out and
#      deleted straight after. Nothing long-lived is left on the box.
#   2. Its database up and healthy, then infra/aiweb/roles.sql: the two roles, re-asserted.
#   3. The migration job, as the owning role. A failure stops here: the app is not swapped.
#   4. The app up and healthy. /api/health answers 503 for a role that gets past row level
#      security, so a wrong DATABASE_URL fails here rather than serving.
#   5. The probe: what the containers are attached to and publish, what the app can open from
#      inside its own container (its database must open; hydromart's must not), Caddy's way in,
#      the public URL, the sign-in path and ai_app's privileges.
#
# Hydromart is never touched: every compose call here names infra/aiweb/ and nothing else. Every
# failure ends with exit 1, a `!!` line naming the step, and one alert (alert_once aiweb, again
# when the reason or the release changes, else weekly). deploy.sh logs it and goes on, so the AI
# web can never fail hydromart's deploy.
#
# Env: GHCR_TOKEN, GHCR_USER   from deploy.yml; only needed when an image is missing here.
#      AIWEB_COMPOSE, AI_PROJECT, HYDROMART_PROJECT, AIWEB_URL_CHECK=0   overrides for a run off
#      the box (a laptop: another project name and overlay, no public URL to ask).
#
# Exit: 0 deployed (or probed) and isolated · 1 not deployed, or the probe found a problem.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib/deploy-common.sh
. scripts/lib/deploy-common.sh

AIWEB_FILE=infra/aiweb/docker-compose.yml
AIWEB_COMPOSE="${AIWEB_COMPOSE:-docker compose -f $AIWEB_FILE --env-file .env}"
HYDROMART_PROJECT="${HYDROMART_PROJECT:-hydromart}"
AI_PROJECT="${AI_PROJECT:-$(sed -n 's/^name: *//p' "$AIWEB_FILE" | tr -d "\"' \r")}"
# Literals in the compose file, read from it so they are written in one place.
setting() { sed -n "s/^ *$1: *//p" "$AIWEB_FILE" | head -1 | tr -d "\"' \r"; }
AI_WEB_URL="$(setting AI_WEB_URL)"
HYDROMART_API_URL="$(setting HYDROMART_API_URL)"
APP_IMAGE="$(sed -n '/^  aiweb:/,/^  [a-z]/s/^ *image: *//p' "$AIWEB_FILE" | head -1)"
RELEASE="${APP_IMAGE##*@sha256:}"
RELEASE="${RELEASE:0:12}"

say() { echo "[aiweb] $*"; }
fail() {
  say "!! $1"
  say "   hydromart is unaffected: nothing here touches its project."
  # alert() writes the text into JSON unescaped, so no double quote may reach it.
  alert_once aiweb "AI web $RELEASE NOT deployed or not isolated: $(printf '%s' "$1" | tr -d '"' | cut -c1-400)"
  exit 1
}

# The throwaway registry login. Logged out and deleted however this script ends.
CFG=''
logout() {
  [ -n "$CFG" ] || return 0
  DOCKER_CONFIG="$CFG" docker logout ghcr.io >/dev/null 2>&1 || true
  rm -rf "$CFG"
  CFG=''
}
trap logout EXIT

pull() {
  local ref
  if [ -z "${GHCR_TOKEN:-}" ]; then
    case " $* " in
      *" ghcr.io/"*) fail "the release's images are not on this box and there is no registry token to pull them: deploy through the Deploy workflow, which hands the box its own short-lived token" ;;
    esac
  fi
  CFG="$(mktemp -d)"
  if [ -n "${GHCR_TOKEN:-}" ]; then
    # The token goes in on stdin, never as an argument (`ps` shows arguments to every user).
    if ! printf '%s' "$GHCR_TOKEN" |
      DOCKER_CONFIG="$CFG" docker login ghcr.io -u "${GHCR_USER:-github-actions}" --password-stdin >/dev/null 2>&1; then
      fail "ghcr.io refused the deploy job's token (has the hydromart-ai package given this repository's Actions read access?)"
    fi
  fi
  for ref in "$@"; do
    say "pulling $ref"
    if ! DOCKER_CONFIG="$CFG" timeout 600 docker pull --quiet "$ref" >/dev/null; then
      fail "could not pull $ref (denied, no longer in the registry, or no answer in 10 minutes)"
    fi
  done
  logout
}

# ------------------------------------------------------------------------------------- probe
PROBLEMS=''
note() {
  say "!! $1"
  PROBLEMS+="$1; "
}

# A running container of hydromart's, by its compose service.
hydromart_container() {
  docker ps -q --filter "label=com.docker.compose.project=$HYDROMART_PROJECT" \
    --filter "label=com.docker.compose.service=$1" | head -1
}

probe() {
  local app id line who nets binds n allowed members closed pg gw edge_gw ports p results t caddy code jwks grants
  PROBLEMS=''
  app="$($AIWEB_COMPOSE ps -q aiweb 2>/dev/null | head -1 || true)"
  if [ -z "$app" ]; then
    note "probe: no aiweb container is running"
    return 1
  fi

  # 1. What each AI web container is attached to and publishes. `aiweb` may sit on edge and its
  # private network; anything else of this project on the private network only; none publishes.
  for id in $(docker ps -aq --filter "label=com.docker.compose.project=$AI_PROJECT"); do
    line="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}|{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}|{{range $k, $v := .HostConfig.PortBindings}}{{$k}} {{end}}' "$id")"
    IFS='|' read -r who nets binds <<<"$line"
    allowed=" ${AI_PROJECT}_private "
    [ "$who" = aiweb ] && allowed=" edge ${AI_PROJECT}_private "
    for n in $nets; do
      case "$allowed" in *" $n "*) ;; *) note "isolation: $who is attached to network $n" ;; esac
    done
    if [ -n "${binds// /}" ]; then note "isolation: $who publishes a host port ($binds)"; fi
  done

  # 2. Who else is on edge: whatever is there, the AI web can reach. Caddy and aiweb only.
  if members="$(docker network inspect edge --format '{{range $k, $v := .Containers}}{{$k}} {{end}}' 2>/dev/null)"; then
    for id in $members; do
      who="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}/{{index .Config.Labels "com.docker.compose.service"}}' "$id" 2>/dev/null || true)"
      case "$who" in
        "$HYDROMART_PROJECT/caddy" | "$AI_PROJECT/aiweb") ;;
        *) note "isolation: ${who:-?}(${id:0:12}) is on the edge network, where the AI web can reach it" ;;
      esac
    done
  else
    note "probe: could not inspect the edge network"
  fi

  # 3. From INSIDE the app's container. Its own database must open: that is the control, and a
  # probe that cannot open even that proves nothing with its "closed". Hydromart must stay
  # closed: by name, by address on its own network, and through every host port it publishes
  # (loopback today; anything published wider, say PUBLIC_BIND=0.0.0.0, is what this catches)
  # except Caddy's public 80 and 443, which are the internet's way in and so the AI web's too.
  closed="postgres:5432 hydromart-postgres:5432 gateway:8080 auth:3001 web:3000"
  pg="$(hydromart_container postgres)"
  gw="$(hydromart_container gateway)"
  for id in $pg $gw; do
    for n in $(docker inspect --format '{{range $k, $v := .NetworkSettings.Networks}}{{$v.IPAddress}} {{end}}' "$id"); do
      if [ "$id" = "$pg" ]; then closed+=" $n:5432"; else closed+=" $n:8080"; fi
    done
  done
  [ -n "$pg" ] || note "probe: hydromart's postgres is not running here, so its address was not tried"
  [ -n "$gw" ] || note "probe: hydromart's gateway is not running here, so its address was not tried"
  edge_gw="$(docker network inspect edge --format '{{range .IPAM.Config}}{{.Gateway}} {{end}}' 2>/dev/null | awk '{print $1}' || true)"
  ports="$(docker ps --filter "label=com.docker.compose.project=$HYDROMART_PROJECT" --format '{{.Ports}}' |
    grep -oE ':[0-9]+->' | sed 's/[^0-9]//g' | sort -un | grep -vxE '80|443' || true)"
  if [ -z "$edge_gw" ]; then
    note "probe: the edge network has no gateway address, so the host's ports were not tried"
  else
    for p in $ports; do closed+=" $edge_gw:$p"; done
  fi
  say "probe (inside aiweb): db:5432 must open; must stay closed:$closed"
  # shellcheck disable=SC2086 # one argument per target
  results="$(docker exec -i "$app" node - db:5432 $closed < scripts/lib/tcp-reach.cjs 2>&1 || true)"
  state() { awk -v t="$1" '$2 == t { print $1; exit }' <<<"$results"; }
  if [ "$(state db:5432)" != open ]; then
    note "probe: the AI web could not open its own database (db:5432), so a closed below proves nothing: $(head -c 200 <<<"$results" | tr '\n' ' ')"
  fi
  for t in $closed; do
    case "$(state "$t")" in
      closed) ;;
      open) note "isolation: the AI web can open $t" ;;
      *) note "probe: no answer for $t" ;;
    esac
  done

  # 4. The one way in: Caddy, over edge.
  caddy="$(hydromart_container caddy)"
  if [ -z "$caddy" ]; then
    note "front: hydromart's caddy is not running"
  elif docker exec "$caddy" wget -q -O /dev/null http://aiweb:3000/api/health >/dev/null 2>&1; then
    say "front: Caddy reaches aiweb:3000 over edge"
  else
    note "front: Caddy cannot reach aiweb:3000 over edge, so nothing serves $AI_WEB_URL"
  fi

  # 5. As a browser sees it: DNS, Caddy's certificate, the site file, the app.
  if [ "${AIWEB_URL_CHECK:-1}" = 1 ]; then
    for _ in 1 2 3 4 5 6; do
      code="$(curl -s -o /dev/null -m 15 -w '%{http_code}' "$AI_WEB_URL/api/health" || true)"
      [ "$code" = 200 ] && break
      sleep 10
    done
    if [ "$code" = 200 ]; then
      say "public: $AI_WEB_URL/api/health answers 200"
    else
      note "public: $AI_WEB_URL/api/health answered ${code:-000} (DNS, certificate, the Caddy site or the app)"
    fi
  fi

  # 6. The sign-in reads hydromart's published keys through the public API, the AI web's only
  # sanctioned way to hydromart. An EMPTY key set is the AI-token kill switch: said, not failed.
  # Node's fetch, not busybox wget: wget needs a TLS helper the image may not carry.
  if jwks="$(docker exec "$app" node -e 'fetch(process.argv[1]).then((r) => (r.ok ? r.text() : Promise.reject(r.status))).then((t) => process.stdout.write(t), () => process.exit(1))' \
    "$HYDROMART_API_URL/auth/api/v1/auth/jwks" 2>/dev/null)"; then
    case "$jwks" in
      *'"kid"'*) say "sign-in: the AI web reads hydromart's signing keys at $HYDROMART_API_URL" ;;
      *) say "sign-in: hydromart publishes NO signing key (AI_TOKEN_SIGNING_KEY is blank, the kill switch): nobody can sign in to the AI web until it is set" ;;
    esac
  else
    note "sign-in: the AI web cannot fetch $HYDROMART_API_URL/auth/api/v1/auth/jwks, so nobody can sign in"
  fi

  # 7. hydromart-ai README: the migration takes UPDATE, DELETE and TRUNCATE on the two record
  # tables back from every role but the owner, and everything on _prisma_migrations. A later
  # broad GRANT would undo that quietly, so ai_app must hold exactly INSERT, SELECT on both.
  if grants="$($AIWEB_COMPOSE exec -T db psql -X -tA -U postgres -d ai -c "SELECT table_name || ':' || string_agg(privilege_type, ',' ORDER BY privilege_type) FROM information_schema.role_table_grants WHERE grantee = 'ai_app' GROUP BY table_name ORDER BY 1" 2>/dev/null)"; then
    say "privileges: ai_app holds $(tr '\n' ' ' <<<"$grants")"
    for t in answer_trail kill_switch_events; do
      grep -qx "$t:INSERT,SELECT" <<<"$grants" ||
        note "privileges: ai_app must hold exactly INSERT,SELECT on $t, and holds '$(grep "^$t:" <<<"$grants" | cut -d: -f2)'"
    done
    if grep -q '^_prisma_migrations:' <<<"$grants"; then note "privileges: ai_app holds privileges on _prisma_migrations"; fi
  else
    note "probe: could not read ai_app's privileges"
  fi

  [ -z "$PROBLEMS" ]
}

# ------------------------------------------------------------------------------------ deploy
deploy() {
  local key missing='' ref images=() absent=()
  for key in AIWEB_POSTGRES_PASSWORD AIWEB_DB_OWNER_PASSWORD AIWEB_DB_APP_PASSWORD; do
    grep -qE "^${key}=[^[:space:]]" .env 2>/dev/null || missing+=" $key"
  done
  [ -z "$missing" ] ||
    fail "no value in .env for:$missing (scripts/aiweb-secrets.sh makes one when the line is absent and leaves a blank line alone)"

  # 1. Images.
  mapfile -t images < <($AIWEB_COMPOSE --profile migrate config --images 2>/dev/null || true)
  [ "${#images[@]}" -gt 0 ] || fail "could not read the images $AIWEB_FILE names"
  for ref in "${images[@]}"; do
    case "$ref" in *@sha256:*) ;; *) fail "$ref is not pinned by digest" ;; esac
    docker image inspect "$ref" >/dev/null 2>&1 || absent+=("$ref")
  done
  if [ "${#absent[@]}" -gt 0 ]; then pull "${absent[@]}"; fi
  say "images: release $RELEASE, all ${#images[@]} present"

  # 2. Database and roles.
  $AIWEB_COMPOSE up -d --wait --wait-timeout 180 db || fail "its database did not come up healthy"
  $AIWEB_COMPOSE exec -T db psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -f - \
    < infra/aiweb/roles.sql >/dev/null ||
    fail "infra/aiweb/roles.sql failed, so the roles ai_owner and ai_app are not as the app needs them"
  say "database: up; roles ai_owner (owns ai) and ai_app (rows only) in place"

  # 3. Migrations, as the owner, before the app.
  $AIWEB_COMPOSE --profile migrate run --rm --no-deps -T migrate </dev/null ||
    fail "the migration job failed as ai_owner; the app was left on the release it was already running"

  # 4. The app.
  if ! $AIWEB_COMPOSE up -d --remove-orphans --wait --wait-timeout 180; then
    $AIWEB_COMPOSE logs --tail 20 aiweb 2>&1 | sed 's/^/   /' || true
    fail "the app did not become healthy: /api/health is 503 when the database is unreachable or ai_app gets past row level security"
  fi
  say "app: healthy"

  # 5. The probe.
  probe || fail "probe: ${PROBLEMS%; }"
  alert_clear aiweb
  say "AI web OK: release $RELEASE serves $AI_WEB_URL and cannot reach hydromart"
}

case "${1:-}" in
  '') deploy ;;
  --probe)
    probe || fail "probe: ${PROBLEMS%; }"
    say "probe OK: the running AI web cannot reach hydromart"
    ;;
  *)
    echo "usage: bash scripts/aiweb-deploy.sh [--probe]" >&2
    exit 2
    ;;
esac
