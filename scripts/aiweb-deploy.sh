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
#   2. Its database up and healthy, then infra/aiweb/roles.sql: the roles exist, the owner's, n8n's
#      and the superuser's passwords match .env, databases ai and n8n and their privileges.
#   3. The migration job, as the owning role, for at most AIWEB_MIGRATE_TIMEOUT (900) seconds. A
#      failure stops here: the app is not swapped and ai_app's password is not touched.
#   4. AI-5, n8n: removed (not merely stopped: a stopped container is one the watchdog starts
#      again), then the n8n-setup job, for at most AIWEB_N8N_SETUP_TIMEOUT (300) seconds, puts the
#      credentials and the workflows git holds into n8n's database. A failure stops here and
#      leaves n8n off: hydromart's events wait in the AI web's hd_events, which it retries without
#      giving up, until a deploy sets n8n up. A blank AIWEB_N8N_MACHINE_SECRET is n8n's kill switch:
#      no setup, and n8n stays removed.
#   5. infra/aiweb/app-role.sql: ai_app's password, set only now. Until a release gets this far,
#      the database keeps the password the running app was started with, so a failed release
#      never locks the running app out, even when it recreated the database container. Last before
#      the swap, n8n's setup included, so that stays true whichever step fails.
#   6. The app and n8n up and healthy. /api/health answers 503 for a role that gets past row level
#      security, so a wrong DATABASE_URL fails here rather than serving.
#   7. The probe: what the containers are attached to and publish, what the app and n8n can open
#      from inside their own containers (their database must open; no address of any hydromart
#      container may answer at all), Caddy's way in, the public URL, the sign-in path from both,
#      the app's way to n8n, ai_app's privileges, and n8n holding exactly what git holds.
#
# Hydromart is never touched: every compose call here names infra/aiweb/ and nothing else. Every
# failure ends with exit 1, a `!!` line naming the step, and one alert (alert_once aiweb, again
# when the reason or the release changes, else weekly). deploy.sh logs it and goes on, so the AI
# web can never fail hydromart's deploy; it also stops this script after 30 minutes.
#
# Env: GHCR_TOKEN, GHCR_USER   from deploy.yml; only needed when an image is missing here.
#      AIWEB_COMPOSE, AI_PROJECT, HYDROMART_PROJECT, AIWEB_URL_CHECK=0, AIWEB_MIGRATE_TIMEOUT,
#      AIWEB_N8N_SETUP_TIMEOUT, AIWEB_N8N_DRIFT_TIMEOUT
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
N8N_SETUP_TIMEOUT="${AIWEB_N8N_SETUP_TIMEOUT:-300}"
DRIFT_TIMEOUT="${AIWEB_N8N_DRIFT_TIMEOUT:-300}"
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
# remove_leftovers (below) because a one-shot job outlives the compose client stopped with it: a
# migration would hold the migration lock against the next release, a setup would go on writing
# n8n's database.
trap 'remove_leftovers migrate; remove_leftovers n8n-setup; fail "stopped by a signal before it finished (deploy.sh allows it 30 minutes); the last [aiweb] line above is where it stopped"' TERM INT

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
# n8n's kill switch: AIWEB_N8N_MACHINE_SECRET kept and blanked. scripts/aiweb-secrets.sh has then
# taken n8n out of MACHINE_ACCOUNTS; here n8n is not set up and not run.
n8n_off() { grep -q '^AIWEB_N8N_MACHINE_SECRET=' .env 2>/dev/null && ! has_value AIWEB_N8N_MACHINE_SECRET; }

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

# What a one-shot job (migrate, n8n-setup) stopped by its timeout leaves behind: `timeout` ends
# the compose client, not the container it started.
remove_leftovers() {
  local ids
  ids="$(docker ps -aq --filter "label=com.docker.compose.project=$AI_PROJECT" \
    --filter "label=com.docker.compose.service=$1" 2>/dev/null || true)"
  [ -n "$ids" ] || return 0
  # shellcheck disable=SC2086 # one argument per container
  docker rm -f $ids >/dev/null 2>&1 || say "!! could not remove the stopped $1 job's container(s): $ids"
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
#   control    db:5432, the container's own database: must open, or no answer below proves anything
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

# Who may sit on a network: anyone else there is someone <who> can reach.
only_members() { # <network> <who> <project/service allowed>...
  local network="$1" reacher="$2" members id who
  shift 2
  if ! members="$(docker network inspect "$network" --format '{{range $k, $v := .Containers}}{{$k}} {{end}}' 2>/dev/null)"; then
    note "probe: could not inspect the $network network"
    return 0
  fi
  for id in $members; do
    who="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}/{{index .Config.Labels "com.docker.compose.service"}}' "$id" 2>/dev/null || true)"
    case " $* " in
      *" $who "*) ;;
      *) note "isolation: ${who:-?}(${id:0:12}) is on the $network network, where $reacher can reach it" ;;
    esac
  done
}

