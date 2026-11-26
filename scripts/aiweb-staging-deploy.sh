#!/usr/bin/env bash
# D3 staging: deploy the AI web's STAGING copy (infra/aiweb-staging/), the third compose project on
# this box, behind a login at https://staging-ai.hydromart-digital.com, and prove it is isolated
# from hydromart, from the production AI web, from the internet and from the host's ssh.
#
#   bash scripts/aiweb-staging-deploy.sh           # scripts/deploy.sh runs this after the AI web
#   bash scripts/aiweb-staging-deploy.sh --probe   # the probe alone, against what is running now
#   RESET_CONFIRM=staging bash scripts/aiweb-staging-deploy.sh --reset
#                                                  # `staging-reset`: drop its data, deploy again
#
# The release is what infra/aiweb-staging/docker-compose.yml pins, which may be newer than
# production's. Steps, as scripts/aiweb-deploy.sh's, without n8n's kill switch and key rotation:
#   0. STAGING_AI_PASSWORD (a repo secret, handed in by deploy.yml and deploy.sh) unset: staging is
#      OFF: its containers are removed (volumes kept), its Caddy login is removed, and the site is
#      401 for everyone. Set: it must be 16+ characters of A-Z a-z 0-9 . _ ~ -.
#   1. Its keys present in .env (scripts/aiweb-staging-secrets.sh makes them), its images present
#      (a missing one is pulled by digest with the deploy job's own token, in a throwaway docker
#      config), its networks made with nothing started, the host's ssh closed to them.
#   2. Its database up, infra/aiweb/roles.sql (shared with production), the migration job, n8n set up
#      from a copy of the image's workflows pointed at the fake hydromart (n8n-rewrite.mjs),
#      infra/aiweb/app-role.sql, then the app, the fake hydromart and n8n up and healthy.
#   3. The login: the password is hashed with Caddy's own `hash-password` (bcrypt, cost 10) over
#      stdin and ONLY the hash is kept: in .env (STAGING_AI_BASIC_AUTH_HASH) and in
#      infra/caddy/staging-auth/10-staging.caddy, which Caddy is reloaded for when it changed (the
#      deploy's own Caddy reload never sees that gitignored file). The plaintext lives in this
#      process's memory and the stdin of two commands: never a file, an argument or a log line.
#   4. The probe (what the containers are attached to and publish; what they can open from inside:
#      no hydromart or production AI web address, no internet for the app and the mock, no host
#      ssh; Caddy's way in; the app's sign-in keys are the fake hydromart's and nobody's else; the
#      login wall from outside).
#
# Every failure ends with exit 1, a `!!` line, and one alert (alert_once aiweb-staging). deploy.sh
# logs it and goes on: staging can never fail hydromart's deploy; it stops this script after 30 min.
#
# Env: GHCR_TOKEN, GHCR_USER, STAGING_AI_PASSWORD from deploy.yml; STAGING_COMPOSE, STAGING_PROJECT,
#      AI_PROJECT, HYDROMART_PROJECT, STAGING_URL_CHECK=0, STAGING_MIGRATE_TIMEOUT,
#      STAGING_N8N_SETUP_TIMEOUT overrides for the self-test.
#
# Exit: 0 deployed (or probed, or switched off) · 1 not deployed, or the probe found a problem.

# The secrets, FIRST: into shell variables, out of the environment, not exported, before any other
# command runs. No child of this script (compose, curl, docker exec, the alert) ever inherits them.
ghcr_token="${GHCR_TOKEN:-}"
ghcr_user="${GHCR_USER:-}"
staging_pw="${STAGING_AI_PASSWORD:-}"
unset GHCR_TOKEN GHCR_USER STAGING_AI_PASSWORD
export -n ghcr_token ghcr_user staging_pw

set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib/deploy-common.sh
. scripts/lib/deploy-common.sh

