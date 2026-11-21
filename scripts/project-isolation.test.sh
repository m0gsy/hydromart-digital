#!/usr/bin/env bash
# HD-1 — the host scripts see, restart and prune THIS compose project only.
#
# The production box is about to run a second compose project (the AI web). Every host
# script here found its target by NAME across the whole host: `docker ps --filter
# name=postgres | head -1`, and `docker ps` lists the newest container first. So the day the
# other project starts a container whose name holds postgres, auth or prometheus, ask-the-box,
# go-live-report and the reset's dry run read ITS database, the drift check names its
# containers (and deploy.sh restarts what the drift check names), and the weekly image prune
# deletes its rollback images.
#
# Proved against a fake `docker` holding two projects, `hydromart` and `hydromart-ai`. Every
# name these scripts look for exists in both, and the other project's containers are listed
# first, so an unscoped lookup picks the wrong one and this file goes red.
#
#   bash scripts/project-isolation.test.sh
#
# `set +e` for the reason its sibling self-checks give: CI runs them as `bash -e <file>`, and
# several commands below exit non-zero on purpose.
set +e
cd "$(dirname "$0")/.."
# The Postgres readers honour an explicit container; this is about the one they find alone.
unset PG_CONTAINER

fails=0
ok() { echo "  ok   $1"; }
bad() {
  echo "  FAIL $1"
  fails=$((fails + 1))
}

echo "project isolation:"

PROJECT="$(sed -n 's/^name: *//p' docker-compose.yml | tr -d "\"' \r")"
[ "$PROJECT" = hydromart ] && ok "docker-compose.yml pins the project name: $PROJECT" ||
  bad "docker-compose.yml must pin \`name: hydromart\` (got '${PROJECT}')"
LABEL="com.docker.compose.project=hydromart"

# ------------------------------------------------------------------------ static checks
for f in scripts/check-config-drift.sh scripts/docker-gc.sh scripts/ask-the-box.sh \
  scripts/go-live-report.sh scripts/reset-test-data.sh; do
  grep -q "com.docker.compose.project=\(\$PROJECT\|hydromart\)" "$f" ||
    bad "$f does not name the project label $LABEL"
done
grep -q "$LABEL" .github/workflows/images.yml &&
  ok "CI labels every published image with $LABEL" ||
  bad "images.yml must label images $LABEL, or docker-gc never prunes a pulled release once a second project is here"

# The caddy service block of the prod overlay, and the file's top-level networks.
CADDY="$(awk '/^  caddy:/{f=1;print;next} f&&/^  [a-z]/{exit} f&&/^[a-z]/{exit} f' docker-compose.prod.yml)"
printf '%s\n' "$CADDY" | grep -qE '^    image: caddy:[^@ ]+@sha256:[0-9a-f]{64}$' &&
  ok "the Caddy image is pinned by digest" || bad "the Caddy image must be pinned by digest"
printf '%s\n' "$CADDY" | grep -qE '^      - default$' && printf '%s\n' "$CADDY" | grep -qE '^      - edge$' &&
  ok "Caddy joins its default network and edge" ||
  bad "Caddy must list both \`default\` (web, gateway) and \`edge\` under networks"
awk '/^networks:/{f=1;next} f&&/^[a-z]/{exit} f' docker-compose.prod.yml | grep -qE '^    name: edge$' &&
  ok "the edge network has the fixed name 'edge'" ||
  bad "networks.edge must carry \`name: edge\` so the other project can declare it external"
grep -qx 'import sites/\*\.caddy' infra/caddy/Caddyfile && [ -d infra/caddy/sites ] &&
  ok "the Caddyfile imports infra/caddy/sites/*.caddy" ||
  bad "the Caddyfile must end with \`import sites/*.caddy\` and infra/caddy/sites/ must exist"
