#!/usr/bin/env bash
# HD-9 — the AI web's stack on the production box, proved without the box:
#
#   1. scripts/check-aiweb-compose.mjs refuses every edit that undoes the isolation, and passes
#      the committed files (a check that cannot go red, or cannot go green, proves nothing);
#   2. scripts/aiweb-secrets.sh writes only the keys whose line is absent, in the formats
#      auth-service accepts at boot, prints no value, never applies an inherited ENV_SET_BLOCK,
#      and never makes TOTP_ENCRYPTION_KEY while sealed secrets exist or cannot be counted;
#   3. scripts/aiweb-deploy.sh, against a fake docker: never names hydromart's compose files,
#      keeps the registry token out of every child's environment, stops before the app on a
#      failed pull, roles file or migration (and before ai_app's password too), bounds the
#      migration, and judges every hydromart address it can find: only no answer is isolation;
#   4. deploy.sh runs the key maker before its converge and the AI web after DEPLOY OK, where
#      it cannot fail the deploy and is stopped after 30 minutes, and deploy.yml hands over a
#      token that can read packages.
#
#   bash scripts/aiweb.test.sh
#
# `set +e` for the reason its siblings give: CI runs them as `bash -e <file>`, and several
# commands below exit non-zero on purpose.
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

# ------------------------------------------------------------ the fake box, used by 2 and 3
# docker: logs every call to $FAKE_LOG and its environment to $FAKE_ENVS, answers from FAKE_*.
# The AI web: app1, db1. Hydromart: pg1, gw1, web1, caddy1 (on edge too), sched1 (no port).
BIN="$W/bin"
mkdir -p "$BIN"
cat > "$BIN/docker" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_LOG"
{ echo "--- docker $1"; env; } >> "$FAKE_ENVS"
args=" $* "
if [ "$1" = compose ]; then
  case "$args" in
    *" config --images "*) sed -n 's/^ *image: *//p' infra/aiweb/docker-compose.yml ;;
    *" psql "*" -f - "*)
      script="$(cat)"
      case "$script" in
        *"CREATE DATABASE"*) echo "psql-file roles" >> "$FAKE_LOG"; exit "${FAKE_ROLES_RC:-0}" ;;
        *"ALTER ROLE ai_app"*) echo "psql-file app-role" >> "$FAKE_LOG"; exit "${FAKE_APPROLE_RC:-0}" ;;
        *) echo "psql-file unknown" >> "$FAKE_LOG"; exit 9 ;;
      esac ;;
    *" psql "*)
      if [ -n "${FAKE_GRANTS:-}" ]; then printf '%s\n' "$FAKE_GRANTS"; else
        printf '%s\n' answer_trail:INSERT,SELECT kill_switch_events:INSERT,SELECT kill_switches:DELETE,INSERT,SELECT,UPDATE
      fi ;;
    *" run "*" migrate "*)
      [ -z "${FAKE_MIGRATE_HANG:-}" ] || exec "$REAL_SLEEP" 30
      exit "${FAKE_MIGRATE_RC:-0}" ;;
    *" up "*" db ") exit "${FAKE_DB_RC:-0}" ;;
    *" up "*) exit "${FAKE_APP_RC:-0}" ;;
    *" ps -q aiweb "*) echo app1 ;;
    *" logs "*) echo "the app's last line" ;;
  esac
  exit 0