FILE=infra/aiweb-staging/docker-compose.yml
COMPOSE="${STAGING_COMPOSE:-docker compose -f $FILE --env-file .env}"
HYDROMART_PROJECT="${HYDROMART_PROJECT:-hydromart}"
AI_PROJECT="${AI_PROJECT:-$(sed -n 's/^name: *//p' infra/aiweb/docker-compose.yml | tr -d "\"' \r")}"
STAGING_PROJECT="${STAGING_PROJECT:-$(sed -n 's/^name: *//p' "$FILE" | tr -d "\"' \r")}"
MIGRATE_TIMEOUT="${STAGING_MIGRATE_TIMEOUT:-900}"
SETUP_TIMEOUT="${STAGING_N8N_SETUP_TIMEOUT:-900}"
AUTH_FILE=infra/caddy/staging-auth/10-staging.caddy
setting() { sed -n "s/^ *$1: *//p" "$FILE" | head -1 | tr -d "\"' \r"; }
AI_WEB_URL="$(setting AI_WEB_URL)"
APP_IMAGE="$(sed -n '/^  staging-aiweb:/,/^  [a-z]/s/^ *image: *//p' "$FILE" | head -1)"
RELEASE="${APP_IMAGE##*@sha256:}"
RELEASE="${RELEASE:0:12}"
# What the shared probe helpers read as the hydromart API: the staging site, which Caddy answers
# with the fake hydromart (and the host-ssh line of the plan then tries Caddy's port 22).
HYDROMART_API_URL="$AI_WEB_URL"

say() { echo "[staging] $*"; }
fail() {
  say "!! $1"
  say "   hydromart and the production AI web are unaffected: nothing here touches their projects."
  alert_once aiweb-staging "staging AI web $RELEASE NOT deployed or not isolated: $(printf '%s' "$1" | tr -d '"\\' | tr '\n' ' ' | cut -c1-400)"
  exit 1
}

CFG=''
logout() {
  [ -n "$CFG" ] || return 0
  DOCKER_CONFIG="$CFG" docker logout ghcr.io >/dev/null 2>&1 || true
  rm -rf "$CFG"
  CFG=''
}
SCREEN_TMP=''
trap 'logout; [ -z "$SCREEN_TMP" ] || rm -rf "$SCREEN_TMP"' EXIT
trap 'remove_leftovers migrate; remove_leftovers n8n-setup; fail "stopped by a signal before it finished (deploy.sh allows it 30 minutes); the last [staging] line above is where it stopped"' TERM INT

