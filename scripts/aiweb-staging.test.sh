#!/usr/bin/env bash
# D3 staging, part C: the staging AI web's stack on the production box, proved without the box.
#
#   1. scripts/check-aiweb-staging-compose.mjs passes the committed file and refuses every edit
#      that undoes the isolation (a check that cannot go red proves nothing);
#   2. scripts/aiweb-staging-secrets.sh makes only the absent keys, prints no value, and refuses
#      (writing nothing) a staging value equal to a production AI web value or the same signing key
#      as production's;
#   3. scripts/aiweb-staging-deploy.sh, against a fake docker, curl and Caddy: the password flow
#      (hashed by Caddy over stdin at cost 10, only the hash kept, the plaintext in no file, argument,
#      environment or log), Caddy reloaded when the login file changed and not otherwise, an unset
#      password switching staging off, the order of the steps, a failure stopping before the app, the
#      registry token out of every child's environment, and the probe judging each breach;
#   4. infra/aiweb-staging/n8n-rewrite.mjs points the workflows at the fake hydromart and stops on a
#      production host left in them;
#   5. deploy.sh and deploy.yml carry the password the way the registry token travels.
#
#   bash scripts/aiweb-staging.test.sh
set +e
cd "$(dirname "$0")/.."

fails=0
ok() { echo "  ok   $1"; }
bad() {
  echo "  FAIL $1"
  fails=$((fails + 1))
}
W="$(mktemp -d)"
trap 'rm -rf "$W"' EXIT
REAL_SLEEP="$(command -v sleep)"

# ------------------------------------------------------------------- 1. the compose policy
echo "compose policy (check-aiweb-staging-compose.mjs):"
if node scripts/check-aiweb-staging-compose.mjs >/dev/null 2>&1; then ok "the committed compose file passes"; else
  bad "the committed compose file fails: $(node scripts/check-aiweb-staging-compose.mjs 2>&1 | tail -3 | tr '\n' ' ')"; fi
mkdir -p "$W/mut"
mutate() { # <label> <sed expression on the compose file> <text the checker must say>
  sed "$2" infra/aiweb-staging/docker-compose.yml > "$W/mut/c.yml"
  if cmp -s infra/aiweb-staging/docker-compose.yml "$W/mut/c.yml"; then bad "$1: the mutation did not apply"; return; fi
  out="$(node scripts/check-aiweb-staging-compose.mjs "$W/mut/c.yml" 2>&1)"
  if [ $? = 1 ] && grep -qF -- "$3" <<<"$out"; then ok "refused: $1"; else bad "not refused: $1 ($out)"; fi
}
mutate "the app on edge" 's/^      edge-staging: {}$/      edge: {}/' 'must join exactly'
mutate "the private network not internal" 's/^    internal: true$/    internal: false/' 'networks.private must be'
mutate "a production secret interpolated" 's/\${STAGING_N8N_TOKEN:?/${AIWEB_N8N_TOKEN:?/' 'only STAGING_* keys'
mutate "the real alert channel" 's|ALERT_WEBHOOK_URL: http://hydromart-mock:9911/alert|ALERT_WEBHOOK_URL: ${ALERT_WEBHOOK_URL:-}|' 'ALERT_WEBHOOK_URL'
mutate "a production host name" 's|HYDROMART_API_URL: https://staging-ai.hydromart-digital.com|HYDROMART_API_URL: https://api.hydromart-digital.com|' 'may name only staging-ai.hydromart-digital.com'
mutate "a tag instead of a digest" 's|hydromart-ai@sha256:[0-9a-f]*|hydromart-ai:latest|' 'must be pinned by digest'
mutate "a published port" 's|^    entrypoint: \["node", "/mock/server.mjs"\]|    ports: ["9911:9911"]\n    entrypoint: ["node", "/mock/server.mjs"]|' 'publishes a port'
mutate "the host mounted" 's|      - ./mock:/mock:ro|      - /var/run/docker.sock:/mock:ro|' 'mounts'
mutate "the alias on edge-staging" 's|^      edge-staging: {}$|      edge-staging:\n        aliases: [aiweb]|' 'alias'
mutate "n8n editor on production's port" 's|127.0.0.1:5679:5678|127.0.0.1:5678:5678|' 'services.n8n.ports'
mutate "a project name that is production's" 's|^name: hydromart-ai-staging$|name: hydromart-ai|' 'name must be hydromart-ai-staging'
mutate "the memory budget" 's|mem_limit: 700m|mem_limit: 1100m|' 'budget is 1536m'
mutate "a missing limit" '0,/mem_limit: 64m/{/mem_limit: 64m/d}' 'mem_limit is missing'
mutate "n8n's SSRF allow list widened" 's|N8N_SSRF_ALLOWED_HOSTNAMES: aiweb,hydromart-mock|N8N_SSRF_ALLOWED_HOSTNAMES: "*"|' 'N8N_SSRF_ALLOWED_HOSTNAMES'