fi
case "$1" in
  image) case " ${FAKE_PRESENT:-} " in *" $3 "*) exit 0 ;; *) exit 1 ;; esac ;;
  login) cat > "$FAKE_STDIN"; echo "$DOCKER_CONFIG" >> "$FAKE_CFGS"; exit "${FAKE_LOGIN_RC:-0}" ;;
  pull)
    echo "$DOCKER_CONFIG" >> "$FAKE_CFGS"
    [ -z "${FAKE_PULL_HANG:-}" ] || exec "$REAL_SLEEP" 30
    exit "${FAKE_PULL_RC:-0}" ;;
  logout | rm) exit 0 ;;
  network)
    case "$args" in
      *IPAM*) echo "172.19.0.1 " ;;
      *Containers*) echo "caddy1 app1 ${FAKE_EDGE_EXTRA:-}" ;;
    esac ;;
  ps)
    case "$args" in
      *project=hydromart-ai*service=migrate*) [ -z "${FAKE_MIGRATE_HANG:-}" ] || echo mig1 ;;
      *project=hydromart-ai*) printf '%s\n' app1 db1 ;;
      *service=caddy*) echo caddy1 ;;
      *Ports*)
        printf '%s\n' '127.0.0.1:5432->5432/tcp' '127.0.0.1:8080->8080/tcp' \
          '0.0.0.0:80->80/tcp, [::]:80->80/tcp, 0.0.0.0:443->443/tcp, [::]:443->443/tcp, 443/udp, 2019/tcp' ${FAKE_PORTS:-} ;;
      *project=hydromart*) printf '%s\n' ${FAKE_HM-pg1 gw1 caddy1 sched1} ;;
    esac ;;
  inspect)
    target="${*: -1}"
    case "$args" in
      *PortBindings*)
        case "$target" in
          app1) echo "aiweb|edge hydromart-ai_private ${FAKE_EXTRA_NET:-}|${FAKE_BIND:-}" ;;
          db1) echo "db|hydromart-ai_private |" ;;
        esac ;;
      *ExposedPorts*)
        case "$target" in
          pg1) echo "/hydromart-postgres|hydromart_default=172.18.0.4 |5432/tcp " ;;
          gw1) echo "/hydromart-gateway-1|hydromart_default=172.18.0.9 |8080/tcp " ;;
          web1) echo "/hydromart-web-1|hydromart_default=172.18.0.29 |3000/tcp 3001/tcp " ;;
          caddy1) echo "/hydromart-caddy-1|edge=172.19.0.2 hydromart_default=172.18.0.30 |80/tcp 443/tcp 443/udp 2019/tcp " ;;
          sched1) echo "/hydromart-scheduler-1|hydromart_default=172.18.0.3 |" ;;
        esac ;;
      *compose.project*) case "$target" in caddy1) echo hydromart/caddy ;; app1) echo hydromart-ai/aiweb ;; gw1) echo hydromart/gateway ;; esac ;;
    esac ;;
  exec)
    case "$args" in
      *" totp_credentials "*)
        if [ -n "${FAKE_TOTP_FAIL:-}" ]; then echo 'psql: error: connection to server failed' >&2; exit 2; fi
        echo "${FAKE_TOTP_COUNT:-0}" ;;
      *" node - "*)
        cat >/dev/null
        shift 5
        printf '%s\n' "$@" > "$FAKE_ASKED"
        for t in "$@"; do
          # The box as it is: own database open, names unknown, Caddy's front open, the host's
          # loopback ports refused, every other address dropped. FAKE_OUTCOMES overrides.
          case "$t" in
            db:5432) o=open ;;
            172.19.0.2:80 | 172.19.0.2:443 | 172.19.0.1:22) o=open ;;
            172.19.0.*) o=refused ;;
            [a-z]*) o=not-found ;;
            *) o=timeout ;;
          esac
          [ -n "${FAKE_DB_CLOSED:-}" ] && [ "$t" = db:5432 ] && o=timeout
          for pair in ${FAKE_OUTCOMES:-}; do [ "${pair%%=*}" = "$t" ] && o="${pair#*=}"; done
          echo "$o $t CODE-${FAKE_CODE:-x}"
        done ;;
      *" node -e "*) [ -z "${FAKE_JWKS_FAIL:-}" ] || exit 1; echo '{"keys":[{"kid":"k1"}]}' ;;
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
case "$*" in */api/health*) printf '%s' "${FAKE_PUBLIC:-200}" ;; esac
exit 0
EOF
printf '#!/usr/bin/env bash\nexit 0\n' > "$BIN/sleep"
chmod +x "$BIN/docker" "$BIN/curl" "$BIN/sleep"
# What every fake run needs, as `env` arguments. An array: PATH may hold spaces.
FAKE_ENV=("PATH=$BIN:$PATH" "FAKE_LOG=$W/log" "FAKE_ENVS=$W/envs" "FAKE_CURL=$W/curl"
  "FAKE_ALERTS=$W/alerts" "FAKE_CFGS=$W/cfgs" "FAKE_STDIN=$W/stdin" "FAKE_ASKED=$W/asked"
  "REAL_SLEEP=$REAL_SLEEP")
reset_fakes() { for f in log envs curl alerts cfgs stdin asked; do : > "$W/$f"; done; }

# ------------------------------------------------------------------- 1. the compose policy
echo "compose policy (check-aiweb-compose.mjs):"
if node scripts/check-aiweb-compose.mjs >/dev/null 2>&1; then
  ok "the committed compose file and Caddy site pass"
else
  bad "the committed files fail: $(node scripts/check-aiweb-compose.mjs 2>&1 | tail -3 | tr '\n' ' ')"
fi

# One edit per way the isolation is undone, applied to the committed file through js-yaml.
mutant() { # <name> <JS statement on `doc`>
  node -e '
    const fs = require("fs");
    const yaml = require("js-yaml");
    const doc = yaml.load(fs.readFileSync(process.argv[1], "utf8"));
    new Function("doc", process.argv[2])(doc);
    fs.writeFileSync(process.argv[3], yaml.dump(doc));
  ' infra/aiweb/docker-compose.yml "$2" "$W/$1.yml"
}
refuses() { # <name> <JS statement> <words the refusal must contain> <what it undoes>
  mutant "$1" "$2" || {
    bad "could not build the mutant $1"
    return
  }
  local out
  if out="$(node scripts/check-aiweb-compose.mjs "$W/$1.yml" 2>&1)"; then
    bad "accepts $4"
  elif printf '%s' "$out" | grep -qF "$3"; then
    ok "refuses $4"
  else
    bad "refuses $4, but not for that reason: $(printf '%s' "$out" | tail -2 | tr '\n' ' ')"
  fi
}
# The control: the same round trip with no edit must pass, or every refusal below is vacuous.
mutant identity 'void doc' && node scripts/check-aiweb-compose.mjs "$W/identity.yml" >/dev/null 2>&1 &&
  ok "an unedited round trip through js-yaml still passes (the refusals below are the edits')" ||
  bad "an unedited round trip fails, so the refusals below prove nothing"

refuses ports 'doc.services.aiweb.ports = ["3000:3000"]' 'sets `ports`' "a published host port"
refuses tag 'doc.services.aiweb.image = "ghcr.io/m0gsy/hydromart-ai:latest"' 'pinned by digest' "an image by tag"
refuses join 'doc.networks.hydromart_default = { external: true }; doc.services.aiweb.networks.push("hydromart_default")' \
  'networks.hydromart_default must be' "joining hydromart's own network"