# Every address of every running hydromart container on every TCP port it exposes, read off docker
# rather than listed here, so a container added tomorrow is tried tomorrow. Sets PLAN, one line per
# target, `<kind> <host:port> <label>`, and COUNT, the hydromart containers found.
PLAN=''
COUNT=0
build_plan() {
  local t id line name pairs ports tcp p pair net ip kind edge_gw host_ports
  PLAN="control db:5432 own-database"$'\n'
  for t in postgres:5432 hydromart-postgres:5432 gateway:8080 auth:3001 web:3000; do
    PLAN+="name $t service-name"$'\n'
  done
  COUNT=0
  for id in $(docker ps -q --filter "label=com.docker.compose.project=$HYDROMART_PROJECT"); do
    line="$(docker inspect --format '{{.Name}}|{{range $k, $v := .NetworkSettings.Networks}}{{$k}}={{$v.IPAddress}} {{end}}|{{range $k, $v := .Config.ExposedPorts}}{{$k}} {{end}}' "$id")"
    IFS='|' read -r name pairs ports <<<"$line"
    name="${name#/}"
    COUNT=$((COUNT + 1))
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
      for p in $tcp; do PLAN+="$kind $ip:$p $name@$net"$'\n'; done
    done
  done
  [ "$COUNT" -gt 0 ] || note "probe: no running container of project $HYDROMART_PROJECT was found, so not one hydromart address was tried"
  # The host through the edge gateway, on every port hydromart publishes but Caddy's 80 and 443:
  # loopback-bound today, and anything published wider (PUBLIC_BIND=0.0.0.0) is what this catches.
  edge_gw="$(docker network inspect edge --format '{{range .IPAM.Config}}{{.Gateway}} {{end}}' 2>/dev/null | awk '{print $1}' || true)"
  host_ports="$(docker ps --filter "label=com.docker.compose.project=$HYDROMART_PROJECT" --format '{{.Ports}}' |
    grep -oE ':[0-9]+->' | sed 's/[^0-9]//g' | sort -un | grep -vxE '80|443' || true)"
  if [ -z "$edge_gw" ]; then
    note "probe: the edge network has no gateway address, so the host's ports were not tried"
  else
    for p in $host_ports; do PLAN+="host $edge_gw:$p host"$'\n'; done
    PLAN+="info $edge_gw:22 host-ssh"$'\n'
  fi
  PLAN+="info 169.254.169.254:80 cloud-metadata"$'\n'
}

# The plan, tried from INSIDE one container (the app's, n8n's), every target printed with its
# outcome and judged: only no answer at all, or no route, is isolation.
reach_from() { # <container> <who, for the notes> <tag, for the lines>
  local cid="$1" who="$2" tag="$3" results kind target label outcome code verdict isolated=0
  # shellcheck disable=SC2046 # one argument per target
  results="$(docker exec -i "$cid" node - $(awk '{print $2}' <<<"$PLAN") < scripts/lib/tcp-reach.cjs 2>&1 || true)"
  while read -r kind target label; do
    [ -n "$kind" ] || continue
    read -r outcome code < <(awk -v t="$target" '$2 == t { print $1, $3; exit }' <<<"$results")
    verdict="$(judge "$kind" "${outcome:-none}" "${target##*:}")"
    say "$tag: $label $target ${outcome:-no-answer}/${code:-none} -> $verdict"
    case "$verdict" in
      isolated) isolated=$((isolated + 1)) ;;
      breach) note "isolation: $who reaches $label at $target (${outcome})" ;;
      blind)
        if [ "$kind" = control ]; then
          note "probe: $who could not open its own database (db:5432: ${outcome:-no answer}), so no isolated line proves anything"
        else
          note "$tag: no usable answer for $label at $target (${outcome:-none} ${code:-})"
        fi
        ;;
    esac
    outcome=''
    code=''
  done <<<"$PLAN"
  say "$tag: $isolated hydromart address(es) and name(s) isolated, across $COUNT running container(s)"
}