# ------------------------------------------------------------------ 2. the key maker
echo "key maker (aiweb-staging-secrets.sh):"
BOX="$W/box"
mkdir -p "$BOX/scripts"
cp scripts/aiweb-staging-secrets.sh scripts/env-set.sh "$BOX/scripts/"
STAGING_KEYS="STAGING_POSTGRES_PASSWORD STAGING_DB_OWNER_PASSWORD STAGING_DB_APP_PASSWORD STAGING_N8N_DB_PASSWORD STAGING_N8N_ENCRYPTION_KEY STAGING_N8N_TOKEN STAGING_HD_EVENT_SECRET STAGING_N8N_MACHINE_ID STAGING_N8N_MACHINE_SECRET STAGING_MOCK_SIGNING_KEY"
secrets() { OUT="$(cd "$BOX" && env ENV_SET_BLOCK='HIJACK=1' "$@" bash scripts/aiweb-staging-secrets.sh 2>&1)"; RC=$?; }
val() { sed -n "s/^$1=//p" "$BOX/.env" | tail -1; }
pkcs8() { openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 | openssl pkcs8 -topk8 -nocrypt -outform DER | base64 -w0; }
PROD_KEY="$(pkcs8)"
printf 'AIWEB_N8N_TOKEN=prodtoken\nAIWEB_DB_APP_PASSWORD=prodapp\nAI_TOKEN_SIGNING_KEY=%s\nSTAGING_N8N_TOKEN=keep-me\n' "$PROD_KEY" > "$BOX/.env"
secrets
[ "$RC" = 0 ] && ok "fills the absent keys (exit 0), and ignores an inherited ENV_SET_BLOCK" || bad "exited $RC: $OUT"
missing=''
for k in $STAGING_KEYS; do [ -n "$(val "$k")" ] || missing+=" $k"; done
[ "$(val STAGING_N8N_TOKEN)" = keep-me ] && missing="${missing:-}"
[ -z "$missing" ] && ok "every staging key has a value" || bad "no value for:$missing"
[ "$(val STAGING_N8N_TOKEN)" = keep-me ] && ok "a present line is left exactly as it is" || bad "STAGING_N8N_TOKEN was changed to $(val STAGING_N8N_TOKEN)"
! grep -q '^HIJACK=' "$BOX/.env" && ok "an inherited ENV_SET_BLOCK is not applied" || bad "HIJACK reached .env"
leak=''
for k in $STAGING_KEYS; do v="$(val "$k")"; [ "$k" = STAGING_N8N_TOKEN ] || { grep -qF -- "$v" <<<"$OUT" && leak+=" $k"; }; done
[ -z "$leak" ] && ok "no value is printed, only key names" || bad "printed the value of:$leak"
[[ "$(val STAGING_N8N_MACHINE_ID)" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] && [[ "$(val STAGING_POSTGRES_PASSWORD)" =~ ^[0-9a-f]{64}$ ]] &&
  ok "the machine id is a UUID and a password is 64 hex characters" || bad "formats: $(val STAGING_N8N_MACHINE_ID) $(val STAGING_POSTGRES_PASSWORD)"
[ "$(val STAGING_MOCK_SIGNING_KEY)" != "$PROD_KEY" ] && printf '%s' "$(val STAGING_MOCK_SIGNING_KEY)" | base64 -d | openssl pkey -inform DER -noout 2>/dev/null &&
  ok "the mock's signing key is an EC key of its own" || bad "the signing key is not a key, or is production's"
before="$(cat "$BOX/.env")"
secrets
[ "$RC" = 0 ] && [ "$(cat "$BOX/.env")" = "$before" ] && grep -qF 'nothing missing' <<<"$OUT" && ok "a second run writes nothing" || bad "second run ($RC): $OUT"

# The refusals: nothing is written, whatever else was missing.
printf 'AI_TOKEN_SIGNING_KEY=%s\nSTAGING_MOCK_SIGNING_KEY=%s\n' "$PROD_KEY" "$PROD_KEY" > "$BOX/.env"
secrets
[ "$RC" != 0 ] && grep -qF 'same key as AI_TOKEN_SIGNING_KEY' <<<"$OUT" && [ "$(wc -l < "$BOX/.env")" = 2 ] &&
  ok "the mock's key equal to production's AI_TOKEN_SIGNING_KEY: refused, nothing written" || bad "same key ($RC): $OUT"
# The same key, in another encoding of it (the public half decides): a PKCS8 DER made again from the PEM.
printf '%s' "$PROD_KEY" | base64 -d | openssl pkey -inform DER -outform PEM 2>/dev/null | openssl pkcs8 -topk8 -nocrypt -outform DER 2>/dev/null | base64 -w0 > "$W/again"
printf 'AI_TOKEN_SIGNING_KEY=%s\nSTAGING_MOCK_SIGNING_KEY=%s\n' "$PROD_KEY" "$(cat "$W/again")" > "$BOX/.env"
secrets
[ "$RC" != 0 ] && grep -qF 'same key as AI_TOKEN_SIGNING_KEY' <<<"$OUT" && ok "  ...compared as key material, not as text" || bad "same key re-encoded ($RC): $OUT"
printf 'AIWEB_N8N_TOKEN=shared\nSTAGING_N8N_TOKEN=shared\n' > "$BOX/.env"
secrets
[ "$RC" != 0 ] && grep -qF 'STAGING_N8N_TOKEN equals AIWEB_N8N_TOKEN' <<<"$OUT" && [ "$(wc -l < "$BOX/.env")" = 2 ] && ! grep -q shared <<<"$OUT" &&
  ok "a staging value equal to a production AI web value: refused by key names, the value not printed" || bad "equal values ($RC): $OUT"
printf 'STAGING_MOCK_SIGNING_KEY=not-a-key\n' > "$BOX/.env"
secrets
[ "$RC" != 0 ] && grep -qF 'is not an EC PKCS8 DER key' <<<"$OUT" && ok "a signing key that is not a key: refused" || bad "bad key ($RC): $OUT"
secrets AIWEB_NODE=/no/such/node
[ "$RC" != 0 ] && grep -qF 'no node' <<<"$OUT" && ok "no node on the host: nothing written, said" || bad "no node ($RC): $OUT"

# ------------------------------------------------------------ 3. the deploy script, fake docker
echo "deploy (aiweb-staging-deploy.sh, fake docker):"
BIN="$W/bin"
mkdir -p "$BIN"
cat > "$BIN/docker" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_LOG"
{ echo "--- docker $1"; env; } >> "$FAKE_ENVS"
args=" $* "
STAGE=hydromart-ai-staging
if [ "$1" = compose ]; then
  case "$args" in
    *" config --images "*) sed -n 's/^ *image: *//p' infra/aiweb-staging/docker-compose.yml ;;
    *" up --no-start "*) exit "${FAKE_NOSTART_RC:-0}" ;;
    *" psql "*" -f - "*)
      script="$(cat)"
      case "$script" in
        *"CREATE DATABASE"*) echo "psql-file roles" >> "$FAKE_LOG"; exit "${FAKE_ROLES_RC:-0}" ;;
        *"ALTER ROLE ai_app"*) echo "psql-file app-role" >> "$FAKE_LOG"; exit "${FAKE_APPROLE_RC:-0}" ;;
        *) exit 9 ;;
      esac ;;
    *" run "*" migrate "*) [ -z "${FAKE_MIGRATE_HANG:-}" ] || exec "$REAL_SLEEP" 30; exit "${FAKE_MIGRATE_RC:-0}" ;;
    *" run "*" n8n-setup "*) [ -z "${FAKE_SETUP_HANG:-}" ] || exec "$REAL_SLEEP" 30; exit "${FAKE_SETUP_RC:-0}" ;;
    *" down "*) exit "${FAKE_DOWN_RC:-0}" ;;
    *" up "*" db ") exit "${FAKE_DB_RC:-0}" ;;
    *" up "*) exit "${FAKE_APP_RC:-0}" ;;
    *" ps -q staging-aiweb "*) echo app1 ;;
    *" ps -q hydromart-mock "*) echo mock1 ;;
    *" ps -q n8n "*) [ -n "${FAKE_NO_N8N:-}" ] || echo n8n1 ;;
    *" logs "*) echo "the app's last line" ;;
  esac
  exit 0