refuses open 'doc.networks.private.internal = false' 'must be `internal: true`' "a database network with a way out"
refuses default 'delete doc.services.db.networks' 'lists no networks' "a service left on compose's default network"
refuses secret 'doc.services.aiweb.environment.JWT = "${JWT_ACCESS_SECRET}"' 'JWT_ACCESS_SECRET' "a hydromart secret read from .env"
refuses owner 'doc.services.aiweb.environment.DATABASE_URL = doc.services.migrate.environment.DATABASE_URL' 'connects as ai_owner' "the app connecting as the owning role"
refuses super 'doc.services.aiweb.environment.DATABASE_URL = "postgresql://postgres:x@db:5432/ai"' 'connects as postgres' "the app connecting as the superuser"
refuses sock 'doc.services.aiweb.volumes = ["/var/run/docker.sock:/var/run/docker.sock"]' 'only this file' "a bind mount of the docker socket"
refuses privileged 'doc.services.aiweb.privileged = true' 'sets `privileged`' "a privileged container"
refuses hostnet 'doc.services.aiweb.network_mode = "host"' 'sets `network_mode`' "the host's network"
refuses envfile 'doc.services.aiweb.env_file = ["../../.env"]' 'sets `env_file`' "the whole .env handed to a container"
refuses twofront 'doc.services.db.networks = ["private", "edge"]' 'exactly one service may join edge' "the database on edge"
refuses project 'doc.name = "hydromart"' 'project of its own' "hydromart's own project name"
refuses edgename 'doc.networks.edge = { external: true, name: "hydromart_default" }' 'networks.edge must be' "edge pointed at another network"
refuses origin 'doc.services.aiweb.environment.AI_WEB_URL = "https://ai.example.com"' 'serves ai.hydromart-digital.com' "an AI_WEB_URL the Caddy site does not serve"

sed 's/import hsts//' infra/caddy/sites/aiweb.caddy > "$W/nohsts.caddy"
node scripts/check-aiweb-compose.mjs infra/aiweb/docker-compose.yml "$W/nohsts.caddy" >/dev/null 2>&1 &&
  bad "accepts a site with no HSTS" || ok "refuses a site with no HSTS"
sed 's/aiweb:3000/gateway:8080/' infra/caddy/sites/aiweb.caddy > "$W/elsewhere.caddy"
node scripts/check-aiweb-compose.mjs infra/aiweb/docker-compose.yml "$W/elsewhere.caddy" >/dev/null 2>&1 &&
  bad "accepts a site that proxies somewhere else" || ok "refuses a site that proxies somewhere else"

# --------------------------------------------------------------------- 2. the key maker
echo "key maker (aiweb-secrets.sh):"
BOX="$W/box"
mkdir -p "$BOX/scripts" "$BOX/infra/aiweb"
cp scripts/aiweb-secrets.sh scripts/env-set.sh "$BOX/scripts/"
cp infra/aiweb/docker-compose.yml "$BOX/infra/aiweb/"
secrets() { # <env assignments...>: one key-maker run on the scratch box; exit code in $RC
  reset_fakes
  OUT="$(cd "$BOX" && env "${FAKE_ENV[@]}" "$@" bash scripts/aiweb-secrets.sh 2>&1)"
  RC=$?
}
val() { sed -n "s/^$1=//p" "$BOX/.env" | tail -1; }

# A present line stays as it is, blank included: blank AI_TOKEN_SIGNING_KEY is the kill switch.
printf 'POSTGRES_PASSWORD=keep-me\nAI_TOKEN_SIGNING_KEY=\nAIWEB_DB_APP_PASSWORD=already-here\n' > "$BOX/.env"
secrets ENV_SET_BLOCK='HIJACK=1'
[ "$RC" = 0 ] && ok "fills the absent keys (exit 0)" || bad "exited $RC: $OUT"
for k in AIWEB_POSTGRES_PASSWORD AIWEB_DB_OWNER_PASSWORD; do
  [[ "$(val "$k")" =~ ^[0-9a-f]{64}$ ]] && ok "$k: 64 hex characters" || bad "$k is not 64 hex characters"
done
[[ "$(val TOTP_ENCRYPTION_KEY)" =~ ^[A-Za-z0-9+/]{43}=$ ]] &&
  ok "zero sealed secrets: TOTP_ENCRYPTION_KEY made, 32 bytes of base64 as auth-service wants" ||
  bad "TOTP_ENCRYPTION_KEY was not made, or has the wrong form"
grep -F 'totp_credentials' "$W/log" | grep -F 'exec hydromart-postgres psql' | grep -F -- '-U hydromart -d hydromart_auth' |
  grep -qF 'BEGIN READ ONLY' &&
  ok "the sealed secrets are counted read-only, in hydromart-postgres as hydromart" ||
  bad "the count did not run as BEGIN READ ONLY in hydromart-postgres/hydromart_auth: $(grep totp "$W/log")"
[ "$(val AI_WEB_RETURN_URL)" = "https://ai.hydromart-digital.com/masuk/callback" ] &&
  ok "AI_WEB_RETURN_URL is the compose file's AI_WEB_URL plus /masuk/callback" || bad "AI_WEB_RETURN_URL is '$(val AI_WEB_RETURN_URL)'"
grep -qx 'AI_TOKEN_SIGNING_KEY=' "$BOX/.env" && [ "$(grep -c '^AI_TOKEN_SIGNING_KEY=' "$BOX/.env")" = 1 ] &&
  ok "a blank AI_TOKEN_SIGNING_KEY (the kill switch) is left blank" || bad "the kill switch was filled in"