has_value() {
  local v
  v="$(tr -d '\r' < .env 2>/dev/null | sed -n "s/^$1=//p" | tail -1)"
  case "$v" in
    \"*\") v="${v#\"}" && v="${v%\"}" ;;
    \'*\') v="${v#\'}" && v="${v%\'}" ;;
  esac
  [ -n "${v//[[:space:]]/}" ]
}
env_value() {
  local v
  v="$(tr -d '\r' < .env 2>/dev/null | sed -n "s/^$1=//p" | tail -1)"
  case "$v" in
    \'*\') v="${v#\'}" && v="${v%\'}" ;;
    \"*\") v="${v#\"}" && v="${v%\"}" ;;
  esac
  printf '%s' "$v"
}

pull() {
  local ref
  if [ -z "$ghcr_token" ]; then
    fail "the release's images are not on this box and there is no registry token to pull them: deploy through the Deploy workflow, which hands the box its own short-lived token"
  fi
  CFG="$(mktemp -d)"
  if ! printf '%s' "$ghcr_token" |
    DOCKER_CONFIG="$CFG" docker login ghcr.io -u "${ghcr_user:-github-actions}" --password-stdin >/dev/null 2>&1; then
    fail "ghcr.io refused the deploy job's token (has the hydromart-ai package given this repository's Actions read access?)"
  fi
  for ref in "$@"; do
    say "pulling $ref"
    if ! DOCKER_CONFIG="$CFG" timeout --foreground 600 docker pull --quiet "$ref" >/dev/null; then
      fail "could not pull $ref (denied, no longer in the registry, or no answer in 10 minutes)"
    fi
  done
  logout
}

remove_leftovers() {
  local ids
  ids="$(docker ps -aq --filter "label=com.docker.compose.project=$STAGING_PROJECT" \
    --filter "label=com.docker.compose.service=$1" 2>/dev/null || true)"
  [ -n "$ids" ] || return 0
  # shellcheck disable=SC2086 # one argument per container
  docker rm -f $ids >/dev/null 2>&1 || say "!! could not remove the stopped $1 job's container(s): $ids"
}

hydromart_container() {
  docker ps -q --filter "label=com.docker.compose.project=$HYDROMART_PROJECT" \
    --filter "label=com.docker.compose.service=$1" | head -1
}

# The probe helpers (judge, only_members, build_plan, reach_from, jwks_from), shared with the
# production AI web's script; PLAN and COUNT are what build_plan fills.
# shellcheck source=scripts/lib/aiweb-probe.sh
. scripts/lib/aiweb-probe.sh

# ----------------------------------------------------------------------------------- the login
# Caddy reloads its config (no connection dropped), three tries 5 seconds apart: it may have been
# recreated seconds ago and not answer yet.
caddy_reload() { # <caddy container>
  local _
  for _ in 1 2 3; do
    if docker exec "$1" caddy reload --config /etc/caddy/Caddyfile --force >/dev/null 2>&1; then return 0; fi
    sleep "${STAGING_RELOAD_PAUSE:-5}"
  done
  return 1
}

# The login file holds `staging <hash>` when there is a password and does not exist when there is
# none. Written (and Caddy reloaded) only when the content changes.
set_login_file() { # <content, or empty to remove> <caddy container>
  local current='' had=''
  [ ! -f "$AUTH_FILE" ] || { current="$(cat "$AUTH_FILE")"; had=1; }
  if [ -z "$1" ]; then
    [ -f "$AUTH_FILE" ] || return 0
    rm -f "$AUTH_FILE"
  else
    [ "$current" != "$1" ] || return 0
    printf '%s\n' "$1" >"$AUTH_FILE.new" && mv "$AUTH_FILE.new" "$AUTH_FILE"
  fi
  # A change Caddy did not take is put back, so the file on disk is what Caddy serves: a later
  # reload (any deploy's) must not suddenly load a login nobody checked.
  restore() {
    if [ -n "$had" ]; then printf '%s\n' "$current" >"$AUTH_FILE.new" && mv "$AUTH_FILE.new" "$AUTH_FILE"; else rm -f "$AUTH_FILE"; fi
  }
  if [ -z "$2" ]; then
    restore
    fail "the staging login changed but Caddy is not running, so it was not reloaded (the previous login file is back)"
  fi
  if ! caddy_reload "$2"; then
    restore
    fail "Caddy would not reload ($AUTH_FILE changed): the file did not validate; the previous login file is back and Caddy keeps serving it. Check: docker exec <caddy> caddy validate --config /etc/caddy/Caddyfile"
  fi
  say "login: Caddy reloaded for the changed staging login"
}

# What the public site answers a request with this password (or none): the HTTP code only. The
# password goes to curl on its stdin as a config line, never as an argument.
site_code() { # <path> [password]
  if [ -n "${2:-}" ]; then
    printf 'user = "staging:%s"\n' "$2" | curl -s -o /dev/null -m 15 -w '%{http_code}' -K - "$AI_WEB_URL$1" || true
  else
    curl -s -o /dev/null -m 15 -w '%{http_code}' "$AI_WEB_URL$1" || true
  fi
}

# One request of the screen walk: the password on curl's stdin as a config line (never an argument),
# the cookie jar kept, headers and body in files of SCREEN_TMP (never printed). Prints the HTTP code.
screen_req() { # <password> <jar> <url> [form data]
  local pw="$1" jar="$2" url="$3" data="${4:-}"
  # url and data hold the one-time code and the state: they travel on the config stdin with the
  # password, never in argv. A value that curl's config syntax would read differently is refused.
  case "$url$data" in *'"'* | *'\'* | *$'\n'*) return 0 ;; esac
  {
    printf 'user = "staging:%s"\nurl = "%s"\n' "$pw" "$url"
    [ -z "$data" ] || printf 'data = "%s"\n' "$data"
  } | curl -s -m 30 -K - -b "$jar" -c "$jar" -D "$SCREEN_TMP/h" -o "$SCREEN_TMP/b" -w '%{http_code}' || true
}
screen_header() { sed -n 's/^[Ll]ocation: *//p' "$SCREEN_TMP/h" | tr -d '\r' | head -1; }

# The real sign-in through Caddy, then the screens: the AI web's /masuk starts PKCE and sends the
# browser to the fake hydromart's hand-over page; the pick (a person with no authenticator step:
# that step is a Next server action, not something curl can drive) comes back to the AI web's
# callback; then each screen must answer 200 with its fixed heading. A failure is a note (it names
# the step and the HTTP code only: never a cookie, a code or the password).
SCREEN_USER=00000000-0000-4000-8000-000000000010 # fixtures.json: "Staging HR", HQ, sees every fake depot
SCREEN_DEPOT=00000000-0000-4000-9000-000000000001 # fixtures.json: the first fake depot
screens_probe() { # <password>
  local pw="$1" jar code loc entry path want data
  SCREEN_TMP="$(mktemp -d)"
  jar="$SCREEN_TMP/jar"
  code="$(screen_req "$pw" "$jar" "$AI_WEB_URL/masuk")"
  loc="$(screen_header)"
  case "$loc" in
    "$AI_WEB_URL"/ai/masuk\?*) ;;
    *) note "screens: /masuk answered ${code:-000} and did not send the browser to the fake hydromart's /ai/masuk"; return 0 ;;
  esac
  code="$(screen_req "$pw" "$jar" "$AI_WEB_URL/ai/masuk" "user=$SCREEN_USER&${loc#*\?}")"
  loc="$(screen_header)"
  case "$loc" in
    "$AI_WEB_URL"/masuk/callback\?*) ;;
    *) note "screens: the pick on /ai/masuk answered ${code:-000} and did not return to the AI web's callback"; return 0 ;;
  esac
  code="$(screen_req "$pw" "$jar" "$loc")"
  loc="$(screen_header)"
  case "$loc" in
    / | "$AI_WEB_URL"/) ;;
    *) note "screens: the sign-in callback answered ${code:-000} and did not finish at the Ringkasan"; return 0 ;;
  esac
  # path|heading|a string that exists only when the reads parsed (the first fake depot's label; the
  # headings alone are static and print even when every read failed). No page may carry the AI web's
  # failure markers (status.ts, screens.tsx): outage banner, "Gagal dimuat", denied, stale.
  for entry in '/|Apa yang perlu Anda putuskan hari ini?|Depot Contoh Satu' '/liga|Liga depot kemarin|Depot Contoh Satu' \
    "/depot/$SCREEN_DEPOT|Bagaimana depot ini kemarin|" '/minta-akses?untuk=money|Minta akses ke|'; do
    path="${entry%%|*}"
    want="${entry#*|}"
    data="${want#*|}"
    want="${want%%|*}"
    code="$(screen_req "$pw" "$jar" "$AI_WEB_URL$path")"
    if [ "$code" != 200 ]; then
      note "screens: GET $path answered ${code:-000} (must be 200)"
    elif ! grep -qF -- "$want" "$SCREEN_TMP/b"; then
      note "screens: GET $path answered 200 without its heading ('$want')"
    elif [ -n "$data" ] && ! grep -qF -- "$data" "$SCREEN_TMP/b"; then
      note "screens: GET $path answered 200 with its heading but without its data ('$data'): the reads did not parse"
    elif grep -qF -e 'Mode gangguan' -e 'Gagal dimuat' -e 'tidak boleh membaca' -e 'Basi:' "$SCREEN_TMP/b"; then
      note "screens: GET $path answered 200 but shows a failure state (outage banner, not loaded, denied or stale)"
    else
      say "screens: $path answers 200 with its heading"
    fi
  done
  rm -rf "$SCREEN_TMP"
  SCREEN_TMP=''
}