fi
case "$1" in
  image) case " ${FAKE_PRESENT:-} " in *" $3 "*) exit 0 ;; *) exit 1 ;; esac ;;
  login) cat > "$FAKE_STDIN"; echo "$DOCKER_CONFIG" >> "$FAKE_CFGS"; exit "${FAKE_LOGIN_RC:-0}" ;;
  pull) echo "$DOCKER_CONFIG" >> "$FAKE_CFGS"; exit "${FAKE_PULL_RC:-0}" ;;
  logout | rm) exit 0 ;;
  network)
    case "$args" in
      *IPAM*)
        case "$args" in
          *" edge-staging "*) echo "172.30.0.1 " ;;
          *" hydromart-ai-staging_private "*) echo "172.31.0.1 " ;;
          *" hydromart-ai-staging_tunnel "*) echo "172.32.0.1 " ;;
          *) echo "172.22.0.1 " ;;
        esac ;;
      *Containers*)
        case "$args" in
          *" edge-staging "*) echo "caddy1 app1 mock1 ${FAKE_ES_EXTRA:-}" ;;
          *" edge "*) echo "caddy1 prodapp ${FAKE_EDGE_EXTRA:-}" ;;
          *_tunnel*) echo "n8n1 ${FAKE_TUNNEL_EXTRA:-}" ;;
        esac ;;
    esac ;;
  ps)
    case "$args" in
      *"project=$STAGE"*service=*) case "$args" in *service=staging-aiweb*) echo app1 ;; *service=hydromart-mock*) echo mock1 ;; *service=n8n*) [ -n "${FAKE_NO_N8N:-}" ] || echo n8n1 ;; esac ;;
      *"project=$STAGE"*) [ -n "${FAKE_NO_STAGING:-}" ] || printf '%s\n' app1 mock1 db1 n8n1 ;;
      *service=caddy*) echo caddy1 ;;
      *Ports*) printf '%s\n' '0.0.0.0:80->80/tcp, [::]:80->80/tcp, 0.0.0.0:443->443/tcp, 443/udp, 2019/tcp' ${FAKE_HOST_PORTS:-} ;;
      *project=hydromart-ai*) printf '%s\n' prodapp proddb ;;
      *project=hydromart*) printf '%s\n' pg1 caddy1 ;;
    esac ;;
  inspect)
    target="${*: -1}"
    case "$args" in
      *PortBindings*)
        case "$target" in
          app1) echo "staging-aiweb|edge-staging hydromart-ai-staging_private ${FAKE_EXTRA_NET:-}|${FAKE_BIND:-}" ;;
          mock1) echo "hydromart-mock|edge-staging hydromart-ai-staging_private |" ;;
          db1) echo "db|hydromart-ai-staging_private |" ;;
          n8n1) echo "n8n|hydromart-ai-staging_private hydromart-ai-staging_tunnel |${FAKE_N8N_BIND-5678/tcp->127.0.0.1:5679 }" ;;
        esac ;;
      *Config.Env*)
        echo "AI_WEB_URL=https://staging-ai.hydromart-digital.com"
        echo "HYDROMART_API_URL=https://staging-ai.hydromart-digital.com"
        [ -z "${FAKE_ENV_LEAK:-}" ] || echo "SOMETHING=https://api.hydromart-digital.com" ;;
      *ExposedPorts*)
        case "$target" in
          pg1) echo "/hydromart-postgres|hydromart_default=172.18.0.4 |5432/tcp " ;;
          caddy1) echo "/hydromart-caddy-1|edge=172.19.0.2 edge-staging=172.30.0.2 hydromart_default=172.18.0.30 |80/tcp 443/tcp 443/udp 2019/tcp " ;;
          prodapp) echo "/hydromart-ai-aiweb-1|edge=172.19.0.9 hydromart-ai_private=172.20.0.3 |3000/tcp " ;;
          proddb) echo "/hydromart-ai-db-1|hydromart-ai_private=172.20.0.2 |5432/tcp " ;;
        esac ;;
      *compose.project*)
        case "$target" in
          caddy1) echo hydromart/caddy ;; prodapp) echo hydromart-ai/aiweb ;;
          app1) echo hydromart-ai-staging/staging-aiweb ;; mock1) echo hydromart-ai-staging/hydromart-mock ;; n8n1) echo hydromart-ai-staging/n8n ;;
          *) echo "${FAKE_WHO:-?}/?" ;;
        esac ;;
    esac ;;
  exec)
    c="$2"
    [ "$c" = -i ] && c="$3"
    case "$args" in
      *"hash-password"*)
        cat > "$FAKE_PWSTDIN"
        echo "hash-password $*" >> "$FAKE_LOG"
        [ -z "${FAKE_HASH_FAIL:-}" ] || exit 1
        printf '%s\n' "${FAKE_HASH_OUT-\$2a\$10\$$(sha256sum < "$FAKE_PWSTDIN" | cut -c1-40)}" ;;
      *"caddy reload"*)
        echo "caddy-reload" >> "$FAKE_LOG"
        [ "${FAKE_RELOAD_RC:-0}" = 0 ] || exit "$FAKE_RELOAD_RC"
        # What Caddy now serves: the login file as it is.
        sed -n 's/^staging //p' infra/caddy/staging-auth/10-staging.caddy > "$FAKE_LIVE" 2>/dev/null
        exit 0 ;;
      *"drift.mjs"*)
        if [ -n "${FAKE_DRIFT_RC:-}" ]; then echo '[n8n-drift] a workflow still names hydromart-digital.com' >&2; exit "$FAKE_DRIFT_RC"; fi
        echo '[n8n-drift] none: 2 workflow(s) and 2 credential(s) as git holds them' ;;
      *" node - "*)
        cat >/dev/null
        shift 5
        asked="$FAKE_ASKED.$c"
        printf '%s\n' "$@" > "$asked"
        for t in "$@"; do
          case "$t" in
            db:5432) o=open ;;
            172.30.0.2:80 | 172.30.0.2:443) o=open ;;
            *:22) o=timeout ;;
            172.30.0.2:*) o=refused ;;
            [a-z]*) o=not-found ;;
            *) o=timeout ;;
          esac
          for pair in ${FAKE_OUTCOMES:-}; do [ "${pair%%=*}" = "$t" ] && o="${pair#*=}"; done
          echo "$o $t CODE-x"
        done ;;
      *" node -e "*)
        [ -z "${FAKE_JWKS_FAIL:-}" ] || [ "$c" != app1 ] || exit 1
        case "$c" in app1) echo "{\"keys\":[{\"kid\":\"${FAKE_APP_KID:-mockkid}\"}]}" ;; *) echo '{"keys":[{"kid":"mockkid"}]}' ;; esac ;;
      *" wget "*"/healthz"*) exit "${FAKE_N8N_HEALTH_RC:-0}" ;;
      *" wget "*) exit "${FAKE_FRONT_RC:-0}" ;;
    esac ;;
esac
exit 0
EOF
cat > "$BIN/curl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_CURL"
{ echo "--- curl"; env; } >> "$FAKE_ENVS"
prev=''
for a in "$@"; do [ "$prev" = --data ] && printf '%s\n' "$a" >> "$FAKE_ALERTS"; prev="$a"; done
pw=''
case " $* " in *" -K - "*) pw="$(sed -n 's/^user = "staging:\(.*\)"$/\1/p')"; echo "curl-config-user-seen" >> "$FAKE_CURL" ;; esac
hfile=''; ofile=''; url=''; prev=''
for a in "$@"; do
  [ "$prev" = -D ] && hfile="$a"
  [ "$prev" = -o ] && ofile="$a"
  prev="$a"; url="$a"
