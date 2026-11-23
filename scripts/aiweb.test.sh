#!/usr/bin/env bash
# HD-9 — the AI web's stack on the production box, proved without the box:
#
#   1. scripts/check-aiweb-compose.mjs refuses every edit that undoes the isolation, and passes
#      the committed files (a check that cannot go red, or cannot go green, proves nothing);
#   2. scripts/aiweb-secrets.sh writes only the keys whose line is absent, in the formats
#      auth-service accepts at boot, prints no value, and never applies an inherited
#      ENV_SET_BLOCK (deploy.yml hands its SSH step that secret in every mode);
#   3. scripts/aiweb-deploy.sh, against a fake docker: never names hydromart's compose files,
#      logs in with the token on stdin inside a throwaway config that is gone afterwards, stops
#      before the app on a failed pull, roles file or migration, and calls a breach, a blind
#      probe or wrong privileges a failure, with an alert;
#   4. deploy.sh runs the key maker before its converge and the AI web after DEPLOY OK, where
#      it cannot fail the deploy, and deploy.yml hands over a token that can read packages.
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
# A present line stays as it is, blank included: blank AI_TOKEN_SIGNING_KEY is the kill switch.
printf 'POSTGRES_PASSWORD=keep-me\nAI_TOKEN_SIGNING_KEY=\nAIWEB_DB_APP_PASSWORD=already-here\n' > "$BOX/.env"
OUT="$(cd "$BOX" && ENV_SET_BLOCK='HIJACK=1' bash scripts/aiweb-secrets.sh 2>&1)"
RC=$?
val() { sed -n "s/^$1=//p" "$BOX/.env" | tail -1; }
[ "$RC" = 0 ] && ok "fills the absent keys (exit 0)" || bad "exited $RC: $OUT"
for k in AIWEB_POSTGRES_PASSWORD AIWEB_DB_OWNER_PASSWORD; do
  [[ "$(val "$k")" =~ ^[0-9a-f]{64}$ ]] && ok "$k: 64 hex characters" || bad "$k is not 64 hex characters"
done
[[ "$(val TOTP_ENCRYPTION_KEY)" =~ ^[A-Za-z0-9+/]{43}=$ ]] &&
  ok "TOTP_ENCRYPTION_KEY: 32 bytes of base64, the form auth-service accepts" || bad "TOTP_ENCRYPTION_KEY has the wrong form"
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
OUT2="$(cd "$BOX" && bash scripts/aiweb-secrets.sh 2>&1)"
cmp -s "$BOX/.env" "$W/before" && printf '%s' "$OUT2" | grep -q 'nothing missing' &&
  ok "a second run writes nothing" || bad "a second run changed .env: $OUT2"

# Absent signing key: made, and readable the way auth-service reads it (parseSigningKey).
sed -i '/^AI_TOKEN_SIGNING_KEY=/d' "$BOX/.env"
(cd "$BOX" && bash scripts/aiweb-secrets.sh >/dev/null 2>&1)
if K="$(val AI_TOKEN_SIGNING_KEY)" node -e '
  const { createPrivateKey } = require("crypto");
  const key = createPrivateKey({ key: Buffer.from(process.env.K, "base64"), format: "der", type: "pkcs8" });
  process.exit(key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails.namedCurve === "prime256v1" ? 0 : 1);
' 2>/dev/null; then
  ok "an absent AI_TOKEN_SIGNING_KEY is made: one line, PKCS8 DER, EC P-256"
else
  bad "the AI_TOKEN_SIGNING_KEY it made is not what auth-service accepts"
fi

# Nothing written on a failure: a compose file without an https AI_WEB_URL.
sed -i '/^AI_WEB_RETURN_URL=/d' "$BOX/.env"
sed -i 's|AI_WEB_URL: https://|AI_WEB_URL: http://|' "$BOX/infra/aiweb/docker-compose.yml"
cp "$BOX/.env" "$W/before"
(cd "$BOX" && bash scripts/aiweb-secrets.sh >/dev/null 2>&1) && bad "accepted an http AI_WEB_URL" ||
  { cmp -s "$BOX/.env" "$W/before" && ok "refuses an http AI_WEB_URL and writes nothing" || bad "refused, but wrote to .env"; }

# -------------------------------------------------------------- 3. the deploy, fake docker
echo "deploy (aiweb-deploy.sh, fake docker):"
T="$W/deploy"
BIN="$W/bin"
mkdir -p "$T/scripts/lib" "$T/infra/aiweb" "$BIN"
cp scripts/aiweb-deploy.sh "$T/scripts/"
cp scripts/lib/deploy-common.sh scripts/lib/tcp-reach.cjs "$T/scripts/lib/"
cp infra/aiweb/docker-compose.yml infra/aiweb/roles.sql "$T/infra/aiweb/"
GOOD_ENV='AIWEB_POSTGRES_PASSWORD=p1
AIWEB_DB_OWNER_PASSWORD=p2
AIWEB_DB_APP_PASSWORD=p3
ALERT_WEBHOOK_URL=https://alert.invalid/hook'
IMAGES="$(sed -n 's/^ *image: *//p' infra/aiweb/docker-compose.yml | tr '\n' ' ')"