ensure_login() {
  local caddy code hash
  caddy="$(hydromart_container caddy)"
  [ -n "$caddy" ] || fail "hydromart's caddy is not running, so the staging login cannot be set"
  code=''
  if [ "${STAGING_URL_CHECK:-1}" = 1 ] && has_value STAGING_AI_BASIC_AUTH_HASH; then
    code="$(site_code /api/health "$staging_pw")"
  fi
  if [ "$code" = 200 ]; then
    hash="$(env_value STAGING_AI_BASIC_AUTH_HASH)"
    say "login: the password still matches the hash in .env"
  else
    # Caddy's own hasher, the password on stdin. Cost 10: anyone can send credentials to the site and
    # every guess costs this box one hash (Caddy's default, 14, is about a second).
    hash="$(printf '%s\n' "$staging_pw" | docker exec -i "$caddy" caddy hash-password --algorithm bcrypt --bcrypt-cost 10 2>/dev/null)" ||
      fail "caddy hash-password failed"
    case "$hash" in
      '$2a$10$'* | '$2b$10$'*) ;;
      *) fail "caddy hash-password did not print a bcrypt cost 10 hash" ;;
    esac
    # Single quotes: the hash holds `$`, which compose and the shell would otherwise expand.
    ENV_SET_BLOCK="STAGING_AI_BASIC_AUTH_HASH='$hash'" bash scripts/env-set.sh >/dev/null ||
      fail "could not write STAGING_AI_BASIC_AUTH_HASH to .env"
    say "login: a new password hash made (cost 10) and kept in .env"
  fi
  set_login_file "staging $hash" "$caddy"
}