# The JWKS through the public API, from inside a container: Node's fetch, not busybox wget, which
# needs a TLS helper the image may not carry. Prints the key set; fails when it cannot be read.
jwks_from() {
  docker exec "$1" node -e 'fetch(process.argv[1]).then((r) => (r.ok ? r.text() : Promise.reject(r.status))).then((t) => process.stdout.write(t), () => process.exit(1))' \
    "$HYDROMART_API_URL/auth/api/v1/auth/jwks" 2>/dev/null
}

probe() {
  local app n8n id line who nets binds n allowed caddy code jwks grants t out rc
  PROBLEMS=''
  app="$($AIWEB_COMPOSE ps -q aiweb 2>/dev/null | head -1 || true)"
  if [ -z "$app" ]; then
    note "probe: no aiweb container is running"
    return 1
  fi
  n8n="$($AIWEB_COMPOSE ps -q n8n 2>/dev/null | head -1 || true)"
  if n8n_off; then
    if [ -n "$n8n" ]; then
      note "probe: n8n runs although AIWEB_N8N_MACHINE_SECRET is blank (its kill switch): a deploy removes it"
    else
      say "probe: n8n is switched off (AIWEB_N8N_MACHINE_SECRET is blank), so there is nothing of it to probe"
    fi
  elif [ -z "$n8n" ]; then
    note "probe: no n8n container is running"
  fi

  # 1. What each AI web container is attached to and publishes. `aiweb` may sit on edge and its
  # private network, n8n on the private network and its egress network, anything else of this
  # project on the private network only. None publishes but n8n's editor, on loopback.
  for id in $(docker ps -aq --filter "label=com.docker.compose.project=$AI_PROJECT"); do
    line="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}|{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}|{{range $k, $v := .HostConfig.PortBindings}}{{range $v}}{{.HostIp}}:{{.HostPort}}->{{$k}} {{end}}{{end}}' "$id")"
    IFS='|' read -r who nets binds <<<"$line"
    case "$who" in
      aiweb) allowed=" edge ${AI_PROJECT}_private " ;;
      n8n) allowed=" ${AI_PROJECT}_private ${AI_PROJECT}_egress " ;;
      *) allowed=" ${AI_PROJECT}_private " ;;
    esac
    for n in $nets; do
      case "$allowed" in *" $n "*) ;; *) note "isolation: $who is attached to network $n" ;; esac
    done
    # shellcheck disable=SC2086 # split and joined again: trims the spaces the template leaves
    binds="$(echo $binds)"
    if [ -n "$binds" ] && ! { [ "$who" = n8n ] && [ "$binds" = "127.0.0.1:5678->5678/tcp" ]; }; then
      note "isolation: $who publishes a host port ($binds)"
    fi
  done

  # 2. Who else is on the two networks that leave the box: whatever is there, the AI web (on edge)
  # or n8n (on egress) can reach. Caddy and aiweb on edge, n8n alone on egress.
  only_members edge "the AI web" "$HYDROMART_PROJECT/caddy" "$AI_PROJECT/aiweb"
  if [ -n "$n8n" ]; then only_members "${AI_PROJECT}_egress" n8n "$AI_PROJECT/n8n"; fi

  # 3. From INSIDE the app's container, then n8n's: no hydromart address may answer either.
  build_plan
  reach_from "$app" "the AI web" probe
  if [ -n "$n8n" ]; then reach_from "$n8n" n8n "probe(n8n)"; fi

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
  if jwks="$(jwks_from "$app")"; then
    case "$jwks" in
      *'"kid"'*) say "sign-in: the AI web reads hydromart's signing keys at $HYDROMART_API_URL" ;;
      *) say "sign-in: hydromart publishes NO signing key (AI_TOKEN_SIGNING_KEY is blank, the kill switch): nobody can sign in to the AI web until it is set" ;;
    esac
  else
    note "sign-in: the AI web cannot fetch $HYDROMART_API_URL/auth/api/v1/auth/jwks, so nobody can sign in"
  fi

  # 7. n8n (AI-5): it reaches hydromart the same way, through its egress network (a workflow's
  # every call does); the app reaches it on the private network (every event does); and what it
  # has published, and the credentials it holds, are what the image's copy of git holds
  # (hydromart-ai's n8n/bin/drift.mjs: exit 1 drift, 2 could not check).
  if [ -n "$n8n" ]; then
    if jwks_from "$n8n" >/dev/null; then
      say "n8n: reaches $HYDROMART_API_URL over its egress network"
    else
      note "n8n: cannot fetch $HYDROMART_API_URL/auth/api/v1/auth/jwks over its egress network, so no workflow reaches hydromart"
    fi
    if docker exec "$app" wget -q -O /dev/null http://n8n:5678/healthz >/dev/null 2>&1; then
      say "n8n: the AI web reaches http://n8n:5678/healthz"
    else
      note "n8n: the AI web cannot reach http://n8n:5678/healthz, so no event reaches a workflow"
    fi
    if out="$(timeout "$DRIFT_TIMEOUT" docker exec "$n8n" node /opt/hydromart/bin/drift.mjs 2>&1)"; then
      say "n8n: $(tail -1 <<<"$out")"
    else
      rc=$?
      note "n8n: drift.mjs exit $rc (1 drift, 2 could not check, 124 no answer in ${DRIFT_TIMEOUT}s): $(tr '\n' ' ' <<<"$out" | cut -c1-300)"
    fi
  fi

  # 8. hydromart-ai README: the migrations take UPDATE, DELETE and TRUNCATE on the two record
  # tables back from every role but the owner, DELETE and TRUNCATE on hd_events (its dedupe
  # ledger, kept for good), and everything on _prisma_migrations. A later broad GRANT would undo
  # that quietly, so ai_app must hold exactly INSERT, SELECT on the record tables and INSERT,
  # SELECT, UPDATE on hd_events.
  if grants="$($AIWEB_COMPOSE exec -T db psql -X -tA -U postgres -d ai -c "SELECT table_name || ':' || string_agg(privilege_type, ',' ORDER BY privilege_type) FROM information_schema.role_table_grants WHERE grantee = 'ai_app' GROUP BY table_name ORDER BY 1" 2>/dev/null)"; then
    say "privileges: ai_app holds $(tr '\n' ' ' <<<"$grants")"
    for t in answer_trail:INSERT,SELECT kill_switch_events:INSERT,SELECT hd_events:INSERT,SELECT,UPDATE; do
      grep -qx "$t" <<<"$grants" ||
        note "privileges: ai_app must hold exactly ${t#*:} on ${t%%:*}, and holds '$(grep "^${t%%:*}:" <<<"$grants" | cut -d: -f2)'"
    done
    if grep -q '^_prisma_migrations:' <<<"$grants"; then note "privileges: ai_app holds privileges on _prisma_migrations"; fi
  else
    note "probe: could not read ai_app's privileges"
  fi
  # The grants above are the ones made to ai_app BY NAME. What it can actually do also comes from
  # PUBLIC and from any role it is a member of, so the rows that must never be rewritten or lost
  # are asked about as Postgres decides: no UPDATE/DELETE/TRUNCATE on the two records, no
  # DELETE/TRUNCATE on the dedupe ledger, and no membership in the role that owns them.
  if effective="$($AIWEB_COMPOSE exec -T db psql -X -tA -U postgres -d ai -c "SELECT string_agg(t || ':' || p, ' ' ORDER BY t, p) FROM (VALUES ('answer_trail','UPDATE'),('answer_trail','DELETE'),('answer_trail','TRUNCATE'),('kill_switch_events','UPDATE'),('kill_switch_events','DELETE'),('kill_switch_events','TRUNCATE'),('hd_events','DELETE'),('hd_events','TRUNCATE')) AS x(t, p) WHERE has_table_privilege('ai_app', 'public.' || t, p) OR pg_has_role('ai_app', (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = t), 'MEMBER')" 2>/dev/null)"; then
    if [ -n "${effective// /}" ]; then note "privileges: ai_app can, in effect (PUBLIC or a role it belongs to): $effective"; fi
  else
    note "probe: could not ask Postgres what ai_app can do in effect"
  fi

  [ -z "$PROBLEMS" ]
}