[ "$(val AIWEB_DB_APP_PASSWORD)" = already-here ] && [ "$(val POSTGRES_PASSWORD)" = keep-me ] &&
  ok "present values are left exactly as they were" || bad "a present value was changed"
grep -q '^HIJACK=' "$BOX/.env" && bad "applied an inherited ENV_SET_BLOCK instead of its own block" ||
  ok "an inherited ENV_SET_BLOCK is not applied"
leaked=''
for k in AIWEB_POSTGRES_PASSWORD AIWEB_DB_OWNER_PASSWORD TOTP_ENCRYPTION_KEY; do
  v="$(val "$k")"
  [ -n "$v" ] && printf '%s' "$OUT" | grep -qF "$v" && leaked="$leaked $k"
done
[ -z "$leaked" ] && ok "prints key names, never a value" || bad "printed the value of:$leaked"
cp "$BOX/.env" "$W/before"
secrets
cmp -s "$BOX/.env" "$W/before" && printf '%s' "$OUT" | grep -q 'nothing missing' &&
  ok "a second run writes nothing" || bad "a second run changed .env: $OUT"
grep -q totp_credentials "$W/log" && bad "counted sealed secrets although TOTP_ENCRYPTION_KEY is present" ||
  ok "a present TOTP_ENCRYPTION_KEY asks the database nothing"

# Sealed secrets with their key gone, or a count that cannot be read: a new key would be data
# loss, so NOTHING is written (not the other absent keys either) and the run fails with `!!`.
sed -i -e '/^TOTP_ENCRYPTION_KEY=/d' -e '/^AIWEB_DB_OWNER_PASSWORD=/d' "$BOX/.env"
cp "$BOX/.env" "$W/before"
totp_refused() { # <label> <words> <env...>
  local label="$1" words="$2"
  shift 2
  secrets "$@"
  if [ "$RC" != 0 ] && cmp -s "$BOX/.env" "$W/before" && printf '%s' "$OUT" | grep -qF '!! TOTP_ENCRYPTION_KEY not made' &&
    printf '%s' "$OUT" | grep -qF "$words"; then
    ok "TOTP: $label: nothing written, '!!' names the key, exit $RC"
  else
    bad "TOTP: $label: exit $RC, .env $(cmp -s "$BOX/.env" "$W/before" && echo unchanged || echo CHANGED): $OUT"
  fi
}
totp_refused "3 sealed secrets" 'holds 3 sealed' FAKE_TOTP_COUNT=3
totp_refused "the count query fails" 'could not count' FAKE_TOTP_FAIL=1
totp_refused "an answer that is not a number" 'could not count' FAKE_TOTP_COUNT=ERROR
secrets FAKE_TOTP_COUNT=0
[ "$RC" = 0 ] && [ -n "$(val TOTP_ENCRYPTION_KEY)" ] && [ -n "$(val AIWEB_DB_OWNER_PASSWORD)" ] &&
  ok "TOTP: zero sealed secrets again: the key and the other absent key are made" || bad "TOTP: zero rows did not make the key ($RC): $OUT"

# Absent signing key: made, and readable the way auth-service reads it (parseSigningKey).
sed -i '/^AI_TOKEN_SIGNING_KEY=/d' "$BOX/.env"
secrets
if K="$(val AI_TOKEN_SIGNING_KEY)" node -e '
  const { createPrivateKey } = require("crypto");
  const key = createPrivateKey({ key: Buffer.from(process.env.K, "base64"), format: "der", type: "pkcs8" });
  process.exit(key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails.namedCurve === "prime256v1" ? 0 : 1);
' 2>/dev/null; then
  ok "an absent AI_TOKEN_SIGNING_KEY is made: one line, PKCS8 DER, EC P-256"
else
  bad "the AI_TOKEN_SIGNING_KEY it made is not what auth-service accepts"
fi

# The signing key's check: a failure says WHY, and writes nothing.
sed -i '/^AI_TOKEN_SIGNING_KEY=/d' "$BOX/.env"
cp "$BOX/.env" "$W/before"
mkdir -p "$W/badnode"
printf '#!/usr/bin/env bash\necho ERR_FAKE_PARSER_CAUSE\nexit 1\n' > "$W/badnode/node"
chmod +x "$W/badnode/node"
OUT="$(cd "$BOX" && env "${FAKE_ENV[@]}" PATH="$W/badnode:$BIN:$PATH" bash scripts/aiweb-secrets.sh 2>&1)"
RC=$?
[ "$RC" != 0 ] && cmp -s "$BOX/.env" "$W/before" && printf '%s' "$OUT" | grep -qF 'ERR_FAKE_PARSER_CAUSE' &&
  ok "a key the parser refuses: its reason is printed, nothing written" || bad "parser refusal hid its cause ($RC): $OUT"
OUT="$(cd "$BOX" && env "${FAKE_ENV[@]}" AIWEB_NODE="$W/no-such-node" PATH="$BIN:$PATH" bash scripts/aiweb-secrets.sh 2>&1)"
RC=$?
[ "$RC" != 0 ] && cmp -s "$BOX/.env" "$W/before" && printf '%s' "$OUT" | grep -qF 'has no node' &&
  ok "no node on the host: says so, nothing written" || bad "no node: ($RC) $OUT"