done
if [ -n "$hfile" ]; then
  # The screen walk (screens_probe): the AI web's /masuk, the fake hydromart's pick, the callback, the screens.
  origin="$(printf '%s' "$url" | sed 's|^\(https*://[^/]*\).*|\1|')"
  path="${url#"$origin"}"
  : > "$hfile"; : > "$ofile"
  loc() { printf 'HTTP/2 303\r\nLocation: %s\r\nSet-Cookie: s=1\r\n' "$1" > "$hfile"; printf 303; }
  heading=''
  case "$path" in
    /masuk) [ -n "${FAKE_NO_MASUK:-}" ] && { printf 500; exit 0; }
      loc "$origin/ai/masuk?challenge=c&state=s&return=r" ;;
    /ai/masuk) case " $* " in *" user=00000000-0000-4000-8000-000000000010&challenge=c&state=s&return=r "*) loc "$origin/masuk/callback?code=x&state=s" ;; *) printf 400 ;; esac ;;
    /masuk/callback*) loc "$origin/" ;;
    /) heading='Apa yang perlu Anda putuskan hari ini?' ;;
    /liga) heading='Liga depot kemarin' ;;
    /depot/00000000-0000-4000-9000-000000000001) heading='Bagaimana depot ini kemarin' ;;
    '/minta-akses?untuk=money') heading='Minta akses ke' ;;
    *) printf 404 ;;
  esac
  if [ -n "$heading" ]; then
    [ "$path" = "${FAKE_SCREEN_BAD:-}" ] && { printf 500; exit 0; }
    [ "$path" = "${FAKE_SCREEN_NOHEAD:-}" ] || printf '<h1>%s</h1>' "$heading" > "$ofile"
    printf 200
  fi
  exit 0
fi
case "$*" in
  */auth/api/v1/auth/jwks*) printf '{"keys":[{"kid":"%s"}]}' "${FAKE_PROD_KID:-prodkid}" ;;
  */api/internal/*) printf '%s' "${FAKE_INTERNAL_CODE:-404}" ;;
  */api/health*)
    if [ -z "$pw" ]; then printf '%s' "${FAKE_NOAUTH_CODE:-401}"; exit 0; fi
    live="$(cat "$FAKE_LIVE" 2>/dev/null)"
    # The fake hasher: $2a$10$ and the first 40 characters of the sha256 of the password and a newline.
    mine="\$2a\$10\$$(printf '%s\n' "$pw" | sha256sum | cut -c1-40)"
    if [ -n "$live" ] && [ "$live" = "$mine" ]; then printf '200'; else printf '401'; fi ;;
esac
exit 0
EOF
printf '#!/usr/bin/env bash\nexit 0\n' > "$BIN/sleep"
chmod +x "$BIN/docker" "$BIN/curl" "$BIN/sleep"
FAKE_ENV=("PATH=$BIN:$PATH" "FAKE_LOG=$W/log" "FAKE_ENVS=$W/envs" "FAKE_CURL=$W/curl" "FAKE_ALERTS=$W/alerts"
  "FAKE_CFGS=$W/cfgs" "FAKE_STDIN=$W/stdin" "FAKE_ASKED=$W/asked" "FAKE_PWSTDIN=$W/pwstdin" "FAKE_LIVE=$W/live"
  "REAL_SLEEP=$REAL_SLEEP" "STAGING_RELOAD_PAUSE=0")
reset_fakes() { for f in log envs curl alerts cfgs stdin pwstdin; do : > "$W/$f"; done; rm -f "$W"/asked.*; }

T="$W/deploy"
mkdir -p "$T/scripts/lib" "$T/infra/aiweb" "$T/infra/aiweb-staging" "$T/infra/caddy/staging-auth"
cp scripts/aiweb-staging-deploy.sh scripts/aiweb-staging-secrets.sh scripts/env-set.sh "$T/scripts/"
cp scripts/lib/deploy-common.sh scripts/lib/tcp-reach.cjs scripts/lib/aiweb-probe.sh "$T/scripts/lib/"
cp infra/aiweb/docker-compose.yml infra/aiweb/roles.sql infra/aiweb/app-role.sql "$T/infra/aiweb/"
cp infra/aiweb-staging/docker-compose.yml "$T/infra/aiweb-staging/"
# The firewall is its own test's (aiweb.test.sh): here it only has to be asked.
printf '#!/usr/bin/env bash\necho "firewall" >> "$FAKE_LOG"\nexit "${FAKE_FW_RC:-0}"\n' > "$T/scripts/aiweb-firewall.sh"
MOCK_KEY="$(pkcs8)"
GOOD_ENV='STAGING_POSTGRES_PASSWORD=p1
STAGING_DB_OWNER_PASSWORD=p2
STAGING_DB_APP_PASSWORD=p3
STAGING_N8N_DB_PASSWORD=p4
STAGING_N8N_ENCRYPTION_KEY=k5
STAGING_N8N_TOKEN=t6
STAGING_HD_EVENT_SECRET=h7
STAGING_N8N_MACHINE_ID=11111111-2222-4333-8444-555555555555
STAGING_N8N_MACHINE_SECRET=s8
STAGING_MOCK_SIGNING_KEY='"$MOCK_KEY"'
ALERT_WEBHOOK_URL=https://alert.invalid/hook'
IMAGES="$(sed -n 's/^ *image: *//p' infra/aiweb-staging/docker-compose.yml | tr '\n' ' ')"
PW='a-staging-pass-phrase-7'
PW2='another-pass-phrase-77'

# deploy <env assignments...>: one run; exit code in $RC, output in $W/out. State is kept between
# runs unless FRESH=1 (a first run on a clean box).
deploy() {
  [ -z "${FRESH:-}" ] || { rm -rf "$T/.deploy" "$T/infra/caddy/staging-auth/10-staging.caddy" "$W/live"; printf '%s\n' "${ENV_FILE:-$GOOD_ENV}" > "$T/.env"; }
  reset_fakes
  (cd "$T" && env "${FAKE_ENV[@]}" FAKE_PRESENT="$IMAGES" STAGING_URL_CHECK=1 "$@" ${RUNNER:-} bash scripts/aiweb-staging-deploy.sh) > "$W/out" 2>&1
  RC=$?
}
said() { grep -qF -- "$1" "$W/out"; }
called() { grep -qE -- "$1" "$W/log"; }
alerted() { grep -qF -- "$1" "$W/alerts"; }
line_of() { grep -nE -- "$1" "$W/log" | head -1 | cut -d: -f1; }
AUTHF="$T/infra/caddy/staging-auth/10-staging.caddy"

FRESH=1 deploy STAGING_AI_PASSWORD="$PW"
if [ "$RC" = 0 ] && said 'staging OK'; then ok "a clean box deploys, logs in and proves isolation (exit 0)"; else
  bad "the happy path failed ($RC): $(tail -5 "$W/out" | tr '\n' ' ')"; fi