grep -qF 'git diff --quiet "$PREV_SHA" "$NEW_SHA" -- infra/caddy/' scripts/deploy.sh &&
  ok "deploy.sh reloads Caddy when a release changes infra/caddy/" ||
  bad "deploy.sh must reload Caddy when infra/caddy/ changes: a directory mount is visible, not loaded"

# ------------------------------------------------------------------------ the fake box
W="$(mktemp -d)"
trap 'rm -rf "$W"' EXIT
mkdir -p "$W/bin"
printf 'scrape_interval: 15s\n' > "$W/prometheus.yml"
printf 'ai = 1\n' > "$W/ai.conf"

# One row per container, newest first as `docker ps` prints them: name project mount.
cat > "$W/containers" <<EOF
hydromart-ai-postgres-1 hydromart-ai $W/ai.conf|/etc/ai.conf
hydromart-ai-auth-1 hydromart-ai -
hydromart-ai-prometheus-1 hydromart-ai -
hydromart-ai-alertmanager-1 hydromart-ai -
hydromart-ai-scheduler-1 hydromart-ai -
hydromart-auth-1 hydromart -
hydromart-postgres-exporter-1 hydromart -
hydromart-postgres hydromart -
hydromart-prometheus-1 hydromart $W/prometheus.yml|/etc/prometheus/prometheus.yml
hydromart-alertmanager-1 hydromart -
hydromart-scheduler-1 hydromart -
hydromart-caddy-1 hydromart -
EOF
grep -v ' hydromart-ai ' "$W/containers" > "$W/containers.one"

cat > "$W/bin/docker" <<'EOF'
#!/usr/bin/env bash
# Fake docker: answers ps/inspect/exec from $FAKE_TABLE, logs every call to $FAKE_LOG.
printf '%s\n' "$*" >> "$FAKE_LOG"
case "$1" in
  ps)
    shift
    names=() labels=() fmt='{{.Names}}'
    while [ $# -gt 0 ]; do
      case "$1" in
        --filter | -f)
          case "$2" in name=*) names+=("${2#name=}") ;; label=*) labels+=("${2#label=}") ;; esac
          shift 2 ;;
        --format) fmt="$2"; shift 2 ;;
        *) shift ;;
      esac
    done
    while read -r name proj _; do
      for n in "${names[@]}"; do case "$name" in *"$n"*) ;; *) continue 2 ;; esac; done
      for l in "${labels[@]}"; do [ "$l" = "com.docker.compose.project=$proj" ] || continue 2; done
      out="${fmt//'{{.Names}}'/$name}"
      out="${out//'{{.Status}}'/Up 2 hours}"
      out="${out//'{{.Label "com.docker.compose.project"}}'/$proj}"
      printf '%s\n' "$out"
    done < "$FAKE_TABLE"
    ;;
  inspect)
    target="${*: -1}"
    case "$*" in
      *.Mounts*) awk -v c="$target" '$1 == c && $3 != "-" {print $3}' "$FAKE_TABLE" ;;
      *) echo "running, started 2026-11-21T00:00:00Z" ;;
    esac
    ;;
  exec)
    # Every file a container holds is "older" than the copy on disk, so each bind-mounted
    # config drifts: the scoping alone decides which containers get reported.
    case "$*" in *' md5sum '*) echo "00000000000000000000000000000000  ${*: -1}" ;; esac
    ;;
esac
exit 0
EOF
chmod +x "$W/bin/docker"
FAKE="$W/bin/docker"

run() { # table log cmd... — the command with the fake docker first on PATH
  local table="$1" log="$2"
  shift 2
  : > "$log"
  FAKE_TABLE="$table" FAKE_LOG="$log" DOCKER_BIN="$FAKE" PATH="$W/bin:$PATH" "$@" 2>&1
}

