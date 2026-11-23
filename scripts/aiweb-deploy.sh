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
#   2. Its database up and healthy, then infra/aiweb/roles.sql: both roles exist, the owner's and
#      the superuser's passwords match .env, database ai and its default privileges.
#   3. The migration job, as the owning role, for at most AIWEB_MIGRATE_TIMEOUT (900) seconds. A
#      failure stops here: the app is not swapped and ai_app's password is not touched.
#   4. infra/aiweb/app-role.sql: ai_app's password, set only now. Until a release gets this far,
#      the database keeps the password the running app was started with, so a failed release
#      never locks the running app out, even when it recreated the database container.
#   5. The app up and healthy. /api/health answers 503 for a role that gets past row level
#      security, so a wrong DATABASE_URL fails here rather than serving.
#   6. The probe: what the containers are attached to and publish, what the app can open from
#      inside its own container (its database must open; no address of any hydromart container
#      may answer at all), Caddy's way in, the public URL, the sign-in path, ai_app's privileges.
#
# Hydromart is never touched: every compose call here names infra/aiweb/ and nothing else. Every
# failure ends with exit 1, a `!!` line naming the step, and one alert (alert_once aiweb, again
# when the reason or the release changes, else weekly). deploy.sh logs it and goes on, so the AI
# web can never fail hydromart's deploy; it also stops this script after 30 minutes.
#
# Env: GHCR_TOKEN, GHCR_USER   from deploy.yml; only needed when an image is missing here.
#      AIWEB_COMPOSE, AI_PROJECT, HYDROMART_PROJECT, AIWEB_URL_CHECK=0, AIWEB_MIGRATE_TIMEOUT
#      overrides for a run off the box (a laptop: another project name and overlay, no public
#      URL to ask) and for the self-test.
#
# Exit: 0 deployed (or probed) and isolated · 1 not deployed, or the probe found a problem.

# The registry token, FIRST: into shell variables, out of the environment, not exported, before
# any other command runs. No child of this script (compose, curl, docker exec, the alert) ever
# inherits it; only the printf that feeds `docker login --password-stdin` reads it.
ghcr_token="${GHCR_TOKEN:-}"
ghcr_user="${GHCR_USER:-}"
unset GHCR_TOKEN GHCR_USER
export -n ghcr_token ghcr_user

set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib/deploy-common.sh
. scripts/lib/deploy-common.sh

AIWEB_FILE=infra/aiweb/docker-compose.yml
AIWEB_COMPOSE="${AIWEB_COMPOSE:-docker compose -f $AIWEB_FILE --env-file .env}"
HYDROMART_PROJECT="${HYDROMART_PROJECT:-hydromart}"
AI_PROJECT="${AI_PROJECT:-$(sed -n 's/^name: *//p' "$AIWEB_FILE" | tr -d "\"' \r")}"
MIGRATE_TIMEOUT="${AIWEB_MIGRATE_TIMEOUT:-900}"
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
  # alert() writes the text into JSON as it is: no quote, no backslash, no newline may reach it.
  alert_once aiweb "AI web $RELEASE NOT deployed or not isolated: $(printf '%s' "$1" | tr -d '"\\' | tr '\n' ' ' | cut -c1-400)"
  exit 1
}

# The throwaway registry login. Logged out and deleted however this script ends, including when
# deploy.sh's 30-minute timeout stops it: the signal still ends in one alert and the logout.
CFG=''
logout() {
  [ -n "$CFG" ] || return 0
  DOCKER_CONFIG="$CFG" docker logout ghcr.io >/dev/null 2>&1 || true
  rm -rf "$CFG"
  CFG=''
}
trap logout EXIT
# remove_migrate_leftovers (below) because a migration job outlives the compose client stopped
# with it, and would hold the migration lock against the next release.
trap 'remove_migrate_leftovers; fail "stopped by a signal before it finished (deploy.sh allows it 30 minutes); the last [aiweb] line above is where it stopped"' TERM INT