# Nothing written on a failure: a compose file without an https AI_WEB_URL.
sed -i '/^AI_WEB_RETURN_URL=/d' "$BOX/.env"
sed -i 's|AI_WEB_URL: https://|AI_WEB_URL: http://|' "$BOX/infra/aiweb/docker-compose.yml"
cp "$BOX/.env" "$W/before"
secrets
[ "$RC" != 0 ] && cmp -s "$BOX/.env" "$W/before" && ok "refuses an http AI_WEB_URL and writes nothing" ||
  bad "an http AI_WEB_URL: exit $RC, .env $(cmp -s "$BOX/.env" "$W/before" && echo unchanged || echo CHANGED)"

# -------------------------------------------------------------- 3. the deploy, fake docker
echo "deploy (aiweb-deploy.sh, fake docker):"
T="$W/deploy"
mkdir -p "$T/scripts/lib" "$T/infra/aiweb"
cp scripts/aiweb-deploy.sh "$T/scripts/"
cp scripts/lib/deploy-common.sh scripts/lib/tcp-reach.cjs "$T/scripts/lib/"
cp infra/aiweb/docker-compose.yml infra/aiweb/roles.sql infra/aiweb/app-role.sql "$T/infra/aiweb/"
GOOD_ENV='AIWEB_POSTGRES_PASSWORD=p1
AIWEB_DB_OWNER_PASSWORD=p2
AIWEB_DB_APP_PASSWORD=p3
ALERT_WEBHOOK_URL=https://alert.invalid/hook'
IMAGES="$(sed -n 's/^ *image: *//p' infra/aiweb/docker-compose.yml | tr '\n' ' ')"

# deploy <env assignments...>: one run on a fresh box; exit code in $RC, output in $W/out.
deploy() {
  rm -rf "$T/.deploy"
  printf '%s\n' "${ENV_FILE:-$GOOD_ENV}" > "$T/.env"
  reset_fakes
  (cd "$T" && env "${FAKE_ENV[@]}" FAKE_PRESENT="$IMAGES" "$@" ${RUNNER:-} bash scripts/aiweb-deploy.sh) > "$W/out" 2>&1
  RC=$?
}
said() { grep -qF -- "$1" "$W/out"; }
called() { grep -qE -- "$1" "$W/log"; }
alerted() { grep -qF -- "$1" "$W/alerts"; }
line_of() { grep -nE -- "$1" "$W/log" | head -1 | cut -d: -f1; }

deploy
if [ "$RC" = 0 ] && said 'AI web OK'; then ok "a clean box deploys and proves isolation (exit 0)"; else
  bad "the happy path failed ($RC): $(tail -4 "$W/out" | tr '\n' ' ')"; fi
db="$(line_of ' up .* db$')"
roles="$(line_of '^psql-file roles$')"
mig="$(line_of ' run .*migrate')"
approle="$(line_of '^psql-file app-role$')"
app="$(line_of ' up .*--remove-orphans')"
[ -n "$db" ] && [ -n "$roles" ] && [ -n "$mig" ] && [ -n "$approle" ] && [ -n "$app" ] &&
  [ "$db" -lt "$roles" ] && [ "$roles" -lt "$mig" ] && [ "$mig" -lt "$approle" ] && [ "$approle" -lt "$app" ] &&
  ok "order: database, roles, migration as the owner, ai_app's password, then the app" ||
  bad "wrong order: db=$db roles=$roles migrate=$mig app-role=$approle app=$app"
if grep '^compose' "$W/log" | grep -qv 'infra/aiweb/docker-compose.yml' || grep -qE 'docker-compose\.(prod\.)?yml( |$)' <(grep '^compose' "$W/log" | sed 's|infra/aiweb/docker-compose.yml||g'); then
  bad "a compose call names something other than infra/aiweb/docker-compose.yml: $(grep '^compose' "$W/log" | grep -v 'infra/aiweb' | head -1)"
else
  ok "every compose call names infra/aiweb/docker-compose.yml and nothing of hydromart's"
fi
called '^(login|pull)' && bad "logged in or pulled although every image was present" || ok "nothing pulled when every image is present"
[ -s "$W/alerts" ] && bad "alerted on a clean deploy" || ok "no alert on a clean deploy"

# The probe: every address of every hydromart container on every exposed TCP port.
missed=''
for t in 172.18.0.4:5432 172.18.0.9:8080 172.18.0.30:80 172.18.0.30:443 172.18.0.30:2019 \
  172.19.0.2:80 172.19.0.2:443 172.19.0.2:2019 172.19.0.1:5432 172.19.0.1:8080 postgres:5432 gateway:8080; do
  grep -qx "$t" "$W/asked" || missed="$missed $t"
done
[ -z "$missed" ] && ok "the probe tries each container's every address and TCP port, the names and the host's ports" ||
  bad "the probe did not try:$missed"
grep -qE '^172\.19\.0\.1:(80|443)$' "$W/asked" && bad "the probe tried Caddy's public ports on the host as a way in" ||
  ok "the host's 80/443 (Caddy's public front) are not counted as a way into hydromart"
grep -q ':443$' "$W/asked" && ! grep -qE '/udp|443/udp' "$W/asked" && ok "UDP ports are not tried as TCP" || bad "a UDP port reached the TCP probe"
said 'hydromart-postgres@hydromart_default 172.18.0.4:5432 timeout/CODE-x -> isolated' &&
  ok "a timeout is isolation, and every target is printed with its outcome" || bad "a timeout was not printed as isolated"