scr=''
for p in '/' '/liga' '/depot/00000000-0000-4000-9000-000000000001' '/minta-akses?untuk=money'; do said "screens: $p answers 200 with its heading" || scr+=" $p"; done
[ -z "$scr" ] && ok "the screen probe signs in through /masuk and the fake hydromart's pick, and finds all four screens" || bad "screens missing:$scr"
hash1="$(sed -n "s/^STAGING_AI_BASIC_AUTH_HASH=//p" "$T/.env" | tr -d "'")"
[[ "$hash1" =~ ^\$2a\$10\$[0-9a-f]{40}$ ]] && [ "$(cat "$AUTHF")" = "staging $hash1" ] &&
  ok "ONLY the hash is kept: in .env (single-quoted) and in the Caddy login file" || bad "hash: '$hash1' file: '$(cat "$AUTHF" 2>&1)'"
grep -qF "STAGING_AI_BASIC_AUTH_HASH='$hash1'" "$T/.env" && ok "  ...single-quoted in .env, so compose never expands its dollar signs" || bad ".env: $(grep BASIC "$T/.env")"
leak=''
for f in "$T/.env" "$AUTHF" "$W/out" "$W/log" "$W/envs" "$W/curl" "$W/alerts" "$W/stdin"; do grep -qF -- "$PW" "$f" && leak+=" $f"; done
ls "$T"/.env.* >/dev/null 2>&1 && for f in "$T"/.env.*; do grep -qF -- "$PW" "$f" && leak+=" $f"; done
find "$T" -type f -print0 | xargs -0 grep -lF -- "$PW" 2>/dev/null | grep -q . && leak+=" (a file under the box)"
[ -z "$leak" ] && ok "the password is in no file, no argument, no environment dump, no log, no alert" || bad "the plaintext reached:$leak"
grep -qF -- "$PW" "$W/pwstdin" && grep -qF -- 'hash-password --algorithm bcrypt --bcrypt-cost 10' "$W/log" &&
  ok "Caddy's own hasher got the password on stdin, bcrypt, cost 10" || bad "hash-password call: $(grep hash-password "$W/log")"
grep -qF 'curl-config-user-seen' "$W/curl" && ! grep -qF 'staging:' <(grep -v 'curl-config-user-seen' "$W/curl") &&
  ok "curl got the login on its stdin (-K -), never as an argument" || bad "curl lines: $(head -3 "$W/curl" | tr '\n' ' ')"
! grep -E 'GHCR_TOKEN|STAGING_AI_PASSWORD' "$W/envs" | grep -v '^$' | grep -q . && ok "no child is ever handed the password or the registry token in its environment" ||
  bad "an environment dump holds a secret name: $(grep -E 'GHCR_TOKEN|STAGING_AI_PASSWORD' "$W/envs" | head -2 | tr '\n' ' ')"

# The order: networks, firewall, database, roles, migration, n8n out and set up, ai_app, the services, Caddy.
nostart="$(line_of ' up --no-start ')"; fw="$(line_of '^firewall')"; db="$(line_of ' up -d --wait .* db$')"
roles="$(line_of 'psql-file roles')"; mig="$(line_of ' run .*migrate')"; rm8="$(line_of ' rm --stop --force n8n')"
setup="$(line_of ' run .*n8n-setup')"; app="$(line_of 'psql-file app-role')"; up="$(line_of ' up -d --remove-orphans')"; rel="$(line_of '^caddy-reload')"
if [ -n "$nostart" ] && [ "$nostart" -lt "$fw" ] && [ "$fw" -lt "$db" ] && [ "$db" -lt "$roles" ] && [ "$roles" -lt "$mig" ] && [ "$mig" -lt "$rm8" ] &&
  [ "$rm8" -lt "$setup" ] && [ "$setup" -lt "$app" ] && [ "$app" -lt "$up" ] && [ "$up" -lt "$rel" ]; then
  ok "networks, firewall, database, roles, migration, n8n removed and set up, ai_app's password, the services, then Caddy's login"
else bad "order: nostart=$nostart fw=$fw db=$db roles=$roles mig=$mig rm=$rm8 setup=$setup app=$app up=$up reload=$rel"; fi
grep -E '^compose ' "$W/log" | grep -qvF -- 'infra/aiweb-staging/docker-compose.yml' && bad "a compose call that is not staging's: $(grep -E '^compose ' "$W/log" | grep -vF infra/aiweb-staging | head -1)" ||
  ok "every compose call names the staging file and nothing else"
[ "$(grep -c '^caddy-reload' "$W/log")" = 1 ] && ok "Caddy is reloaded once for the new login" || bad "reloads: $(grep -c '^caddy-reload' "$W/log")"