# ------------------------------------------------------------------------------------- probe
PROBLEMS=''
note() {
  say "!! $1"
  PROBLEMS+="$1; "
}

prod_jwks_kids() { # the production API's key ids, from the host: staging's must never be among them
  local url
  url="$(sed -n 's/^ *HYDROMART_API_URL: *//p' infra/aiweb/docker-compose.yml | head -1 | tr -d "\"' \r")"
  [ -n "$url" ] || return 0
  curl -s -m 15 "$url/auth/api/v1/auth/jwks" 2>/dev/null | grep -oE '"kid" *: *"[^"]+"' | sed 's/.*: *//; s/"//g' || true
}

probe() {
  local app mock n8n id line who nets binds n allowed caddy ai_nets='' code out rc base kids mock_kids bad_env
  PROBLEMS=''
  app="$($COMPOSE ps -q staging-aiweb 2>/dev/null | head -1 || true)"
  mock="$($COMPOSE ps -q hydromart-mock 2>/dev/null | head -1 || true)"
  n8n="$($COMPOSE ps -q n8n 2>/dev/null | head -1 || true)"
  for who in app mock n8n; do
    [ -n "${!who}" ] || note "probe: no $who container is running"
  done
  [ -n "$app" ] && [ -n "$mock" ] && [ -n "$n8n" ] || return 1

  # 1. What each container is attached to and publishes: the app and the mock on edge-staging and
  # private, n8n on private and tunnel, the rest on private only; nothing publishes but n8n's editor.
  for id in $(docker ps -aq --filter "label=com.docker.compose.project=$STAGING_PROJECT"); do
    line="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}|{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}|{{range $k, $v := .HostConfig.PortBindings}}{{$k}}->{{range $v}}{{.HostIp}}:{{.HostPort}} {{end}}{{end}}' "$id")"
    IFS='|' read -r who nets binds <<<"$line"
    ai_nets+=" $nets"
    case "$who" in
      staging-aiweb | hydromart-mock) allowed=" edge-staging ${STAGING_PROJECT}_private " ;;
      n8n) allowed=" ${STAGING_PROJECT}_private ${STAGING_PROJECT}_tunnel " ;;
      *) allowed=" ${STAGING_PROJECT}_private " ;;
    esac
    for n in $nets; do
      case "$allowed" in *" $n "*) ;; *) note "isolation: $who is attached to network $n" ;; esac
    done
    # shellcheck disable=SC2086 # split and joined again: trims the spaces the template leaves
    binds="$(echo $binds)"
    if [ -n "$binds" ] && ! { [ "$who" = n8n ] && [ "$binds" = "5678/tcp->127.0.0.1:5679" ]; }; then
      note "isolation: $who publishes a host port ($binds)"
    fi
  done

  # 2. Who else is on the networks that touch Caddy or leave the box: whoever is there, staging can
  # reach (or be reached by). `edge` must hold no staging container at all.
  only_members edge-staging staging "$HYDROMART_PROJECT/caddy" "$STAGING_PROJECT/staging-aiweb" "$STAGING_PROJECT/hydromart-mock"
  only_members edge staging "$HYDROMART_PROJECT/caddy" "$AI_PROJECT/aiweb"
  only_members "${STAGING_PROJECT}_tunnel" n8n "$STAGING_PROJECT/n8n"

  # 3. From INSIDE each container: no hydromart or production AI web address answers (Caddy's
  # address on edge-staging is the front door: its 80 and 443 only), no host ssh through any
  # network of ours, no internet for the app and the mock (internal networks only).
  PLAN_PROJECTS="$HYDROMART_PROJECT $AI_PROJECT" PLAN_FRONT_NETS=edge-staging PLAN_GW_NET=edge-staging PLAN_HOST_PORTS_ALL_GW=1
  # shellcheck disable=SC2046,SC2086 # one argument per network
  build_plan $(printf '%s\n' $ai_nets | sort -u)
  base="$PLAN"
  PLAN="$base"$'container 1.1.1.1:443 internet\n'
  reach_from "$app" "the staging app" probe
  reach_from "$mock" "the fake hydromart" "probe(mock)"
  PLAN="$base"
  reach_from "$n8n" "staging's n8n" "probe(n8n)"

  # 4. The one way in: Caddy, over edge-staging.
  caddy="$(hydromart_container caddy)"
  if [ -z "$caddy" ]; then
    note "front: hydromart's caddy is not running"
  else
    docker exec "$caddy" wget -q -O /dev/null http://staging-aiweb:3000/api/health >/dev/null 2>&1 &&
      docker exec "$caddy" wget -q -O /dev/null http://hydromart-mock:9911/health >/dev/null 2>&1 &&
      say "front: Caddy reaches staging-aiweb:3000 and hydromart-mock:9911 over edge-staging" ||
      note "front: Caddy cannot reach the staging app or the fake hydromart over edge-staging"
  fi

  # 5. The sign-in keys the app reads are the fake hydromart's and nobody else's: the staging API
  # name is Caddy's alias (so the app asks Caddy, which asks the mock); what comes back has the mock's
  # key ids, none of production's; and no production host name is in the app's environment.
  if kids="$(jwks_from "$app")"; then
    kids="$(grep -oE '"kid" *: *"[^"]+"' <<<"$kids" | sed 's/.*: *//; s/"//g' | sort -u || true)"
    mock_kids="$(docker exec "$mock" node -e 'fetch("http://127.0.0.1:9911/auth/api/v1/auth/jwks").then((r) => r.text()).then((t) => process.stdout.write(t))' 2>/dev/null |
      grep -oE '"kid" *: *"[^"]+"' | sed 's/.*: *//; s/"//g' | sort -u || true)"
    if [ -n "$kids" ] && [ "$kids" = "$mock_kids" ]; then
      say "sign-in: the app reads $AI_WEB_URL's signing keys and they are the fake hydromart's"
    else
      note "sign-in: the keys the staging app reads ('$(tr '\n' ' ' <<<"$kids")') are not the fake hydromart's ('$(tr '\n' ' ' <<<"$mock_kids")')"
    fi
    for id in $(prod_jwks_kids); do
      if grep -qxF "$id" <<<"$kids"; then note "sign-in: staging's key id $id is also in production's key set"; fi
    done
  else
    note "sign-in: the staging app cannot fetch $AI_WEB_URL/auth/api/v1/auth/jwks (Caddy's alias on edge-staging, the mock)"
  fi
  bad_env="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$app" "$mock" "$n8n" 2>/dev/null |
    grep 'hydromart-digital\.com' | grep -vc 'staging-ai\.hydromart-digital\.com' || true)"
  if [ "${bad_env:-0}" != 0 ]; then
    note "isolation: $bad_env environment value(s) of staging's containers name a hydromart-digital.com host other than the staging site"
  fi

  # 6. n8n: reaches the app and the fake hydromart over private, holds exactly what git holds (the
  # image's copy, rewritten to the mock: the rewrite stops on any production host left in it).
  docker exec "$n8n" wget -q -O /dev/null http://aiweb:3000/api/health >/dev/null 2>&1 &&
    docker exec "$mock" node -e 'fetch("http://n8n:5678/healthz").then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))' >/dev/null 2>&1 &&
    say "n8n: reaches the staging app and is reached from the fake hydromart's network" ||
    note "n8n: it cannot reach the staging app, or the fake hydromart cannot reach it"
  if out="$(timeout "${STAGING_DRIFT_TIMEOUT:-300}" docker exec "$n8n" node /staging/n8n-rewrite.mjs node /opt/hydromart/bin/drift.mjs 2>&1)"; then
    say "n8n: $(tail -1 <<<"$out")"
  else
    rc=$?
    note "n8n: drift check exit $rc (1 drift or a production host left in the workflows, 2 could not check): $(tr '\n' ' ' <<<"$out" | cut -c1-300)"
  fi

  # 7. As a browser sees it: the login wall holds, the internal routes are hidden.
  if [ "${STAGING_URL_CHECK:-1}" = 1 ]; then
    code="$(site_code /api/health)"
    [ "$code" = 401 ] && say "public: $AI_WEB_URL answers 401 without the password" ||
      note "public: $AI_WEB_URL/api/health answered ${code:-000} without a password (must be 401)"
    code="$(site_code /api/health "wrong-password-$$-$RANDOM")"
    [ "$code" = 401 ] || note "public: a wrong password was answered ${code:-000} (must be 401)"
    if [ -n "$staging_pw" ]; then
      code="$(site_code /api/health "$staging_pw")"
      [ "$code" = 200 ] && say "public: the password opens /api/health (200)" ||
        note "public: the password was answered ${code:-000} on /api/health (must be 200: DNS, certificate, login or app)"
      # The sign-in and the new screens, only when the password opens the site at all.
      [ "$code" != 200 ] || screens_probe "$staging_pw"
    fi
    code="$(site_code /api/internal/n8n/failure)"
    [ "$code" = 404 ] || note "public: /api/internal/n8n/failure answered ${code:-000} without credentials (must be 404)"
  fi
  [ -z "$PROBLEMS" ]
}