# A key with a value in .env. Read as data, never sourced, with one layer of quotes removed the
# way compose reads it, so AIWEB_X="" is no value.
has_value() {
  local v
  v="$(tr -d '\r' < .env 2>/dev/null | sed -n "s/^$1=//p" | tail -1)"
  case "$v" in
    \"*\") v="${v#\"}" && v="${v%\"}" ;;
    \'*\') v="${v#\'}" && v="${v%\'}" ;;
  esac
  [ -n "${v//[[:space:]]/}" ]
}

pull() {
  local ref
  if [ -z "$ghcr_token" ]; then
    case " $* " in
      *" ghcr.io/"*) fail "the release's images are not on this box and there is no registry token to pull them: deploy through the Deploy workflow, which hands the box its own short-lived token" ;;
    esac
  fi
  CFG="$(mktemp -d)"
  if [ -n "$ghcr_token" ]; then
    # On stdin, never as an argument (`ps` shows arguments to every user) or in the environment.
    if ! printf '%s' "$ghcr_token" |
      DOCKER_CONFIG="$CFG" docker login ghcr.io -u "${ghcr_user:-github-actions}" --password-stdin >/dev/null 2>&1; then
      fail "ghcr.io refused the deploy job's token (has the hydromart-ai package given this repository's Actions read access?)"
    fi
  fi
  for ref in "$@"; do
    say "pulling $ref"
    # --foreground: in deploy.sh's process group, so its 30-minute TERM reaches the pull too.
    if ! DOCKER_CONFIG="$CFG" timeout --foreground 600 docker pull --quiet "$ref" >/dev/null; then
      fail "could not pull $ref (denied, no longer in the registry, or no answer in 10 minutes)"
    fi
  done
  logout
}

# What a migration job stopped by its timeout leaves behind: `timeout` ends the compose client,
# not the container it started.
remove_migrate_leftovers() {
  local ids
  ids="$(docker ps -aq --filter "label=com.docker.compose.project=$AI_PROJECT" \
    --filter label=com.docker.compose.service=migrate 2>/dev/null || true)"
  [ -n "$ids" ] || return 0
  # shellcheck disable=SC2086 # one argument per container
  docker rm -f $ids >/dev/null 2>&1 || say "!! could not remove the stopped migration job's container(s): $ids"
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

# PURE: what one outcome of scripts/lib/tcp-reach.cjs means for one kind of target.
#   control    db:5432, the app's own database: must open, or no answer below proves anything
#   container  an address a hydromart container holds on a network other than edge: isolated
#              only if nothing comes back (timeout) or there is no route (unreachable); an
#              answer of any kind, a connection or an RST, means the packets get there
#   name       one of hydromart's service names: not resolving is said, never counted as a pass
#   front      Caddy's address on edge, where the AI web is MEANT to reach it: 80 and 443 may
#              open; any other port of it (the admin API on 2019) must not
#   host       the host, through the edge gateway, on a port hydromart publishes: must not open
#   info       printed, never judged (the host's ssh, the cloud metadata address)
judge() { # <kind> <outcome> <port>
  case "$1:$2" in
    control:open) echo ok ;;
    control:*) echo blind ;;
    info:open) echo "reachable (informational)" ;;
    info:*) echo "not reachable (informational)" ;;
    name:not-found) echo "does not resolve (informational)" ;;
    container:timeout | container:unreachable | name:timeout | name:unreachable) echo isolated ;;
    container:open | container:refused | name:open | name:refused) echo breach ;;
    front:open) case "$3" in 80 | 443) echo "Caddy's public port" ;; *) echo breach ;; esac ;;
    front:refused | front:timeout | front:unreachable | host:refused | host:timeout | host:unreachable) echo closed ;;
    host:open) echo breach ;;
    *) echo blind ;;
  esac
}