# ------------------------------------------------------------------------------------ deploy
deploy() {
  local key missing='' ref images=() absent=() rc scale=''
  for key in AIWEB_POSTGRES_PASSWORD AIWEB_DB_OWNER_PASSWORD AIWEB_DB_APP_PASSWORD \
    AIWEB_N8N_DB_PASSWORD AIWEB_N8N_ENCRYPTION_KEY AIWEB_N8N_TOKEN AIWEB_N8N_MACHINE_ID; do
    has_value "$key" || missing+=" $key"
  done
  # Blank is a decision (n8n's kill switch); absent is a key aiweb-secrets.sh did not make.
  grep -q '^AIWEB_N8N_MACHINE_SECRET=' .env 2>/dev/null || missing+=" AIWEB_N8N_MACHINE_SECRET"
  [ -z "$missing" ] ||
    fail "no value in .env for:$missing (scripts/aiweb-secrets.sh makes one when the line is absent and leaves a blank line alone)"

  # 1. Images, the one-shot jobs' included, each once (n8n and its setup run one image).
  mapfile -t images < <($AIWEB_COMPOSE --profile migrate --profile n8n-setup config --images 2>/dev/null | sort -u || true)
  [ "${#images[@]}" -gt 0 ] || fail "could not read the images $AIWEB_FILE names"
  for ref in "${images[@]}"; do
    case "$ref" in *@sha256:*) ;; *) fail "$ref is not pinned by digest" ;; esac
    docker image inspect "$ref" >/dev/null 2>&1 || absent+=("$ref")
  done
  if [ "${#absent[@]}" -gt 0 ]; then pull "${absent[@]}"; fi
  say "images: release $RELEASE, all ${#images[@]} present"

  # 2. Database, and what the migration and n8n need from it. ai_app's password is left alone here.
  $AIWEB_COMPOSE up -d --wait --wait-timeout 180 db || fail "its database did not come up healthy"
  $AIWEB_COMPOSE exec -T db psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -f - \
    < infra/aiweb/roles.sql >/dev/null ||
    fail "infra/aiweb/roles.sql failed, so the roles and databases are not as the migration and n8n need them"
  say "database: up; ai_owner owns ai, n8n owns n8n, ai_app exists, default privileges in place"

  # 3. Migrations, as the owner, before the app, and bounded: a hung job must not hold the deploy.
  # --foreground keeps the compose client in this script's process group, so deploy.sh's own
  # timeout reaches it as well.
  rc=0
  timeout --foreground --kill-after=30 "$MIGRATE_TIMEOUT" \
    $AIWEB_COMPOSE --profile migrate run --rm --no-deps -T migrate </dev/null || rc=$?
  if [ "$rc" = 124 ] || [ "$rc" = 137 ]; then
    remove_leftovers migrate
    fail "the migration job ran past ${MIGRATE_TIMEOUT}s and was stopped, its container removed; the app and ai_app's password were left as they were. Read the migration state (prisma migrate status, as ai_owner) before the next release"
  elif [ "$rc" != 0 ]; then
    fail "the migration job failed as ai_owner (exit $rc); the app and ai_app's password were left as they were"
  fi

  # 4. n8n (AI-5). setup.mjs rewrites n8n's database while n8n is down: n8n is removed, not only
  # stopped, because a stopped container is one the watchdog starts again, half set up, should the
  # job fail. `up` below creates it again from this release's compose file.
  if n8n_off; then
    scale='--scale n8n=0'
    say "n8n: switched off (AIWEB_N8N_MACHINE_SECRET is blank, its kill switch): not set up, and removed below; hydromart's events wait in the AI web's hd_events"
  else
    $AIWEB_COMPOSE rm --stop --force n8n || fail "could not stop and remove n8n before its setup"
    rc=0
    timeout --foreground --kill-after=30 "$N8N_SETUP_TIMEOUT" \
      $AIWEB_COMPOSE --profile n8n-setup run --rm --no-deps -T n8n-setup </dev/null || rc=$?
    if [ "$rc" != 0 ]; then
      remove_leftovers n8n-setup
      fail "n8n's setup failed (exit $rc; 124 or 137 = stopped after ${N8N_SETUP_TIMEOUT}s), its [n8n-setup] lines above say why. n8n is left off, so hydromart's events wait in the AI web's hd_events (retried, never dropped) until a deploy sets it up; the app and ai_app's password were left as they were"
    fi
    say "n8n: set up from the image's copy of git (credentials stored, workflows published)"
  fi

  # 5. ai_app's password, only now that the release has migrated and n8n is set up.
  $AIWEB_COMPOSE exec -T db psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -f - \
    < infra/aiweb/app-role.sql >/dev/null ||
    fail "infra/aiweb/app-role.sql failed, so ai_app is not as the app needs it; the app was left as it was"
  say "database: ai_app (rows only) carries the password .env gives the app"

  # 6. The app and n8n (or, switched off, n8n's container removed).
  # shellcheck disable=SC2086 # $scale is one flag and its value, or nothing
  if ! $AIWEB_COMPOSE up -d --remove-orphans --wait --wait-timeout 180 $scale; then
    $AIWEB_COMPOSE logs --tail 20 aiweb n8n 2>&1 | sed 's/^/   /' || true
    fail "the app or n8n did not become healthy: /api/health is 503 when the database is unreachable or ai_app gets past row level security"
  fi
  if n8n_off; then say "app: healthy; n8n: off"; else say "app and n8n: healthy"; fi

  # 7. The probe.
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