said 'hydromart-scheduler-1 exposes no TCP port' && ok "a container with no TCP port is said, not skipped in silence" ||
  bad "the port-less container went unmentioned"
said 'host-ssh 172.19.0.1:22 open/CODE-x -> reachable (informational)' && said 'cloud-metadata 169.254.169.254:80 timeout/CODE-x -> not reachable (informational)' &&
  ok "the host's ssh and the metadata address are printed, informational, and fail nothing" || bad "host ssh / metadata lines missing"
said 'service-name postgres:5432 not-found/CODE-x -> does not resolve (informational)' && ! said 'probe: 0 hydromart' &&
  ok "a name that does not resolve is informational, never counted as isolated" || bad "not-found was not reported as informational"

deploy FAKE_HM="pg1 gw1 web1 caddy1 sched1"
n172="$(grep -c '^172\.18\.' "$W/asked")"
[ "$RC" = 0 ] && [ "$n172" = 7 ] && grep -qx 172.18.0.29:3000 "$W/asked" && grep -qx 172.18.0.29:3001 "$W/asked" &&
  ok "5 containers (one with two ports, one with none, Caddy on two networks): 7 hydromart-network attempts" ||
  bad "expected 7 attempts on hydromart's network, got $n172 ($RC)"

# The registry: token on stdin, a throwaway config, gone afterwards, and in no child's environment.
deploy FAKE_PRESENT= GHCR_TOKEN=fake-tok1 GHCR_USER=bot
[ "$RC" = 0 ] && [ "$(grep -c '^pull --quiet .*@sha256:' "$W/log")" = 3 ] &&
  ok "missing images are pulled by digest" || bad "pull path ($RC): $(grep -E '^(login|pull)' "$W/log" | tr '\n' ' ')"
[ "$(cat "$W/stdin")" = fake-tok1 ] && ! grep -qF fake-tok1 "$W/log" "$W/out" &&
  ok "the token reaches docker login on stdin, never as an argument or in the log" || bad "the token leaked into an argument or the log"
if grep -qE '^(GHCR_TOKEN|GHCR_USER)=' "$W/envs" || grep -qF fake-tok1 "$W/envs"; then
  bad "a child (docker, compose, curl) inherited the registry token in its environment"
elif [ "$(grep -c '^--- ' "$W/envs")" -gt 10 ]; then
  ok "no child's environment holds the token: $(grep -c '^--- ' "$W/envs") docker and curl calls looked at"
else
  bad "too few child environments recorded to tell: $(grep -c '^--- ' "$W/envs")"
fi
cfgs="$(sort -u "$W/cfgs")"
if [ "$(printf '%s\n' "$cfgs" | grep -c .)" = 1 ] && [ ! -e "$cfgs" ] && called '^logout ghcr.io'; then
  ok "one throwaway docker config for login and pulls, logged out and deleted afterwards"
else
  bad "docker config not throwaway: '$cfgs' (exists: $([ -e "$cfgs" ] && echo yes || echo no))"
fi

deploy FAKE_PRESENT=
[ "$RC" = 1 ] && ! called '^(login|pull)' && ! called ' up ' && alerted 'no registry token' &&
  ok "no token and an image missing: stops before anything starts, and alerts" || bad "no-token path ($RC)"

deploy FAKE_PRESENT= GHCR_TOKEN=t FAKE_PULL_RC=1
[ "$RC" = 1 ] && ! called ' up ' && alerted 'could not pull' && [ ! -e "$(head -1 "$W/cfgs")" ] &&
  ok "a refused pull: nothing started, config deleted, alert" || bad "refused-pull path ($RC): $(tail -2 "$W/out" | tr '\n' ' ')"

deploy FAKE_PRESENT= GHCR_TOKEN=t FAKE_LOGIN_RC=1
[ "$RC" = 1 ] && ! called '^pull' && ! called ' up ' && alerted 'refused the deploy job' &&
  ok "a refused login: no pull, nothing started, alert" || bad "refused-login path ($RC)"

ENV_FILE='AIWEB_POSTGRES_PASSWORD=p1
AIWEB_DB_OWNER_PASSWORD=
AIWEB_DB_APP_PASSWORD=""
ALERT_WEBHOOK_URL=https://alert.invalid/hook' deploy
[ "$RC" = 1 ] && ! called '^compose' && said 'no value in .env for: AIWEB_DB_OWNER_PASSWORD AIWEB_DB_APP_PASSWORD' &&
  ok "a blank or quoted-empty password (=\"\"): named, nothing touched" || bad "missing-secret path ($RC): $(tail -2 "$W/out" | tr '\n' ' ')"

deploy FAKE_ROLES_RC=3
[ "$RC" = 1 ] && ! called ' run ' && ! called '^psql-file app-role' && ! called '\-\-remove-orphans' && alerted 'roles.sql' &&
  ok "roles.sql failing: no migration, no ai_app password, no app" || bad "roles path ($RC)"

deploy FAKE_MIGRATE_RC=1
[ "$RC" = 1 ] && ! called '^psql-file app-role' && ! called '\-\-remove-orphans' && alerted 'migration job failed' &&
  ok "a failed migration: ai_app's password untouched, the running app untouched, alert" || bad "migration path ($RC)"

deploy AIWEB_MIGRATE_TIMEOUT=2 FAKE_MIGRATE_HANG=1
[ "$RC" = 1 ] && called '^rm -f mig1' && ! called '^psql-file app-role' && ! called '\-\-remove-orphans' &&
  alerted 'ran past 2s' &&
  ok "a hung migration: stopped at its timeout, its container removed, nothing after it runs" ||
  bad "hung-migration path ($RC): $(grep -E '^(rm|ps -aq)' "$W/log" | tr '\n' ' ') $(tail -2 "$W/out" | tr '\n' ' ')"