probe() {
  local app id line who nets binds n allowed members plan name pairs ports tcp p pair net ip kind count
  local edge_gw host_ports results target label outcome code verdict isolated caddy code jwks grants t
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

  # 3. From INSIDE the app's container, every address of every running hydromart container on
  # every TCP port it exposes, read off docker rather than listed here, so a container added
  # tomorrow is tried tomorrow. One line per target: `<kind> <host:port> <label>`.
  plan="control db:5432 own-database"$'\n'
  for t in postgres:5432 hydromart-postgres:5432 gateway:8080 auth:3001 web:3000; do
    plan+="name $t service-name"$'\n'
  done
  count=0
  for id in $(docker ps -q --filter "label=com.docker.compose.project=$HYDROMART_PROJECT"); do
    line="$(docker inspect --format '{{.Name}}|{{range $k, $v := .NetworkSettings.Networks}}{{$k}}={{$v.IPAddress}} {{end}}|{{range $k, $v := .Config.ExposedPorts}}{{$k}} {{end}}' "$id")"
    IFS='|' read -r name pairs ports <<<"$line"
    name="${name#/}"
    count=$((count + 1))
    tcp=''
    for p in $ports; do
      case "$p" in */tcp) tcp+=" ${p%/tcp}" ;; esac
    done
    if [ -z "$tcp" ]; then
      say "probe: $name exposes no TCP port, so none of its addresses was tried"
      continue
    fi
    for pair in $pairs; do
      net="${pair%%=*}"
      ip="${pair#*=}"
      [ -n "$ip" ] || continue
      kind=container
      [ "$net" = edge ] && kind=front
      for p in $tcp; do plan+="$kind $ip:$p $name@$net"$'\n'; done
    done
  done
  [ "$count" -gt 0 ] || note "probe: no running container of project $HYDROMART_PROJECT was found, so not one hydromart address was tried"
  # The host through the edge gateway, on every port hydromart publishes but Caddy's 80 and 443:
  # loopback-bound today, and anything published wider (PUBLIC_BIND=0.0.0.0) is what this catches.
  edge_gw="$(docker network inspect edge --format '{{range .IPAM.Config}}{{.Gateway}} {{end}}' 2>/dev/null | awk '{print $1}' || true)"
  host_ports="$(docker ps --filter "label=com.docker.compose.project=$HYDROMART_PROJECT" --format '{{.Ports}}' |
    grep -oE ':[0-9]+->' | sed 's/[^0-9]//g' | sort -un | grep -vxE '80|443' || true)"
  if [ -z "$edge_gw" ]; then
    note "probe: the edge network has no gateway address, so the host's ports were not tried"
  else
    for p in $host_ports; do plan+="host $edge_gw:$p host"$'\n'; done
    plan+="info $edge_gw:22 host-ssh"$'\n'
  fi
  plan+="info 169.254.169.254:80 cloud-metadata"$'\n'

  # shellcheck disable=SC2046 # one argument per target
  results="$(docker exec -i "$app" node - $(awk '{print $2}' <<<"$plan") < scripts/lib/tcp-reach.cjs 2>&1 || true)"
  isolated=0
  while read -r kind target label; do
    [ -n "$kind" ] || continue
    read -r outcome code < <(awk -v t="$target" '$2 == t { print $1, $3; exit }' <<<"$results")
    verdict="$(judge "$kind" "${outcome:-none}" "${target##*:}")"
    say "probe: $label $target ${outcome:-no-answer}/${code:-none} -> $verdict"
    case "$verdict" in
      isolated) isolated=$((isolated + 1)) ;;
      breach) note "isolation: the AI web reaches $label at $target (${outcome})" ;;
      blind)
        if [ "$kind" = control ]; then
          note "probe: the AI web could not open its own database (db:5432: ${outcome:-no answer}), so no isolated line proves anything"
        else
          note "probe: no usable answer for $label at $target (${outcome:-none} ${code:-})"
        fi
        ;;
    esac
    outcome=''
    code=''
  done <<<"$plan"
  say "probe: $isolated hydromart address(es) and name(s) isolated, across $count running container(s)"

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
  local key missing='' ref images=() absent=() rc
  for key in AIWEB_POSTGRES_PASSWORD AIWEB_DB_OWNER_PASSWORD AIWEB_DB_APP_PASSWORD; do
    has_value "$key" || missing+=" $key"
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

  # 2. Database, and what the migration needs from it. ai_app's password is left alone here.
  $AIWEB_COMPOSE up -d --wait --wait-timeout 180 db || fail "its database did not come up healthy"
  $AIWEB_COMPOSE exec -T db psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -f - \
    < infra/aiweb/roles.sql >/dev/null ||
    fail "infra/aiweb/roles.sql failed, so the roles and database are not as the migration needs them"
  say "database: up; ai_owner owns ai, ai_app exists, default privileges in place"

  # 3. Migrations, as the owner, before the app, and bounded: a hung job must not hold the deploy.
  # --foreground keeps the compose client in this script's process group, so deploy.sh's own
  # timeout reaches it as well.
  rc=0
  timeout --foreground --kill-after=30 "$MIGRATE_TIMEOUT" \
    $AIWEB_COMPOSE --profile migrate run --rm --no-deps -T migrate </dev/null || rc=$?
  if [ "$rc" = 124 ] || [ "$rc" = 137 ]; then
    remove_migrate_leftovers
    fail "the migration job ran past ${MIGRATE_TIMEOUT}s and was stopped, its container removed; the app and ai_app's password were left as they were. Read the migration state (prisma migrate status, as ai_owner) before the next release"
  elif [ "$rc" != 0 ]; then
    fail "the migration job failed as ai_owner (exit $rc); the app and ai_app's password were left as they were"
  fi

  # 4. ai_app's password, only now that the release has migrated.
  $AIWEB_COMPOSE exec -T db psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -f - \
    < infra/aiweb/app-role.sql >/dev/null ||
    fail "infra/aiweb/app-role.sql failed, so ai_app is not as the app needs it; the app was left as it was"
  say "database: ai_app (rows only) carries the password .env gives the app"

  # 5. The app.
  if ! $AIWEB_COMPOSE up -d --remove-orphans --wait --wait-timeout 180; then
    $AIWEB_COMPOSE logs --tail 20 aiweb 2>&1 | sed 's/^/   /' || true
    fail "the app did not become healthy: /api/health is 503 when the database is unreachable or ai_app gets past row level security"
  fi
  say "app: healthy"

  # 6. The probe.
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
