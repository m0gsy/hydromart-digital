#!/usr/bin/env bash
# The AI web's isolation probe, as helpers: what one outcome of scripts/lib/tcp-reach.cjs means,
# who may sit on a network, the plan of addresses a container must NOT be able to reach, and the
# run of that plan from inside a container. Sourced by scripts/aiweb-deploy.sh (the production AI
# web) and scripts/aiweb-staging-deploy.sh (its staging copy); nothing here runs on its own.
#
# The caller defines, before calling: say, note (adds to PROBLEMS), HYDROMART_PROJECT,
# HYDROMART_API_URL, and the globals PLAN and COUNT below. Knobs, all defaulting to what the
# production AI web has always used:
#   PLAN_PROJECTS    compose projects whose containers must be unreachable (default: hydromart)
#   PLAN_FRONT_NETS  networks where Caddy is MEANT to be reachable on 80/443 (default: edge)
#   PLAN_GW_NET      the network whose gateway is the host's route to hydromart's published
#                    ports (default: edge)
#   PLAN_NAMES       service names that must not answer (default: hydromart's own)
#   PLAN_HOST_PORTS_ALL_GW  set: hydromart's published ports are tried at every gateway given,
#                    not only PLAN_GW_NET's (default: unset, as production has always been)
# PURE: what one outcome of scripts/lib/tcp-reach.cjs means for one kind of target.
#   control    db:5432, the container's own database: must open, or no answer below proves anything
#   container  an address a hydromart container holds on a network other than edge: isolated
#              only if nothing comes back (timeout) or there is no route (unreachable); an
#              answer of any kind, a connection or an RST, means the packets get there
#   name       one of hydromart's service names: not resolving is said, never counted as a pass
#   front      Caddy's address on edge, where the AI web is MEANT to reach it: 80 and 443 may
#              open; any other port of it (the admin API on 2019) must not
#   host       the host, through the edge gateway, on a port hydromart publishes, and its ssh (22) at
#              the gateway of every AI web network and at the public address: must not open
#   info       printed, never judged (the cloud metadata address)
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
# rather than listed here, so a container added tomorrow is tried tomorrow, and the host's ssh
# through each network given (the AI web's). Sets PLAN, one line per target,
# `<kind> <host:port> <label>`, and COUNT, the hydromart containers found.
PLAN=''
COUNT=0
build_plan() { # <network>...
  local t id line name pairs ports tcp p pair net ip kind edge_gw host_ports gw api_host
  PLAN="control db:5432 own-database"$'\n'
  for t in ${PLAN_NAMES-postgres:5432 hydromart-postgres:5432 gateway:8080 auth:3001 web:3000}; do
    PLAN+="name $t service-name"$'\n'
  done
  COUNT=0
  for id in $(for p in ${PLAN_PROJECTS:-$HYDROMART_PROJECT}; do docker ps -q --filter "label=com.docker.compose.project=$p"; done); do
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
      case " ${PLAN_FRONT_NETS:-edge} " in *" $net "*) kind=front ;; esac
      for p in $tcp; do PLAN+="$kind $ip:$p $name@$net"$'\n'; done
    done
  done
  [ "$COUNT" -gt 0 ] || note "probe: no running container of project $HYDROMART_PROJECT was found, so not one hydromart address was tried"
  # The host through the edge gateway, on every port hydromart publishes but Caddy's 80 and 443:
  # loopback-bound today, and anything published wider (PUBLIC_BIND=0.0.0.0) is what this catches.
  edge_gw="$(docker network inspect "${PLAN_GW_NET:-edge}" --format '{{range .IPAM.Config}}{{.Gateway}} {{end}}' 2>/dev/null | awk '{print $1}' || true)"
  host_ports="$(docker ps --filter "label=com.docker.compose.project=$HYDROMART_PROJECT" --format '{{.Ports}}' |
    grep -oE ':[0-9]+->' | sed 's/[^0-9]//g' | sort -un | grep -vxE '80|443' || true)"
  if [ -z "$edge_gw" ]; then
    note "probe: the edge network has no gateway address, so the host's ports were not tried"
  else
    for p in $host_ports; do PLAN+="host $edge_gw:$p host"$'\n'; done
  fi
  # The host's ssh, closed to the AI web by scripts/aiweb-firewall.sh (the owner's decision of
  # 24 November 2026): at the gateway of every network an AI web container is on (an internal
  # network's too: its gateway is the host), and at the public address the AI web reaches
  # hydromart by, the API's name resolved inside the container, as its own requests resolve it.
  # A gateway it cannot read is a way to the host it did not try: counted, like edge's above.
  for net in "$@"; do
    gw="$(docker network inspect "$net" --format '{{range .IPAM.Config}}{{.Gateway}} {{end}}' 2>/dev/null | awk '{print $1}' || true)"
    if [ -n "$gw" ]; then
      PLAN+="host $gw:22 host-ssh"$'\n'
      # PLAN_HOST_PORTS_ALL_GW (the staging script sets it): hydromart's published ports at EVERY
      # gateway too, not only PLAN_GW_NET's: a container on a network with its own gateway (n8n's
      # tunnel) reaches the host there, and a service bound to the bridge address would answer.
      if [ -n "${PLAN_HOST_PORTS_ALL_GW:-}" ] && [ "$gw" != "$edge_gw" ]; then
        for p in $host_ports; do PLAN+="host $gw:$p host"$'\n'; done
      fi
    else
      note "probe: could not read the gateway of the $net network, so the host's ssh was not tried through it"
    fi
  done
  api_host="${HYDROMART_API_URL#*://}"
  PLAN+="host ${api_host%%[:/]*}:22 host-ssh"$'\n'
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