# check-config-drift: deploy.sh restarts exactly what --list prints.
LIST="$(run "$W/containers" "$W/drift.log" bash scripts/check-config-drift.sh --list)"
[ "$LIST" = hydromart-prometheus-1 ] &&
  ok "check-config-drift --list names this project's stale container and nothing else" ||
  bad "check-config-drift --list must print only hydromart-prometheus-1, got: $(echo $LIST)"
REPORT="$(run "$W/containers" "$W/drift.log" bash scripts/check-config-drift.sh)"
if printf '%s' "$REPORT" | grep -q hydromart-ai-; then
  bad "the drift report names another project's container"
elif printf '%s' "$REPORT" | grep -q hydromart-prometheus-1; then
  ok "the drift report names this project's container only"
else
  bad "the drift report lost this project's stale container: $REPORT"
fi

# docker-gc: every prune is scoped, and the unlabelled prune runs only on a box this project has alone.
run "$W/containers" "$W/gc.log" bash scripts/docker-gc.sh --old-images >/dev/null
PRUNES="$(grep '^image prune' "$W/gc.log")"
[ "$(printf '%s\n' "$PRUNES" | grep -c "label=$LABEL")" = 2 ] &&
  ok "docker-gc prunes dangling and old images by this project's label" ||
  bad "docker-gc must prune both kinds by $LABEL: $(echo $PRUNES)"
printf '%s\n' "$PRUNES" | grep -q 'label!=' &&
  bad "docker-gc pruned unlabelled images while another project is on the box" ||
  ok "with another project here, unlabelled images are left alone"
run "$W/containers.one" "$W/gc1.log" bash scripts/docker-gc.sh --old-images >/dev/null
[ "$(grep -c '^image prune .*label!=com.docker.compose.project$' "$W/gc1.log")" = 2 ] &&
  ok "alone on the box, docker-gc still reclaims unlabelled images (older CI pulls, third-party)" ||
  bad "alone on the box, docker-gc must prune unlabelled images too: $(grep '^image prune' "$W/gc1.log" | tr '\n' ';')"

# The Postgres readers: they must exec into hydromart-postgres, never the other one.
for s in go-live-report reset-test-data; do
  run "$W/containers" "$W/$s.log" bash "scripts/$s.sh" >/dev/null
  if grep -q '^exec .*hydromart-ai-' "$W/$s.log"; then
    bad "$s.sh ran a command in another project's container: $(grep -m1 '^exec .*hydromart-ai-' "$W/$s.log")"
  elif grep -q '^exec .*hydromart-postgres ' "$W/$s.log"; then
    ok "$s.sh reads this project's Postgres"
  else
    bad "$s.sh never reached hydromart-postgres: $(head -3 "$W/$s.log" | tr '\n' ';')"
  fi
done

# ask-the-box: every container it looks up, execs into or inspects is this project's.
run "$W/containers" "$W/box.log" bash scripts/ask-the-box.sh >/dev/null
UNSCOPED="$(grep '^ps ' "$W/box.log" | grep -v "label=$LABEL")"
[ -z "$UNSCOPED" ] && ok "every docker ps in ask-the-box carries the project label" ||
  bad "ask-the-box looked up containers across projects: $(printf '%s' "$UNSCOPED" | head -2 | tr '\n' ';')"
FOREIGN="$(grep -E '^(exec|inspect|logs|restart) .*hydromart-ai-' "$W/box.log")"
[ -z "$FOREIGN" ] && ok "ask-the-box never touched another project's container" ||
  bad "ask-the-box reached into another project: $(printf '%s' "$FOREIGN" | head -2 | tr '\n' ';')"
grep -q '^exec .*hydromart-postgres ' "$W/box.log" && grep -q '^exec .*hydromart-prometheus-1 ' "$W/box.log" &&
  ok "  ...and still found this project's Postgres and Prometheus" ||
  bad "ask-the-box lost this project's own containers"

if [ "$fails" -gt 0 ]; then
  echo "project isolation: $fails check(s) failed" >&2
  exit 1
fi
echo "project isolation: all checks passed"