# Same password again: nothing is hashed, nothing reloaded.
deploy STAGING_AI_PASSWORD="$PW"
[ "$RC" = 0 ] && [ "$(sed -n "s/^STAGING_AI_BASIC_AUTH_HASH=//p" "$T/.env" | tr -d "'")" = "$hash1" ] && ! called 'hash-password' && ! called '^caddy-reload' && said 'still matches the hash' &&
  ok "the same password a second time: the hash is kept, nothing is hashed, Caddy is not reloaded" || bad "second run ($RC): $(grep -E 'hash|reload' "$W/log" | head -3 | tr '\n' ' ') $(tail -3 "$W/out" | tr '\n' ' ')"
# A rotated password: a new hash and one reload.
deploy STAGING_AI_PASSWORD="$PW2"
hash2="$(sed -n "s/^STAGING_AI_BASIC_AUTH_HASH=//p" "$T/.env" | tr -d "'")"
[ "$RC" = 0 ] && [ -n "$hash2" ] && [ "$hash2" != "$hash1" ] && [ "$(cat "$AUTHF")" = "staging $hash2" ] && called '^caddy-reload' &&
  ok "a changed password: a new hash in .env and in the login file, Caddy reloaded" || bad "rotation ($RC): $hash1 -> $hash2 $(tail -3 "$W/out" | tr '\n' ' ')"
! grep -rqF -- "$PW2" "$T/.env" "$AUTHF" "$W/log" "$W/out" "$W/envs" "$W/curl" && ok "  ...and the new password reached nothing either" || bad "the rotated password was written somewhere"
# The login file is in step but Caddy does not know: a reload failing is a failed deploy, said and alerted.
FRESH=1 deploy STAGING_AI_PASSWORD="$PW" FAKE_RELOAD_RC=1
[ "$RC" = 1 ] && said 'Caddy would not reload' && alerted 'staging AI web' && ok "a Caddy that will not reload: exit 1, said, one alert" || bad "reload failure ($RC): $(tail -3 "$W/out" | tr '\n' ' ')"
[ "$(grep -c '^caddy-reload' "$W/log")" = 3 ] && ok "  ...after three tries" || bad "tries: $(grep -c '^caddy-reload' "$W/log")"
[ ! -e "$AUTHF" ] && ok "  ...and the login file it had just written is removed again: the disk matches what Caddy serves" || bad "the new login file stayed: $(cat "$AUTHF")"
FRESH=1 deploy STAGING_AI_PASSWORD="$PW"
before_login="$(cat "$AUTHF")"
deploy STAGING_AI_PASSWORD="$PW2" FAKE_RELOAD_RC=1
[ "$RC" = 1 ] && [ "$(cat "$AUTHF")" = "$before_login" ] && ok "  ...and a changed login that Caddy refused is put back: the previous login file is on disk again" || bad "login file after a refused rotation ($RC): $(cat "$AUTHF") (was $before_login)"

# Unset password: staging off, the login gone, Caddy reloaded, nothing started.
FRESH=1 deploy STAGING_AI_PASSWORD="$PW"
deploy STAGING_AI_PASSWORD=''
[ "$RC" = 0 ] && said 'staging is OFF' && called ' down --remove-orphans' && [ ! -e "$AUTHF" ] && called '^caddy-reload' && ! called ' up ' && ! called ' pull ' &&
  ok "no password: the stack is taken down (volumes kept), the login file removed, Caddy reloaded, nothing started" || bad "off ($RC): $(tail -3 "$W/out" | tr '\n' ' ') $(grep -E ' down |reload' "$W/log" | tr '\n' ' ')"
! called ' down .*-v' && ok "  ...without -v: staging's data survives being switched off" || bad "down -v on a plain off"
FAKE_NO_STAGING=1 deploy STAGING_AI_PASSWORD=''
[ "$RC" = 0 ] && ! called ' down ' && ! called '^caddy-reload' && ok "  ...and a box with nothing of staging on it is left alone" || bad "off on an empty box ($RC): $(cat "$W/log" | tr '\n' ' ')"
# Bad passwords never reach docker.
for bad_pw in 'short' 'has space in it 123456' 'quote"in-the-password-1234'; do
  deploy STAGING_AI_PASSWORD="$bad_pw"
  [ "$RC" = 1 ] && said 'at least 16 characters' && ! called '^compose' && ! grep -qF -- "$bad_pw" "$W/out" || { bad "password '$bad_pw' ($RC): $(tail -2 "$W/out" | tr '\n' ' ')"; continue; }
done
ok "a password that is short or has characters curl's config line would read differently: refused before docker, and not echoed"

# Missing keys, images, registry token.
ENV_FILE='ALERT_WEBHOOK_URL=https://alert.invalid/hook' FRESH=1 deploy STAGING_AI_PASSWORD="$PW"
[ "$RC" = 0 ] && grep -q '^STAGING_POSTGRES_PASSWORD=[0-9a-f]\{64\}$' "$T/.env" && grep -q '^STAGING_MOCK_SIGNING_KEY=' "$T/.env" && ok "keys absent from .env: the deploy makes them first (the key maker, idempotent), then goes on" || bad "absent keys ($RC): $(tail -2 "$W/out" | tr '\n' ' ')"
ENV_FILE="$(printf '%s\n' "$GOOD_ENV" | sed 's/^STAGING_POSTGRES_PASSWORD=.*/STAGING_POSTGRES_PASSWORD=/')" FRESH=1 deploy STAGING_AI_PASSWORD="$PW"
[ "$RC" = 1 ] && said 'STAGING_POSTGRES_PASSWORD' && ! called ' up ' && ok "a blank key line is a decision the key maker leaves alone: named, nothing started" || bad "blank key ($RC): $(tail -2 "$W/out" | tr '\n' ' ')"
# A key equal to production's stops staging (never production): nothing is started, one alert.
ENV_FILE="$(printf '%s\nAIWEB_N8N_TOKEN=t6\n' "$GOOD_ENV")" FRESH=1 deploy STAGING_AI_PASSWORD="$PW"
[ "$RC" = 1 ] && said 'a staging key equals a production key' && ! called ' up ' && ! called '^firewall' && alerted 'NOT deployed' && ! grep -q 't6' "$W/out" &&
  ok "a hand-set staging key equal to a production AI web key: staging is not started, one alert, no value printed" || bad "equal key ($RC): $(tail -2 "$W/out" | tr '\n' ' ')"
ENV_FILE="$(printf '%s\nAI_TOKEN_SIGNING_KEY=%s\n' "$GOOD_ENV" "$MOCK_KEY")" FRESH=1 deploy STAGING_AI_PASSWORD="$PW"
[ "$RC" = 1 ] && said 'a staging key equals a production key' && ! called ' up ' && ok "the mock's signing key being production's token key: staging is not started" || bad "same signing key ($RC): $(tail -2 "$W/out" | tr '\n' ' ')"
FRESH=1 deploy STAGING_AI_PASSWORD="$PW" FAKE_PRESENT=''
[ "$RC" = 1 ] && said 'no registry token' && ! called ' up ' && ok "images missing and no token: stops before anything starts" || bad "no token ($RC): $(tail -2 "$W/out" | tr '\n' ' ')"
FRESH=1 deploy STAGING_AI_PASSWORD="$PW" FAKE_PRESENT='' GHCR_TOKEN=tok-xyz GHCR_USER=bot
pulled="$(grep -c '^pull ' "$W/log")"
[ "$RC" = 0 ] && [ "$pulled" -ge 3 ] && grep -qF tok-xyz "$W/stdin" && ! grep -qF tok-xyz "$W/envs" "$W/log" "$W/out" && grep -q '^logout' "$W/log" &&
  ok "missing images are pulled by digest with the token on stdin only, then logged out; the token is in no child's environment" || bad "pull ($RC): pulled=$pulled $(tail -2 "$W/out" | tr '\n' ' ')"
FRESH=1 deploy STAGING_AI_PASSWORD="$PW" FAKE_PRESENT='' GHCR_TOKEN=tok-xyz FAKE_PULL_RC=1
[ "$RC" = 1 ] && said 'could not pull' && ! called ' up ' && alerted 'NOT deployed' && ok "a failed pull stops before anything starts, one alert" || bad "pull failure ($RC)"

# Failures stop before the app.
FRESH=1 deploy STAGING_AI_PASSWORD="$PW" FAKE_MIGRATE_RC=1
[ "$RC" = 1 ] && said 'migration job failed' && ! called 'psql-file app-role' && ! called ' up -d --remove-orphans' && alerted 'NOT deployed' &&
  ok "a failed migration: ai_app's password untouched, the app not swapped, an alert" || bad "migration failure ($RC)"
FRESH=1 deploy STAGING_AI_PASSWORD="$PW" FAKE_SETUP_RC=1
[ "$RC" = 1 ] && said "n8n's setup failed" && ! called 'psql-file app-role' && ! called ' up -d --remove-orphans' && ok "a failed n8n setup: n8n left off, ai_app's password untouched" || bad "setup failure ($RC)"
FRESH=1 deploy STAGING_AI_PASSWORD="$PW" FAKE_ROLES_RC=1
[ "$RC" = 1 ] && said 'roles.sql failed' && ! called ' run ' && ok "a failed roles file: no migration" || bad "roles failure ($RC)"
FRESH=1 deploy STAGING_AI_PASSWORD="$PW" FAKE_MIGRATE_HANG=1 STAGING_MIGRATE_TIMEOUT=1 REAL_SLEEP="$REAL_SLEEP"
[ "$RC" = 1 ] && said 'migration job failed' && ok "a hung migration is stopped by its timeout" || bad "migration hang ($RC)"
FRESH=1 deploy STAGING_AI_PASSWORD="$PW" FAKE_FW_RC=1
[ "$RC" = 0 ] && said 'could not close the host' && ok "a firewall that could not be written is said and left to the probe: the deploy goes on" || bad "firewall failure ($RC)"

# The probe judges every breach.
probe_case() { # <what> <expected text> <env assignments...>
  local what="$1" text="$2"
  shift 2
  deploy STAGING_AI_PASSWORD="$PW" "$@"
  if [ "$RC" = 1 ] && grep -qF -- "$text" "$W/out" && alerted 'NOT deployed or not isolated'; then ok "probe: $what"; else bad "probe: $what ($RC): $(grep '!!' "$W/out" | head -3 | tr '\n' ' ')"; fi
}
FRESH=1 deploy STAGING_AI_PASSWORD="$PW"
probe_case "the app attached to edge" 'is attached to network edge' FAKE_EXTRA_NET=edge
probe_case "a stranger on edge-staging" 'on the edge-staging network' FAKE_ES_EXTRA=intruder FAKE_WHO=other/svc
probe_case "a port published beyond n8n's editor" 'publishes a host port' FAKE_BIND='3000/tcp->0.0.0.0:3000 '
probe_case "n8n's editor on another port" 'publishes a host port' FAKE_N8N_BIND='5678/tcp->127.0.0.1:5678 '
probe_case "the app reaching the production AI web (172.20.0.3:3000)" 'reaches' FAKE_OUTCOMES='172.20.0.3:3000=open'
probe_case "the app reaching a production database" 'hydromart-ai-db-1' FAKE_OUTCOMES='172.20.0.2:5432=refused'
probe_case "the app reaching hydromart's postgres" 'hydromart-postgres' FAKE_OUTCOMES='172.18.0.4:5432=open'
probe_case "the app reaching the internet" 'internet' FAKE_OUTCOMES='1.1.1.1:443=open'
probe_case "the host's ssh answering at a gateway" 'host-ssh' FAKE_OUTCOMES='172.31.0.1:22=open'
probe_case "a host service answering n8n on the tunnel gateway" 'reaches host at 172.32.0.1:5432' FAKE_HOST_PORTS='127.0.0.1:5432->5432/tcp' FAKE_OUTCOMES='172.32.0.1:5432=open'
probe_case "a host service answering the app on the private gateway" 'reaches host at 172.31.0.1:5432' FAKE_HOST_PORTS='127.0.0.1:5432->5432/tcp' FAKE_OUTCOMES='172.31.0.1:5432=open'
probe_case "Caddy's admin port answering" 'caddy' FAKE_OUTCOMES='172.30.0.2:2019=open'
probe_case "the app's keys not the fake hydromart's" 'are not the fake hydromart' FAKE_APP_KID=someone-elses
probe_case "the app's keys the same as production's" "also in production's key set" FAKE_PROD_KID=mockkid
probe_case "a production host in a container's environment" 'name a hydromart-digital.com host' FAKE_ENV_LEAK=1
probe_case "n8n's drift check finding a production host" 'drift check exit 1' FAKE_DRIFT_RC=1
probe_case "the site open without a password" 'must be 401' FAKE_NOAUTH_CODE=200
probe_case "the internal routes reachable" '/api/internal/n8n/failure answered 200' FAKE_INTERNAL_CODE=200
probe_case "Caddy unable to reach the app" 'Caddy cannot reach' FAKE_FRONT_RC=1
probe_case "the sign-in not starting (/masuk answers 500)" 'screens: /masuk answered 500' FAKE_NO_MASUK=1
probe_case "a screen answering 500" 'screens: GET /liga answered 500' FAKE_SCREEN_BAD=/liga
probe_case "a screen without its heading" "screens: GET /depot/00000000-0000-4000-9000-000000000001 answered 200 without its heading" FAKE_SCREEN_NOHEAD=/depot/00000000-0000-4000-9000-000000000001
probe_case "the Minta akses screen without its heading" "GET /minta-akses?untuk=money answered 200 without its heading" 'FAKE_SCREEN_NOHEAD=/minta-akses?untuk=money'
FRESH=1 deploy STAGING_AI_PASSWORD="$PW"
grep -qF 'edge-staging' "$W/asked.app1" 2>/dev/null || true
for t in 172.30.0.2:80 172.30.0.2:443 172.20.0.3:3000 172.20.0.2:5432 172.18.0.4:5432 172.19.0.2:443 1.1.1.1:443 172.30.0.1:22 172.31.0.1:22 172.32.0.1:22 db:5432; do
  grep -qxF "$t" "$W/asked.app1" || { bad "the app was never asked about $t: $(tr '\n' ' ' < "$W/asked.app1")"; continue; }
done
ok "the app is tried against Caddy's front, the production AI web's app and database, hydromart, the internet and every staging gateway's ssh"
grep -qxF 1.1.1.1:443 "$W/asked.mock1" && ! grep -qxF 1.1.1.1:443 "$W/asked.n8n1" && ok "the mock is tried against the internet too; n8n (which has its tunnel network) is not" || bad "internet plan: mock $(grep -c 1.1.1.1 "$W/asked.mock1") n8n $(grep -c 1.1.1.1 "$W/asked.n8n1")"
# --probe alone, and --reset.
deploy --probe
if [ "$RC" != 0 ]; then
  (cd "$T" && env "${FAKE_ENV[@]}" STAGING_AI_PASSWORD="$PW" bash scripts/aiweb-staging-deploy.sh --probe) > "$W/out" 2>&1; RC=$?
fi
[ "$RC" = 0 ] && said 'probe OK' && ! called ' up ' && ok "--probe asks and starts nothing" || bad "--probe ($RC): $(tail -3 "$W/out" | tr '\n' ' ')"
deploy STAGING_AI_PASSWORD="$PW" RESET_CONFIRM=nope
(cd "$T" && env "${FAKE_ENV[@]}" FAKE_PRESENT="$IMAGES" STAGING_AI_PASSWORD="$PW" RESET_CONFIRM=nope bash scripts/aiweb-staging-deploy.sh --reset) > "$W/out" 2>&1; RC=$?
[ "$RC" = 1 ] && said 'confirm input to be exactly: staging' && ! called ' down ' && ok "--reset without the exact confirmation does nothing" || bad "reset without confirm ($RC)"
reset_fakes
(cd "$T" && env "${FAKE_ENV[@]}" FAKE_PRESENT="$IMAGES" STAGING_AI_PASSWORD="$PW" RESET_CONFIRM=staging bash scripts/aiweb-staging-deploy.sh --reset) > "$W/out" 2>&1; RC=$?
down="$(line_of ' down .*-v')"; nostart="$(line_of ' up --no-start ')"
[ "$RC" = 0 ] && [ -n "$down" ] && [ "$down" -lt "$nostart" ] && ok "--reset with the confirmation: containers and volumes dropped first, then a full deploy" || bad "reset ($RC): down=$down nostart=$nostart"
(cd "$T" && env "${FAKE_ENV[@]}" bash scripts/aiweb-staging-deploy.sh --bogus) >/dev/null 2>&1
[ $? = 2 ] && ok "an unknown argument is a usage error" || bad "usage exit"
first_cmd="$(grep -nvE '^[[:space:]]*(#|$)' scripts/aiweb-staging-deploy.sh | head -4 | cut -d: -f2- | tr '\n' ';')"
case "$first_cmd" in
  'ghcr_token="${GHCR_TOKEN:-}";ghcr_user="${GHCR_USER:-}";staging_pw="${STAGING_AI_PASSWORD:-}";unset GHCR_TOKEN GHCR_USER STAGING_AI_PASSWORD;') ok "the script takes the token and the password out of its environment before its first other command" ;;
  *) bad "the first commands are not the secret handling: $first_cmd" ;;