cat > "$BIN/docker" <<'EOF'
#!/usr/bin/env bash
# Fake docker: logs every call to $FAKE_LOG and answers from FAKE_* variables. One box: the AI
# web's app1 and db1; hydromart's caddy1, pg1 and gw1.
printf '%s\n' "$*" >> "$FAKE_LOG"
args=" $* "
if [ "$1" = compose ]; then
  case "$args" in
    *" config --images "*) sed -n 's/^ *image: *//p' infra/aiweb/docker-compose.yml ;;
    *" psql "*" -f - "*) cat >/dev/null; exit "${FAKE_ROLES_RC:-0}" ;;
    *" psql "*)
      if [ -n "${FAKE_GRANTS:-}" ]; then printf '%s\n' "$FAKE_GRANTS"; else
        printf '%s\n' answer_trail:INSERT,SELECT kill_switch_events:INSERT,SELECT kill_switches:DELETE,INSERT,SELECT,UPDATE
      fi ;;
    *" run "*" migrate "*) exit "${FAKE_MIGRATE_RC:-0}" ;;
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
  pull) echo "$DOCKER_CONFIG" >> "$FAKE_CFGS"; exit "${FAKE_PULL_RC:-0}" ;;
  logout) exit 0 ;;
  network)
    case "$args" in
      *IPAM*) echo "172.19.0.1 " ;;
      *Containers*) echo "caddy1 app1 ${FAKE_EDGE_EXTRA:-}" ;;
    esac ;;
  ps)
    case "$args" in
      *project=hydromart-ai*) printf '%s\n' app1 db1 ;;
      *service=postgres*) echo pg1 ;;
      *service=gateway*) echo gw1 ;;
      *service=caddy*) echo caddy1 ;;
      *Ports*)
        printf '%s\n' '127.0.0.1:5432->5432/tcp' '127.0.0.1:8080->8080/tcp' \
          '0.0.0.0:80->80/tcp, [::]:80->80/tcp, 0.0.0.0:443->443/tcp, [::]:443->443/tcp, 443/udp, 2019/tcp' ${FAKE_PORTS:-} ;;
    esac ;;
  inspect)
    target="${*: -1}"
    case "$args" in
      *PortBindings*)
        case "$target" in
          app1) echo "aiweb|edge hydromart-ai_private ${FAKE_EXTRA_NET:-}|${FAKE_BIND:-}" ;;
          db1) echo "db|hydromart-ai_private |" ;;
        esac ;;
      *IPAddress*) case "$target" in pg1) echo "172.18.0.4 " ;; gw1) echo "172.18.0.9 " ;; esac ;;
      *compose.project*) case "$target" in caddy1) echo hydromart/caddy ;; app1) echo hydromart-ai/aiweb ;; gw1) echo hydromart/gateway ;; esac ;;
    esac ;;
  exec)
    case "$args" in
      *" node - "*)
        cat >/dev/null
        shift 5
        printf '%s\n' "$*" > "$FAKE_ASKED"
        for t in "$@"; do
          case " ${FAKE_OPEN:-} db:5432 " in
            *" $t "*) if [ "$t" = db:5432 ] && [ -n "${FAKE_DB_CLOSED:-}" ]; then echo "closed $t timeout"; else echo "open $t"; fi ;;
            *) echo "closed $t timeout" ;;
          esac
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
case "$*" in */api/health*) printf '%s' "${FAKE_PUBLIC:-200}" ;; esac
exit 0
EOF
printf '#!/usr/bin/env bash\nexit 0\n' > "$BIN/sleep"
chmod +x "$BIN/docker" "$BIN/curl" "$BIN/sleep"

# deploy <env assignments...>: one run on a fresh box; exit code in $RC, output in $W/out.
deploy() {
  rm -rf "$T/.deploy"
  printf '%s\n' "${ENV_FILE:-$GOOD_ENV}" > "$T/.env"
  for f in log curl cfgs stdin asked; do : > "$W/$f"; done
  (cd "$T" && env PATH="$BIN:$PATH" FAKE_LOG="$W/log" FAKE_CURL="$W/curl" FAKE_CFGS="$W/cfgs" \
    FAKE_STDIN="$W/stdin" FAKE_ASKED="$W/asked" FAKE_PRESENT="$IMAGES" "$@" bash scripts/aiweb-deploy.sh) > "$W/out" 2>&1
  RC=$?
}
said() { grep -qF "$1" "$W/out"; }
called() { grep -qE "$1" "$W/log"; }
alerted() { grep -F 'alert.invalid' "$W/curl" | grep -qF "$1"; }
line_of() { grep -nE "$1" "$W/log" | head -1 | cut -d: -f1; }