deploy FAKE_APPROLE_RC=3
[ "$RC" = 1 ] && ! called '\-\-remove-orphans' && alerted 'app-role.sql' &&
  ok "app-role.sql failing: the app is not swapped" || bad "app-role path ($RC)"

deploy FAKE_APP_RC=1
[ "$RC" = 1 ] && alerted 'did not become healthy' && said "the app's last line" &&
  ok "an unhealthy app: its last log lines, an alert" || bad "unhealthy path ($RC)"

# Stopped from outside (deploy.sh's timeout): still one alert, still logged out.
RUNNER="timeout 4" deploy FAKE_PRESENT= GHCR_TOKEN=t FAKE_PULL_HANG=1
[ "$RC" != 0 ] && alerted 'stopped by a signal' && [ -s "$W/cfgs" ] && [ ! -e "$(head -1 "$W/cfgs")" ] &&
  called '^ps -aq .*service=migrate' &&
  ok "stopped by a timeout: alerts, deletes the registry login, clears any migration job left running" ||
  bad "a stopped run ($RC) did not alert or left its docker config: $(tail -2 "$W/out" | tr '\n' ' ')"

probe_fails() { # <label> <words the output and the alert must carry> <env...>
  local label="$1" words="$2"
  shift 2
  deploy "$@"
  [ "$RC" = 1 ] && said "$words" && alerted "$words" && ok "probe: $label" ||
    bad "probe did not fail on: $label ($RC) $(grep -F '!!' "$W/out" | head -2 | tr '\n' ' ')"
}
probe_fails "a refused connection to a hydromart address (an RST: the packets get there)" \
  'reaches hydromart-postgres@hydromart_default at 172.18.0.4:5432 (refused)' FAKE_OUTCOMES=172.18.0.4:5432=refused
probe_fails "an open hydromart address" 'reaches hydromart-gateway-1@hydromart_default at 172.18.0.9:8080 (open)' \
  FAKE_OUTCOMES=172.18.0.9:8080=open
probe_fails "Caddy's address on hydromart's own network" 'reaches hydromart-caddy-1@hydromart_default at 172.18.0.30:443 (refused)' \
  FAKE_OUTCOMES=172.18.0.30:443=refused
probe_fails "Caddy's admin port open on edge" 'reaches hydromart-caddy-1@edge at 172.19.0.2:2019 (open)' \
  FAKE_OUTCOMES=172.19.0.2:2019=open
probe_fails "a name that resolves and answers" 'reaches service-name at postgres:5432 (open)' FAKE_OUTCOMES=postgres:5432=open
probe_fails "a host port published wide (PUBLIC_BIND)" 'reaches host at 172.19.0.1:3000 (open)' \
  FAKE_PORTS=0.0.0.0:3000-\>3000/tcp FAKE_OUTCOMES=172.19.0.1:3000=open
probe_fails "an outcome it cannot classify" 'no usable answer for hydromart-postgres@hydromart_default at 172.18.0.4:5432' \
  FAKE_OUTCOMES=172.18.0.4:5432=error
probe_fails "blind: cannot even open its own database" 'could not open its own database' FAKE_DB_CLOSED=1
probe_fails "no hydromart container found: nothing tried is not isolation" 'no running container of project hydromart' FAKE_HM=
probe_fails "attached to hydromart's network" 'attached to network hydromart_default' FAKE_EXTRA_NET=hydromart_default
probe_fails "a host port published" 'publishes a host port' FAKE_BIND=3000/tcp
probe_fails "another hydromart container on edge" 'hydromart/gateway(gw1) is on the edge network' FAKE_EDGE_EXTRA=gw1
probe_fails "ai_app may rewrite its records" 'must hold exactly INSERT,SELECT on answer_trail' \
  "FAKE_GRANTS=answer_trail:DELETE,INSERT,SELECT,UPDATE
kill_switch_events:INSERT,SELECT"
probe_fails "Caddy cannot reach it" 'Caddy cannot reach aiweb:3000' FAKE_FRONT_RC=1
probe_fails "the public URL is down" 'answered 502' FAKE_PUBLIC=502
probe_fails "the sign-in path is cut" 'cannot fetch' FAKE_JWKS_FAIL=1

deploy FAKE_OUTCOMES='172.18.0.4:5432=unreachable 172.19.0.1:5432=timeout 172.19.0.2:2019=timeout 172.19.0.1:22=timeout 169.254.169.254:80=open'
[ "$RC" = 0 ] && said '172.18.0.4:5432 unreachable/CODE-x -> isolated' &&
  ok "no route (unreachable) is isolation too; informational lines never fail the probe" || bad "unreachable or an informational line failed the probe ($RC)"

# The alert's JSON survives a quote, a backslash and anything else a reason can carry.
deploy FAKE_OUTCOMES=172.18.0.4:5432=error 'FAKE_CODE=Q"B\S'
if [ "$RC" = 1 ] && [ -s "$W/alerts" ] && node -e '
  const lines = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n");
  for (const line of lines) { const text = JSON.parse(line).text; if (!text.includes("CODE-QBS")) process.exit(1); }
' "$W/alerts" 2>/dev/null; then
  ok "an alert whose reason carries a quote and a backslash is still valid JSON"