esac

# ------------------------------------------------------------------ 4. the n8n rewrite
echo "n8n rewrite (infra/aiweb-staging/n8n-rewrite.mjs):"
mkdir -p "$W/n8n/workflows" "$W/n8n/bin"
printf '%s' '{"nodes":[{"url":"https://api.hydromart-digital.com/auth/api/v1/auth/machine/token"},{"url":"http://aiweb:3000/api/internal/n8n/failure"}]}' > "$W/n8n/workflows/a.json"
printf '%s' '[{"id":"a","allowedDomains":"aiweb"},{"id":"b","allowedDomains":"api.hydromart-digital.com"}]' > "$W/n8n/credentials.json"
printf 'console.log(process.env.N8N_SETUP_ROOT)\n' > "$W/echo.mjs"
out="$(N8N_SETUP_ROOT="$W/n8n" node infra/aiweb-staging/n8n-rewrite.mjs node "$W/echo.mjs" 2>&1)"
root="${out##*$'\n'}"
if [ -d "$root/workflows" ] && grep -qF 'http://hydromart-mock:9911/auth/api/v1/auth/machine/token' "$root/workflows/a.json" && grep -qF 'http://aiweb:3000/api/internal/n8n/failure' "$root/workflows/a.json" &&
  ! grep -qF 'hydromart-digital.com' "$root/workflows/a.json" "$root/credentials.json" && grep -qF '"allowedDomains": "hydromart-mock"' "$root/credentials.json" && grep -qF '"allowedDomains": "aiweb"' "$root/credentials.json" &&
  grep -qF 'api.hydromart-digital.com' "$W/n8n/workflows/a.json"; then
  ok "the copy names the fake hydromart, keeps aiweb, and the image's own files are not changed; the command runs on the copy (N8N_SETUP_ROOT)"