deploy
if [ "$RC" = 0 ] && said 'AI web OK'; then ok "a clean box deploys and proves isolation (exit 0)"; else
  bad "the happy path failed ($RC): $(tail -4 "$W/out" | tr '\n' ' ')"; fi
db="$(line_of ' up .* db$')"
roles="$(line_of 'psql .* -f -')"
mig="$(line_of ' run .*migrate')"
app="$(line_of ' up .*--remove-orphans')"
[ -n "$db" ] && [ -n "$roles" ] && [ -n "$mig" ] && [ -n "$app" ] &&
  [ "$db" -lt "$roles" ] && [ "$roles" -lt "$mig" ] && [ "$mig" -lt "$app" ] &&
  ok "order: database, roles, migration as the owner, then the app" || bad "wrong order: db=$db roles=$roles migrate=$mig app=$app"
if grep '^compose' "$W/log" | grep -qv 'infra/aiweb/docker-compose.yml' || grep -qE 'docker-compose\.(prod\.)?yml( |$)' <(grep '^compose' "$W/log" | sed 's|infra/aiweb/docker-compose.yml||g'); then
  bad "a compose call names something other than infra/aiweb/docker-compose.yml: $(grep '^compose' "$W/log" | grep -v 'infra/aiweb' | head -1)"
else
  ok "every compose call names infra/aiweb/docker-compose.yml and nothing of hydromart's"
fi
called '^(login|pull)' && bad "logged in or pulled although every image was present" || ok "nothing pulled when every image is present"
grep -q 'alert.invalid' "$W/curl" && bad "alerted on a clean deploy" || ok "no alert on a clean deploy"
ASKED=" $(cat "$W/asked") "
missed=''
for t in 172.18.0.4:5432 172.18.0.9:8080 172.19.0.1:5432 172.19.0.1:8080 postgres:5432 gateway:8080; do
  case "$ASKED" in *" $t "*) ;; *) missed="$missed $t" ;; esac
done
[ -z "$missed" ] && ok "the probe tries hydromart by name, by address, and through the host's published ports" ||
  bad "the probe did not try:$missed (asked:$ASKED)"
case " $ASKED " in
  *" 172.19.0.1:443 "* | *" 172.19.0.1:80 "*) bad "the probe tried Caddy's public ports, which every client may reach: $ASKED" ;;
  *) ok "Caddy's public 80/443 are not counted as a way into hydromart" ;;
esac

# The registry: token on stdin, a throwaway config, gone afterwards.
deploy FAKE_PRESENT= GHCR_TOKEN=tok-SECRET-123 GHCR_USER=bot
[ "$RC" = 0 ] && [ "$(grep -c '^pull --quiet .*@sha256:' "$W/log")" = 3 ] &&
  ok "missing images are pulled by digest" || bad "pull path ($RC): $(grep -E '^(login|pull)' "$W/log" | tr '\n' ' ')"
[ "$(cat "$W/stdin")" = tok-SECRET-123 ] && ! grep -qF tok-SECRET-123 "$W/log" "$W/out" &&
  ok "the token reaches docker login on stdin, never as an argument or in the log" || bad "the token leaked into an argument or the log"
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
ALERT_WEBHOOK_URL=https://alert.invalid/hook' deploy
[ "$RC" = 1 ] && ! called '^compose' && said 'AIWEB_DB_OWNER_PASSWORD AIWEB_DB_APP_PASSWORD' &&
  ok "a missing or blank password: names both, touches nothing" || bad "missing-secret path ($RC): $(tail -2 "$W/out" | tr '\n' ' ')"

deploy FAKE_ROLES_RC=3
[ "$RC" = 1 ] && ! called ' run ' && ! called '\-\-remove-orphans' && alerted 'roles.sql' &&
  ok "roles.sql failing: no migration, no app" || bad "roles path ($RC)"

deploy FAKE_MIGRATE_RC=1
[ "$RC" = 1 ] && ! called '\-\-remove-orphans' && alerted 'migration job failed' &&
  ok "a failed migration leaves the app alone, and alerts" || bad "migration path ($RC)"

deploy FAKE_APP_RC=1
[ "$RC" = 1 ] && alerted 'did not become healthy' && said "the app's last line" &&
  ok "an unhealthy app: its last log lines, an alert" || bad "unhealthy path ($RC)"