# ------------------------------------------------------------------------------------ deploy
off() {
  local caddy ids
  say "STAGING_AI_PASSWORD is not set: staging is OFF (its containers are removed, its data kept; the site is 401 for everyone)"
  caddy="$(hydromart_container caddy)"
  set_login_file '' "$caddy"
  ids="$(docker ps -aq --filter "label=com.docker.compose.project=$STAGING_PROJECT" 2>/dev/null || true)"
  if [ -n "$ids" ]; then
    $COMPOSE --profile migrate --profile n8n-setup down --remove-orphans || fail "could not take the staging stack down"
  fi
  alert_clear aiweb-staging
  exit 0
}

deploy() {
  local key missing='' ref images=() absent=() rc scale='' ids hold=''
  [[ "$STAGING_PROJECT" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || fail "'$STAGING_PROJECT' (the name: line of $FILE) is not a compose project name"
  [ -n "$staging_pw" ] || off
  [[ "$staging_pw" =~ ^[A-Za-z0-9._~-]{16,}$ ]] ||
    fail "STAGING_AI_PASSWORD must be at least 16 characters of A-Z a-z 0-9 . _ ~ - (it is handed to curl as a config line)"
  # The key maker again (idempotent, writes only absent keys): its refusal of a staging key equal to a
  # production one stops staging here, whatever the caller did with its exit code. Never production.
  env -u STAGING_AI_PASSWORD bash scripts/aiweb-staging-secrets.sh >/dev/null ||
    fail "scripts/aiweb-staging-secrets.sh refused or could not run: a staging key equals a production key, or one is malformed (run it by hand to read which; it prints key names only). Staging is not started"
  for key in STAGING_POSTGRES_PASSWORD STAGING_DB_OWNER_PASSWORD STAGING_DB_APP_PASSWORD STAGING_N8N_DB_PASSWORD \
    STAGING_N8N_ENCRYPTION_KEY STAGING_N8N_TOKEN STAGING_HD_EVENT_SECRET STAGING_N8N_MACHINE_ID \
    STAGING_N8N_MACHINE_SECRET STAGING_MOCK_SIGNING_KEY; do
    has_value "$key" || missing+=" $key"
  done
  [ -z "$missing" ] ||
    fail "no value in .env for:$missing (scripts/aiweb-staging-secrets.sh makes one when the line is absent)"

  # 1. Images, the one-shot jobs' included.
  mapfile -t images < <($COMPOSE --profile migrate --profile n8n-setup config --images 2>/dev/null | sort -u || true)
  [ "${#images[@]}" -gt 0 ] || fail "could not read the images $FILE names"
  for ref in "${images[@]}"; do
    case "$ref" in *@sha256:*) ;; *) fail "$ref is not pinned by digest" ;; esac
    docker image inspect "$ref" >/dev/null 2>&1 || absent+=("$ref")
  done
  if [ "${#absent[@]}" -gt 0 ]; then pull "${absent[@]}"; fi
  say "images: release $RELEASE, all ${#images[@]} present"

  # 2. The networks, before any container starts on one, so the firewall can close them first. The
  # running containers are held as they are (none made, none recreated: a container made and never
  # started is one nothing starts).
  for key in staging-aiweb hydromart-mock n8n; do
    ids="$(docker ps -aq --filter "label=com.docker.compose.project=$STAGING_PROJECT" --filter "label=com.docker.compose.service=$key")" ||
      fail "could not count $key's containers, so nothing was made or started"
    hold+=" --scale $key=$(wc -w <<<"$ids")"
  done
  # shellcheck disable=SC2086 # $hold is flags and their values
  $COMPOSE up --no-start --no-recreate $hold ||
    fail "could not make the release's networks (up --no-start), so nothing was started"
  if bash scripts/aiweb-firewall.sh; then
    say "host ssh: TCP 22 is closed to the staging networks (scripts/aiweb-firewall.sh)"
  else
    say "!! scripts/aiweb-firewall.sh could not close the host's ssh to staging; the probe says whether it is closed"
  fi

  # 3. Database and roles (infra/aiweb/roles.sql and app-role.sql are production's, run here
  # against staging's own database with staging's passwords).
  $COMPOSE up -d --wait --wait-timeout 180 db || fail "its database did not come up healthy"
  $COMPOSE exec -T db psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -f - < infra/aiweb/roles.sql >/dev/null ||
    fail "infra/aiweb/roles.sql failed, so the roles and databases are not as the migration and n8n need them"
  say "database: up; roles and databases in place"

  # 4. Migrations, bounded.
  rc=0
  timeout --foreground --kill-after=30 "$MIGRATE_TIMEOUT" \
    $COMPOSE --profile migrate run --rm --no-deps -T migrate </dev/null || rc=$?
  if [ "$rc" != 0 ]; then
    remove_leftovers migrate
    fail "the migration job failed as ai_owner (exit $rc; 124 or 137 = stopped after ${MIGRATE_TIMEOUT}s); the app and ai_app's password were left as they were"
  fi

  # 5. n8n: removed (not merely stopped), set up from the rewritten copy, bounded.
  $COMPOSE rm --stop --force n8n || fail "could not stop and remove n8n before its setup"
  rc=0
  timeout --foreground --kill-after=30 "$SETUP_TIMEOUT" \
    $COMPOSE --profile n8n-setup run --rm --no-deps -T n8n-setup </dev/null || rc=$?
  if [ "$rc" != 0 ]; then
    remove_leftovers n8n-setup
    fail "n8n's setup failed (exit $rc; 124 or 137 = stopped after ${SETUP_TIMEOUT}s), its lines above say why. n8n is left off"
  fi
  say "n8n: set up from the image's copy of git, pointed at the fake hydromart"

  # 6. ai_app's password, only now.
  $COMPOSE exec -T db psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -f - < infra/aiweb/app-role.sql >/dev/null ||
    fail "infra/aiweb/app-role.sql failed, so ai_app is not as the app needs it; the app was left as it was"

  # 7. The services.
  # shellcheck disable=SC2086 # $scale is empty
  if ! $COMPOSE up -d --remove-orphans --wait --wait-timeout 180 $scale; then
    $COMPOSE logs --tail 20 staging-aiweb hydromart-mock n8n 2>&1 | sed 's/^/   /' || true
    fail "the staging app, the fake hydromart or n8n did not become healthy"
  fi
  say "app, fake hydromart and n8n: healthy"

  # 8. The login (the site answers through Caddy only now), then the probe.
  ensure_login
  probe || fail "probe: ${PROBLEMS%; }"
  alert_clear aiweb-staging
  say "staging OK: release $RELEASE serves $AI_WEB_URL behind its login, and cannot reach hydromart, production's AI web, the internet or the host's ssh"
}

case "${1:-}" in
  '') deploy ;;
  --probe)
    probe || fail "probe: ${PROBLEMS%; }"
    say "probe OK: the running staging AI web is isolated"
    ;;
  --reset)
    [ "${RESET_CONFIRM:-}" = staging ] || fail "staging-reset needs the Deploy workflow's confirm input to be exactly: staging"
    say "reset: removing the staging containers and their volumes (database, n8n)"
    $COMPOSE --profile migrate --profile n8n-setup down -v --remove-orphans || fail "could not take the staging stack down"
    deploy
    ;;
  *)
    echo "usage: bash scripts/aiweb-staging-deploy.sh [--probe | --reset]" >&2
    exit 2
    ;;
esac