else
  bad "the alert body is not valid JSON once a reason carries a quote or a backslash: $(head -c 300 "$W/alerts")"
fi

# A failure is remembered (alert_once) and a clean deploy forgets it.
deploy FAKE_MIGRATE_RC=1
(cd "$T" && env "${FAKE_ENV[@]}" FAKE_PRESENT="$IMAGES" bash scripts/aiweb-deploy.sh >/dev/null 2>&1)
[ ! -e "$T/.deploy/alerted/aiweb" ] && ok "a clean deploy clears the remembered alert" || bad "the alert memory survived a clean deploy"

# ------------------------------------------------------------- 4. deploy.sh and deploy.yml
echo "wiring (deploy.sh, deploy.yml):"
n() { grep -nF -- "$1" scripts/deploy.sh | head -1 | cut -d: -f1; }
reset="$(grep -nxF 'git reset --hard "$NEW_SHA"' scripts/deploy.sh | head -1 | cut -d: -f1)"
secrets_at="$(n 'if bash scripts/aiweb-secrets.sh; then')"
converge="$(grep -nx 'converge' scripts/deploy.sh | head -1 | cut -d: -f1)"
[ -n "$reset" ] && [ -n "$secrets_at" ] && [ -n "$converge" ] && [ "$reset" -lt "$secrets_at" ] && [ "$secrets_at" -lt "$converge" ] &&
  ok "deploy.sh makes the keys after its reset and before the converge that recreates auth" ||
  bad "deploy.sh must run aiweb-secrets.sh (inside an if) between the reset ($reset) and the converge ($converge), got: $secrets_at"
deployed="$(n 'log "DEPLOY OK')"
aiweb="$(n 'bash scripts/aiweb-deploy.sh')"
rollback="$(grep -n 'auto-rolling back' scripts/deploy.sh | tail -1 | cut -d: -f1)"
[ -n "$aiweb" ] && [ "$deployed" -lt "$aiweb" ] && [ "$aiweb" -lt "$rollback" ] &&
  sed -n "${aiweb}p" scripts/deploy.sh | grep -qE 'bash scripts/aiweb-deploy\.sh \|\|' &&
  ok "deploy.sh runs the AI web after DEPLOY OK, inside the healthy branch, behind ||" ||
  bad "deploy.sh must run aiweb-deploy.sh after DEPLOY OK ($deployed) and before the rollback branch ($rollback), ending in ||"
sed -n "${aiweb}p" scripts/deploy.sh | grep -qE '(^|[[:space:]])timeout (--kill-after=[0-9]+ )?1800 bash scripts/aiweb-deploy\.sh' &&
  ok "deploy.sh stops the AI web step after 30 minutes (timeout 1800)" ||
  bad "deploy.sh must run aiweb-deploy.sh under timeout 1800: $(sed -n "${aiweb}p" scripts/deploy.sh)"
sed -n "${aiweb},\$p" scripts/deploy.sh | head -12 | grep -qF 'if [ "$AIWEB_RC" = 137 ]; then' &&
  sed -n "${aiweb},\$p" scripts/deploy.sh | head -12 | grep -qE '^[[:space:]]+alert_once aiweb ' &&
  ok "deploy.sh alerts when the step had to be KILLed (137), the one case the script cannot report" ||
  bad "deploy.sh must alert_once aiweb when timeout KILLs the step (exit 137)"
unset_at="$(grep -nx 'unset GHCR_TOKEN GHCR_USER' scripts/deploy.sh | cut -d: -f1)"
first_child="$(grep -nE '^[^#]*bash scripts/' scripts/deploy.sh | head -1 | cut -d: -f1)"
[ -n "$unset_at" ] && [ "$unset_at" -lt "$first_child" ] &&
  ok "deploy.sh takes the registry token out of its environment before any child starts" ||
  bad "deploy.sh must unset GHCR_TOKEN before its first child script (line $first_child)"
first_cmd="$(grep -nvE '^[[:space:]]*(#|$)' scripts/aiweb-deploy.sh | head -4 | cut -d: -f2- | tr '\n' ';')"
case "$first_cmd" in
  'ghcr_token="${GHCR_TOKEN:-}";ghcr_user="${GHCR_USER:-}";unset GHCR_TOKEN GHCR_USER;export -n ghcr_token ghcr_user;')
    ok "aiweb-deploy.sh takes the token out of its environment before its first command" ;;
  *) bad "aiweb-deploy.sh must open with the token capture and unset, got: $first_cmd" ;;
esac
if node -e '
  const yaml = require("js-yaml");
  const job = yaml.load(require("fs").readFileSync(".github/workflows/deploy.yml", "utf8")).jobs.deploy;
  const ssh = job.steps.find((s) => String(s.uses || "").startsWith("appleboy/ssh-action"));
  const ok = job.permissions.packages === "read" && /\bGHCR_TOKEN\b/.test(ssh.with.envs) &&
    /github\.token/.test(ssh.env.GHCR_TOKEN) && /workflow_run/.test(ssh.env.GHCR_TOKEN);
  process.exit(ok ? 0 : 1);
'; then
  ok "deploy.yml: packages: read, and the job token handed to the box for deploys only"
else
  bad "deploy.yml must grant packages: read and pass GHCR_TOKEN (the job token) to the SSH step"
fi

if [ "$fails" -gt 0 ]; then
  echo "aiweb: $fails check(s) failed" >&2
  exit 1
fi
echo "aiweb: all checks passed"