probe_fails() { # <label> <words the output and the alert must carry> <env...>
  local label="$1" words="$2"
  shift 2
  deploy "$@"
  [ "$RC" = 1 ] && said "$words" && alerted "$words" && ok "probe: $label" ||
    bad "probe did not fail on: $label ($RC) $(grep -F '!!' "$W/out" | head -2 | tr '\n' ' ')"
}
probe_fails "hydromart's postgres reachable by address" 'can open 172.18.0.4:5432' FAKE_OPEN=172.18.0.4:5432
probe_fails "hydromart's postgres reachable by name" 'can open postgres:5432' FAKE_OPEN=postgres:5432
probe_fails "a host port published wide (PUBLIC_BIND)" 'can open 172.19.0.1:3000' FAKE_PORTS=0.0.0.0:3000-\>3000/tcp FAKE_OPEN=172.19.0.1:3000
probe_fails "blind: cannot even open its own database" 'proves nothing' FAKE_DB_CLOSED=1
probe_fails "attached to hydromart's network" 'attached to network hydromart_default' FAKE_EXTRA_NET=hydromart_default
probe_fails "a host port published" 'publishes a host port' FAKE_BIND=3000/tcp
probe_fails "another hydromart container on edge" 'hydromart/gateway(gw1) is on the edge network' FAKE_EDGE_EXTRA=gw1
probe_fails "ai_app may rewrite its records" 'must hold exactly INSERT,SELECT on answer_trail' \
  "FAKE_GRANTS=answer_trail:DELETE,INSERT,SELECT,UPDATE
kill_switch_events:INSERT,SELECT"
probe_fails "Caddy cannot reach it" 'Caddy cannot reach aiweb:3000' FAKE_FRONT_RC=1
probe_fails "the public URL is down" 'answered 502' FAKE_PUBLIC=502
probe_fails "the sign-in path is cut" 'cannot fetch' FAKE_JWKS_FAIL=1

# A failure is remembered (alert_once) and a clean deploy forgets it.
deploy FAKE_MIGRATE_RC=1
(cd "$T" && env PATH="$BIN:$PATH" FAKE_LOG="$W/log" FAKE_CURL="$W/curl" FAKE_CFGS="$W/cfgs" FAKE_STDIN="$W/stdin" \
  FAKE_ASKED="$W/asked" FAKE_PRESENT="$IMAGES" bash scripts/aiweb-deploy.sh >/dev/null 2>&1)
[ ! -e "$T/.deploy/alerted/aiweb" ] && ok "a clean deploy clears the remembered alert" || bad "the alert memory survived a clean deploy"

# ------------------------------------------------------------- 4. deploy.sh and deploy.yml
echo "wiring (deploy.sh, deploy.yml):"
n() { grep -nF -- "$1" scripts/deploy.sh | head -1 | cut -d: -f1; }
reset="$(grep -nxF 'git reset --hard "$NEW_SHA"' scripts/deploy.sh | head -1 | cut -d: -f1)"
secrets="$(n 'if bash scripts/aiweb-secrets.sh; then')"
converge="$(grep -nx 'converge' scripts/deploy.sh | head -1 | cut -d: -f1)"
[ -n "$reset" ] && [ -n "$secrets" ] && [ -n "$converge" ] && [ "$reset" -lt "$secrets" ] && [ "$secrets" -lt "$converge" ] &&
  ok "deploy.sh makes the keys after its reset and before the converge that recreates auth" ||
  bad "deploy.sh must run aiweb-secrets.sh (inside an if) between the reset ($reset) and the converge ($converge), got: $secrets"
deployed="$(n 'log "DEPLOY OK')"
aiweb="$(n 'bash scripts/aiweb-deploy.sh')"
rollback="$(grep -n 'auto-rolling back' scripts/deploy.sh | tail -1 | cut -d: -f1)"
[ -n "$aiweb" ] && [ "$deployed" -lt "$aiweb" ] && [ "$aiweb" -lt "$rollback" ] &&
  sed -n "${aiweb}p" scripts/deploy.sh | grep -qE '\|\|[[:space:]]*$' &&
  ok "deploy.sh runs the AI web after DEPLOY OK, inside the healthy branch, behind ||" ||
  bad "deploy.sh must run aiweb-deploy.sh after DEPLOY OK ($deployed) and before the rollback branch ($rollback), ending in ||"
unset_at="$(grep -nx 'unset GHCR_TOKEN GHCR_USER' scripts/deploy.sh | cut -d: -f1)"
first_child="$(grep -nE '^[^#]*bash scripts/' scripts/deploy.sh | head -1 | cut -d: -f1)"
[ -n "$unset_at" ] && [ "$unset_at" -lt "$first_child" ] &&
  ok "deploy.sh takes the registry token out of its environment before any child starts" ||
  bad "deploy.sh must unset GHCR_TOKEN before its first child script (line $first_child)"
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