else bad "rewrite: $out"; fi
printf '%s' '{"nodes":[{"url":"https://www.hydromart-digital.com/x"}]}' > "$W/n8n/workflows/b.json"
out="$(N8N_SETUP_ROOT="$W/n8n" node infra/aiweb-staging/n8n-rewrite.mjs node "$W/echo.mjs" 2>&1)"
[ $? = 1 ] && grep -qF 'still names hydromart-digital.com' <<<"$out" && ! grep -qF "$W/n8n" <<<"$(tail -1 <<<"$out")" &&
  ok "a production host the rewrite does not know: it stops before the command runs" || bad "stray host ($?): $out"
node infra/aiweb-staging/n8n-rewrite.mjs >/dev/null 2>&1
[ $? = 2 ] && ok "no command: a usage error" || bad "no command exit"

# ------------------------------------------------------------------ 5. the hooks
echo "hooks (deploy.sh, deploy.yml):"
n() { grep -nF -- "$1" scripts/deploy.sh | head -1 | cut -d: -f1; }
top="$(n 'STAGING_PW="${STAGING_AI_PASSWORD:-}"')"; unset_line="$(grep -nx 'unset STAGING_AI_PASSWORD' scripts/deploy.sh | head -1 | cut -d: -f1)"
keys="$(n 'bash scripts/aiweb-staging-secrets.sh')"; aiweb="$(n 'bash scripts/aiweb-deploy.sh')"; stg="$(n 'bash scripts/aiweb-staging-deploy.sh')"
deployed="$(n 'DEPLOY OK')"
[ -n "$top" ] && [ "$top" -lt 80 ] && [ -n "$unset_line" ] && ok "deploy.sh takes the password out of the environment at the top, with the registry token" || bad "capture: $top $unset_line"
[ -n "$keys" ] && [ -n "$aiweb" ] && [ -n "$stg" ] && [ "$aiweb" -lt "$stg" ] && ok "deploy.sh makes the staging keys, and runs staging after the production AI web" || bad "order: keys=$keys aiweb=$aiweb staging=$stg"
sed -n "${stg}p" scripts/deploy.sh | grep -qF 'timeout --kill-after=60 1800' && sed -n "${stg}p" scripts/deploy.sh | grep -qF '|| STAGING_RC=$?' &&
  ok "  ...under timeout 1800, ending in ||: it cannot fail hydromart's deploy" || bad "staging line: $(sed -n "${stg}p" scripts/deploy.sh)"
[ "$stg" -gt "$deployed" ] && ok "  ...after DEPLOY OK is written" || bad "staging before DEPLOY OK"
grep -qF 'STAGING_AI_PASSWORD: ${{' .github/workflows/deploy.yml && grep -qE 'envs: .*STAGING_AI_PASSWORD' .github/workflows/deploy.yml &&
  grep -qF "startsWith(inputs.mode, 'staging-')" .github/workflows/deploy.yml && ok "deploy.yml hands the secret to the SSH step on the deploy paths and the staging modes only" || bad "deploy.yml"
grep -qE '^ *staging-reset\) echo "run=bash scripts/aiweb-staging-deploy.sh --reset"' .github/workflows/deploy.yml &&
  grep -qE '^ *staging-deploy\) echo' .github/workflows/deploy.yml && ok "deploy.yml has the staging-deploy and staging-reset modes" || bad "deploy.yml modes"
! grep -rn 'STAGING_AI_PASSWORD' .github/workflows/*.yml | grep -vE 'deploy.yml' | grep -q . && ok "no other workflow reads the secret" || bad "another workflow reads STAGING_AI_PASSWORD"

echo
if [ "$fails" = 0 ]; then echo "staging AI web: all checks passed"; else
  echo "staging AI web: $fails check(s) FAILED"
  exit 1
fi
