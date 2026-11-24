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
#   5. AI-5, n8n, through all of the above: its compose exceptions are exact; its keys and its
#      machine account in MACHINE_ACCOUNTS are made, rotated, switched off and repaired without
#      touching another account or writing what auth-service would refuse; its setup runs before
#      ai_app's password and a failure leaves it off; the probe runs from inside it too; and the
#      nightly check (scripts/aiweb-n8n-check.sh) alerts on drift, on a secret near its day and
#      on an n8n account that can sign in without 2FA (D5).
#   6. The host's ssh (the owner's decision of 24 November 2026): scripts/aiweb-firewall.sh, against
#      fake docker, sudo and iptables, drops TCP 22 from the AI web's three bridges and nothing
#      else, adds one INPUT rule and touches no other, writes nothing when nothing changed, follows
#      a network made again, never empties the rules on a docker that does not answer, and says
#      what root access is missing; the deploy runs it before the probe, cron every 5 minutes, and
#      the probe fails when port 22 answers the app or n8n at a gateway or the public address.
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
# The AI web: app1, db1, n8n1 (AI-5; none with FAKE_NO_N8N). Hydromart: pg1, gw1, web1, caddy1 (on
# edge too), sched1 (no port).
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
    *" up --no-start "*) exit "${FAKE_NOSTART_RC:-0}" ;;
    *" psql "*" -f - "*)
      script="$(cat)"
      case "$script" in
        *"CREATE DATABASE"*) echo "psql-file roles" >> "$FAKE_LOG"; exit "${FAKE_ROLES_RC:-0}" ;;
        *"ALTER ROLE ai_app"*) echo "psql-file app-role" >> "$FAKE_LOG"; exit "${FAKE_APPROLE_RC:-0}" ;;
        *) echo "psql-file unknown" >> "$FAKE_LOG"; exit 9 ;;
      esac ;;
    *" psql "*"has_table_privilege"*)
      # What ai_app can do in effect, as the probe asks Postgres: nothing by default.
      printf '%s\n' "${FAKE_EFFECTIVE:-}" ;;
    *" psql "*)
      if [ -n "${FAKE_GRANTS:-}" ]; then printf '%s\n' "$FAKE_GRANTS"; else
        printf '%s\n' answer_trail:INSERT,SELECT hd_events:INSERT,SELECT,UPDATE kill_switch_events:INSERT,SELECT kill_switches:DELETE,INSERT,SELECT,UPDATE
      fi ;;
    *" run "*" migrate "*)
      [ -z "${FAKE_MIGRATE_HANG:-}" ] || exec "$REAL_SLEEP" 30
      exit "${FAKE_MIGRATE_RC:-0}" ;;
    *" run "*" n8n-setup "*)
      echo "[n8n-setup] the fake setup ran" >&2
      [ -z "${FAKE_SETUP_HANG:-}" ] || exec "$REAL_SLEEP" 30
      exit "${FAKE_SETUP_RC:-0}" ;;
    *" up "*" db ") exit "${FAKE_DB_RC:-0}" ;;
    *" up "*) exit "${FAKE_APP_RC:-0}" ;;
    *" ps -q aiweb "*) echo app1 ;;
    *" ps -q n8n "*) [ -n "${FAKE_NO_N8N:-}" ] || echo n8n1 ;;
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
      # Every network, as aiweb-firewall.sh asks for them: the AI web's three, hydromart's, Docker's.
      *" ls "*)
        [ -z "${FAKE_DOCKER_DOWN:-}" ] || { echo 'Cannot connect to the Docker daemon' >&2; exit 1; }
        printf '%s\n' "0d0d0d0d0d0d false bridge " "${FAKE_EDGE_ID:-e0e0e0e0e0e0} false edge hydromart" \
          "b2b2b2b2b2b2 ${FAKE_EGRESS_IPV6:-false} hydromart-ai_egress hydromart-ai" \
          "${FAKE_PRIVATE_ID:-a1a1a1a1a1a1} false hydromart-ai_private hydromart-ai" \
          "c3c3c3c3c3c3 false hydromart_default hydromart" "5e5e5e5e5e5e false host "           ${FAKE_STAGING:+"f4f4f4f4f4f4 false edge-staging hydromart" "a5a5a5a5a5a5 false hydromart-ai-staging_private hydromart-ai-staging" "d6d6d6d6d6d6 false hydromart-ai-staging_tunnel hydromart-ai-staging"} ;;
      *IPAM*)
        case "$args" in
          *" ${FAKE_NO_GW:-no-such-network} "*) exit 1 ;;
          *" edge "*) echo "172.19.0.1 " ;;
          *" hydromart-ai_private "*) echo "172.20.0.1 " ;;
          *" hydromart-ai_egress "*) echo "172.21.0.1 " ;;
          *) echo "172.22.0.1 " ;;
        esac ;;
      *hydromart-ai_egress*) echo "n8n1 ${FAKE_EGRESS_EXTRA:-}" ;;
      *Containers*) echo "caddy1 app1 ${FAKE_EDGE_EXTRA:-}" ;;
    esac ;;
  ps)
    case "$args" in
      *project=hydromart-ai*service=migrate*) [ -z "${FAKE_MIGRATE_HANG:-}" ] || echo mig1 ;;
      *project=hydromart-ai*service=n8n-setup*) [ -z "${FAKE_SETUP_HANG:-}" ] || echo setup1 ;;
      *project=hydromart-ai*service=aiweb*) echo app1 ;;
      *project=hydromart-ai*"service=n8n "*) [ -n "${FAKE_NO_N8N:-}" ] || echo n8n1 ;;
      *project=hydromart-ai*) printf '%s\n' app1 db1 $([ -n "${FAKE_NO_N8N:-}" ] || echo n8n1) ;;
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
          n8n1) echo "n8n|hydromart-ai_private hydromart-ai_egress ${FAKE_N8N_EXTRA_NET:-}|${FAKE_N8N_BIND-127.0.0.1:5678->5678/tcp }" ;;
        esac ;;
      *ExposedPorts*)
        case "$target" in
          pg1) echo "/hydromart-postgres|hydromart_default=172.18.0.4 |5432/tcp " ;;
          gw1) echo "/hydromart-gateway-1|hydromart_default=172.18.0.9 |8080/tcp " ;;
          web1) echo "/hydromart-web-1|hydromart_default=172.18.0.29 |3000/tcp 3001/tcp " ;;
          caddy1) echo "/hydromart-caddy-1|edge=172.19.0.2 hydromart_default=172.18.0.30 |80/tcp 443/tcp 443/udp 2019/tcp " ;;
          sched1) echo "/hydromart-scheduler-1|hydromart_default=172.18.0.3 |" ;;
        esac ;;
      *compose.project*) case "$target" in caddy1) echo hydromart/caddy ;; app1) echo hydromart-ai/aiweb ;; gw1) echo hydromart/gateway ;; n8n1) echo hydromart-ai/n8n ;; esac ;;
    esac ;;
  exec)
    # Which container is asked: app1 or n8n1 (`exec -i <id> ...` or `exec <id> ...`).
    c="$2"
    [ "$c" = -i ] && c="$3"
    case "$args" in
      *" totp_credentials "*)
        if [ -n "${FAKE_TOTP_FAIL:-}" ]; then echo 'psql: error: connection to server failed' >&2; exit 2; fi
        echo "${FAKE_TOTP_COUNT:-0}" ;;
      *" node - "*)
        cat >/dev/null
        shift 5
        asked="$FAKE_ASKED"
        [ "$c" = app1 ] || asked="$FAKE_ASKED.$c"
        printf '%s\n' "$@" > "$asked"
        for t in "$@"; do
          # The box as it is: own database open, names unknown, Caddy's front open, the host's
          # loopback ports refused, every other address dropped. The host's ssh answers, at any
          # address, unless the fake firewall drops it (the chain filled and INPUT jumping to
          # it), as aiweb-firewall.sh leaves it. FAKE_OUTCOMES overrides.
          case "$t" in
            db:5432) o=open ;;
            172.19.0.2:80 | 172.19.0.2:443) o=open ;;
            *:22) if [ -s "$FAKE_FW/AIWEB-NO-SSH" ] && grep -q AIWEB-NO-SSH "$FAKE_FW/INPUT"; then o=timeout; else o=open; fi ;;
            172.19.0.*) o=refused ;;
            [a-z]*) o=not-found ;;
            *) o=timeout ;;
          esac
          [ -n "${FAKE_DB_CLOSED:-}" ] && [ "$t" = db:5432 ] && o=timeout
          for pair in ${FAKE_OUTCOMES:-}; do [ "${pair%%=*}" = "$t" ] && o="${pair#*=}"; done
          if [ "$c" = n8n1 ]; then
            for pair in ${FAKE_N8N_OUTCOMES:-}; do [ "${pair%%=*}" = "$t" ] && o="${pair#*=}"; done
          fi
          echo "$o $t CODE-${FAKE_CODE:-x}"
        done ;;
      *" node -e "*)
        [ -z "${FAKE_JWKS_FAIL:-}" ] || [ "$c" != app1 ] || exit 1
        [ -z "${FAKE_N8N_JWKS_FAIL:-}" ] || [ "$c" != n8n1 ] || exit 1
        echo '{"keys":[{"kid":"k1"}]}' ;;
      *"drift.mjs"*)
        if [ -n "${FAKE_DRIFT_RC:-}" ]; then echo '[n8n-drift] workflow x1 is published in n8n but is not in git' >&2; exit "$FAKE_DRIFT_RC"; fi
        echo '[n8n-drift] none: 2 workflow(s) and 2 credential(s) as git holds them' ;;
      *" wget "*"n8n:5678"*) exit "${FAKE_N8N_HEALTH_RC:-0}" ;;
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
# sudo -n: runs the command, or refuses as sudo does for a user without passwordless sudo. Never
# the real one: the CI runner's sudo is passwordless, and its firewall is not the test's to change.
cat > "$BIN/sudo" <<'EOF'
#!/usr/bin/env bash
[ "$1" = -n ] && shift
[ -z "${FAKE_NO_SUDO:-}" ] || { echo 'sudo: a password is required' >&2; exit 1; }
exec "$@"
EOF
# iptables: the filter table as one file per chain under $FAKE_FW, each line one rule, stored as
# iptables prints it (`-p tcp --dport` comes back `-p tcp -m tcp --dport`), logged with docker's
# calls. Only what aiweb-firewall.sh may use; anything else fails.
cat > "$BIN/iptables" <<'EOF'
#!/usr/bin/env bash
printf 'iptables %s\n' "$*" >> "$FAKE_LOG"
[ "$1" = -w ] && shift
op="$1"
f="$FAKE_FW/${2:-}"
shift
[ "$#" = 0 ] || shift
[ "$op" = -I ] && [ "${1:-}" = 1 ] && shift
spec="$*"
spec="${spec/-p tcp --dport/-p tcp -m tcp --dport}"
case "$op" in
  -S)
    echo '-P INPUT ACCEPT'
    for x in "$FAKE_FW"/*; do [ "${x##*/}" = INPUT ] || echo "-N ${x##*/}"; done
    for x in "$FAKE_FW"/*; do while IFS= read -r r; do echo "-A ${x##*/} $r"; done < "$x"; done ;;
  -N) [ ! -e "$f" ] || { echo 'iptables: Chain already exists.' >&2; exit 1; }; : > "$f" ;;
  -F) [ -e "$f" ] && : > "$f" ;;
  -A) [ -e "$f" ] && echo "$spec" >> "$f" ;;
  -I) [ -e "$f" ] && { echo "$spec"; cat "$f"; } > "$f.new" && mv "$f.new" "$f" ;;
  -C) [ -e "$f" ] && grep -qxF -- "$spec" "$f" ;;
  -D) n="$(grep -nxF -- "$spec" "$f" 2>/dev/null | head -1 | cut -d: -f1)" && [ -n "$n" ] && sed -i "${n}d" "$f" ;;
  *) echo "iptables: the fake does not do $op" >&2; exit 2 ;;
esac
EOF
# flock: taken (logged), or held by another run with FAKE_FLOCK_BUSY.
cat > "$BIN/flock" <<'EOF'
#!/usr/bin/env bash
printf 'flock %s\n' "$*" >> "$FAKE_LOG"
[ -z "${FAKE_FLOCK_BUSY:-}" ]
EOF
chmod +x "$BIN/docker" "$BIN/curl" "$BIN/sleep" "$BIN/sudo" "$BIN/iptables" "$BIN/flock"
mkdir -p "$W/fw"
# What every fake run needs, as `env` arguments. An array: PATH may hold spaces.
FAKE_ENV=("PATH=$BIN:$PATH" "FAKE_LOG=$W/log" "FAKE_ENVS=$W/envs" "FAKE_CURL=$W/curl"
  "FAKE_ALERTS=$W/alerts" "FAKE_CFGS=$W/cfgs" "FAKE_STDIN=$W/stdin" "FAKE_ASKED=$W/asked"
  "FAKE_FW=$W/fw" "REAL_SLEEP=$REAL_SLEEP")
reset_fakes() {
  for f in log envs curl alerts cfgs stdin asked; do : > "$W/$f"; done
  # The box's firewall as a reboot leaves it: a rule of its own in INPUT, Docker's DOCKER-USER.
  rm -f "$W/fw/"*
  printf '%s\n' '-i lo -j ACCEPT' > "$W/fw/INPUT"
  printf '%s\n' '-j RETURN' > "$W/fw/DOCKER-USER"
}

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

# AI-5: n8n's exceptions are exact, and nothing else gets them.
refuses alertdb 'doc.services.db.environment.HOOK = "${ALERT_WEBHOOK_URL:-}"' 'services.db.environment.HOOK reads ALERT_WEBHOOK_URL' \
  "ALERT_WEBHOOK_URL handed to anything but the app"
refuses alert2 'doc.services.aiweb.environment.ALERT_WEBHOOK_URL = "${ALERT_WEBHOOK_URL_2:-}"' 'ALERT_WEBHOOK_URL_2' \
  "another hydromart key that only starts like the allowed one"
refuses hardening 'doc.services.n8n.environment.N8N_SSRF_PROTECTION_ENABLED = "false"' 'sets N8N_SSRF_PROTECTION_ENABLED' \
  "an n8n setting in the compose file, over the image's"
refuses n8nsuper 'doc.services.n8n.environment.DB_POSTGRESDB_USER = "postgres"' 'DB_POSTGRESDB_USER must be n8n' \
  "n8n connecting as the superuser"
refuses n8ndb 'doc.services.n8n.environment.DB_POSTGRESDB_DATABASE = "ai"' 'DB_POSTGRESDB_DATABASE must be n8n' "n8n in the app's database"
refuses setupkey 'doc.services["n8n-setup"].environment.N8N_PUBLIC_API_DISABLED = "false"' 'n8n-setup.environment sets N8N_PUBLIC_API_DISABLED' \
  "an n8n setting handed to the setup job"
refuses setupsecret 'doc.services["n8n-setup"].environment.N8N_SETUP_MACHINE_SECRET = "${AIWEB_N8N_TOKEN:-}"' \
  'N8N_SETUP_MACHINE_SECRET must be ${AIWEB_N8N_MACHINE_SECRET}' "the machine secret read from another key"
refuses n8nport 'doc.services.n8n.ports = ["5678:5678"]' 'may publish one port' "n8n's editor published past loopback"
refuses n8nports 'doc.services.n8n.ports.push("127.0.0.1:5679:5679")' 'may publish one port' "a second n8n port"
refuses n8nedge 'doc.services.n8n.networks.push("edge")' 'must join private and egress, and nothing else' "n8n beside Caddy on edge"
refuses webegress 'doc.services.aiweb.networks.push("egress")' 'only n8n may join egress' "the app on n8n's way out"
refuses egressinternal 'doc.networks.egress = { internal: true }' 'networks.egress must not be internal' "an egress n8n cannot leave by"
refuses egresshydromart 'doc.networks.egress = { external: true, name: "hydromart_default" }' 'networks.egress must be this project' \
  "egress pointed at hydromart's network"
refuses notmpfs 'delete doc.services.n8n.tmpfs' 'must mount /home/node/.n8n as a tmpfs' "n8n writing its key to disk"
refuses opentmpfs 'doc.services.n8n.tmpfs = doc.services.n8n.tmpfs.map((t) => t.replace("mode=0700", "mode=0777"))' 'must mount /home/node/.n8n as a tmpfs' \
  "n8n's key file open to every user"
refuses setuptmpfs 'delete doc.services["n8n-setup"].tmpfs' 'services.n8n-setup must mount /home/node/.n8n' "the setup job writing the key to disk"
refuses n8nvolume 'doc.services.n8n.volumes = ["pgdata:/home/node/.n8n"]' 'nothing of n8n is kept outside its database' "n8n state in a volume"
refuses setupegress 'doc.services["n8n-setup"].networks.push("egress")' 'n8n-setup must join private, and nothing else' "the setup job with a way out"
refuses setupimage 'doc.services["n8n-setup"].image = doc.services.aiweb.image' 'must run the image n8n runs' "a setup from another release"
refuses setupprofile 'delete doc.services["n8n-setup"].profiles' 'own profile' "the setup job started by every up"
refuses non8n 'delete doc.services.n8n' 'no n8n service' "n8n taken out (its rules would hold nothing)"
refuses n8ntag 'doc.services.n8n.image = "ghcr.io/m0gsy/hydromart-ai:latest-n8n"' 'pinned by digest' "n8n by tag"
# Any valid digest passes, whatever the release: the placeholder pinned until hydromart-ai #8 is not
# special, and neither is the one that replaces it.
mutant anydigest 'const d = "ghcr.io/m0gsy/hydromart-ai@sha256:" + "ab12".repeat(16); doc.services.n8n.image = d; doc.services["n8n-setup"].image = d' &&
  node scripts/check-aiweb-compose.mjs "$W/anydigest.yml" >/dev/null 2>&1 &&
  ok "any 64-hex digest for n8n passes (n8n and its setup on the same one)" || bad "a valid n8n digest was refused"

sed 's/import hsts//' infra/caddy/sites/aiweb.caddy > "$W/nohsts.caddy"
node scripts/check-aiweb-compose.mjs infra/aiweb/docker-compose.yml "$W/nohsts.caddy" >/dev/null 2>&1 &&
  bad "accepts a site with no HSTS" || ok "refuses a site with no HSTS"
sed 's/aiweb:3000/gateway:8080/' infra/caddy/sites/aiweb.caddy > "$W/elsewhere.caddy"
node scripts/check-aiweb-compose.mjs infra/aiweb/docker-compose.yml "$W/elsewhere.caddy" >/dev/null 2>&1 &&
  bad "accepts a site that proxies somewhere else" || ok "refuses a site that proxies somewhere else"
# AI-5: n8n's alarm route is the app's alone; the public site must 404 it before the proxy.
sed '/handle \/api\/internal/,/^\t}/d' infra/caddy/sites/aiweb.caddy > "$W/nointernal.caddy"
if grep -q 'handle /api/internal' "$W/nointernal.caddy" || ! grep -q 'reverse_proxy aiweb:3000' "$W/nointernal.caddy"; then
  bad "could not build the site without its /api/internal/* block"
elif out="$(node scripts/check-aiweb-compose.mjs infra/aiweb/docker-compose.yml "$W/nointernal.caddy" 2>&1)"; then
  bad "accepts a site that forwards /api/internal/* to the app"
else
  grep -qF 'must refuse /api/internal/*' <<<"$out" && ok "refuses a site that forwards /api/internal/* to the app" ||
    bad "refused the site without its internal block, but not for that: $out"
fi
grep -qE '^\s*request_body /api/ingress/\* \{' infra/caddy/sites/aiweb.caddy && grep -qE '^\s*max_size 64KB$' infra/caddy/sites/aiweb.caddy &&
  ok "the site caps request bodies on /api/ingress/* at 64 KB" || bad "the ingress body cap is gone from the site"

# --------------------------------------------------------------------- 2. the key maker
echo "key maker (aiweb-secrets.sh):"
BOX="$W/box"
mkdir -p "$BOX/scripts" "$BOX/infra/aiweb" "$BOX/packages/access/src"
cp scripts/aiweb-secrets.sh scripts/env-set.sh "$BOX/scripts/"
cp infra/aiweb/docker-compose.yml "$BOX/infra/aiweb/"
# A release that has n8n's capability (hydromart-digital #1042), in the shape packages/access
# declares CAPABILITIES; the real file is checked below for the same shape.
CAPS="export const CAPABILITIES = {
  dashboard: ['HEAD_OFFICE'],
  franchiseApplicationNotify: ['SUPER_ADMIN'],
} as const satisfies Record<string, readonly Role[]>;"
printf '%s\n' "$CAPS" > "$BOX/packages/access/src/index.ts"
secrets() { # <env assignments...>: one key-maker run on the scratch box; exit code in $RC
  reset_fakes
  OUT="$(cd "$BOX" && env "${FAKE_ENV[@]}" "$@" bash scripts/aiweb-secrets.sh 2>&1)"
  RC=$?
}
val() { sed -n "s/^$1=//p" "$BOX/.env" | tail -1; }
# Another machine account, which every run must leave exactly as it was.
OTHER='{"id":"99999999-8888-4777-8666-555555555555","name":"other-bot","secretSha256":"'"$(printf '%064d' 7)"'","scopes":["dashboard"],"notAfter":"'"$(date -u -d '+40 days' +%FT00:00:00Z)"'","note":"kept"}'

# A present line stays as it is, blank included: blank AI_TOKEN_SIGNING_KEY is the kill switch.
printf 'POSTGRES_PASSWORD=keep-me\nAI_TOKEN_SIGNING_KEY=\nAIWEB_DB_APP_PASSWORD=already-here\nMACHINE_ACCOUNTS=%s\n' "'[$OTHER]'" > "$BOX/.env"
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
# AI-5: n8n's keys, made the same way, and its machine account written for auth-service.
for k in AIWEB_N8N_DB_PASSWORD AIWEB_N8N_ENCRYPTION_KEY AIWEB_N8N_TOKEN AIWEB_N8N_MACHINE_SECRET; do
  [[ "$(val "$k")" =~ ^[0-9a-f]{64}$ ]] && ok "$k: 64 hex characters" || bad "$k is not 64 hex characters"
done
[[ "$(val AIWEB_N8N_MACHINE_ID)" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] &&
  ok "AIWEB_N8N_MACHINE_ID: a lowercase UUID, as auth-service wants" || bad "AIWEB_N8N_MACHINE_ID is '$(val AIWEB_N8N_MACHINE_ID)'"
[ "$(val AIWEB_N8N_MACHINE_NOT_AFTER)" = "$(date -u -d '+89 days' +%F)" ] &&
  ok "the machine secret runs until today + 89 days (UTC)" || bad "AIWEB_N8N_MACHINE_NOT_AFTER is '$(val AIWEB_N8N_MACHINE_NOT_AFTER)'"
# What auth-service checks at boot (external-access.ts parseMachineAccounts), on what was written.
accounts_ok() { # <expected n8n entries> : MACHINE_ACCOUNTS, single-quoted, parses as auth-service does
  MA="$(val MACHINE_ACCOUNTS)" ID="$(val AIWEB_N8N_MACHINE_ID)" SECRET="$(val AIWEB_N8N_MACHINE_SECRET)" \
    NA="$(val AIWEB_N8N_MACHINE_NOT_AFTER)" OTHER="$OTHER" WANT="$1" node -e '
    const e = process.env;
    const q = String.fromCharCode(39);
    if (!e.MA.startsWith(q) || !e.MA.endsWith(q)) throw new Error("not single-quoted");
    const list = JSON.parse(e.MA.slice(1, -1));
    const now = Date.now();
    const pairs = new Set();
    for (const a of list) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(a.id)) throw new Error("id " + a.id);
      if (!/^[a-z0-9-]{1,40}$/.test(a.name) || !/^[0-9a-f]{64}$/.test(a.secretSha256)) throw new Error("name or hash");
      if (!Array.isArray(a.scopes) || a.scopes.length === 0) throw new Error("scopes");
      if (Date.parse(a.notAfter) - now > 90 * 86400000) throw new Error("more than 90 days ahead");
      pairs.add(a.id + ":" + a.secretSha256);
    }
    if (pairs.size !== list.length) throw new Error("a pair repeats");
    const other = list.filter((a) => a.id !== e.ID);
    if (JSON.stringify(other) !== JSON.stringify([JSON.parse(e.OTHER)])) throw new Error("the other account changed");
    const mine = list.filter((a) => a.id === e.ID);
    if (mine.length !== Number(e.WANT)) throw new Error(mine.length + " n8n entries");
    if (mine.length === 0) process.exit(0);
    const last = mine[mine.length - 1];
    const sha = require("crypto").createHash("sha256").update(e.SECRET).digest("hex");
    if (last.name !== "n8n" || last.secretSha256 !== sha || last.notAfter !== e.NA ||
      JSON.stringify(last.scopes) !== JSON.stringify(["franchiseApplicationNotify"])) throw new Error("the n8n entry");
  ' 2>&1
}
why="$(accounts_ok 1)" && ok "MACHINE_ACCOUNTS: the other account as it was, n8n's entry (sha256 of the secret, its scope, its day), as auth-service parses it" ||
  bad "MACHINE_ACCOUNTS after the first run: $why: $(val MACHINE_ACCOUNTS)"
leaked=''
for k in AIWEB_POSTGRES_PASSWORD AIWEB_DB_OWNER_PASSWORD TOTP_ENCRYPTION_KEY AIWEB_N8N_DB_PASSWORD AIWEB_N8N_ENCRYPTION_KEY \
  AIWEB_N8N_TOKEN AIWEB_N8N_MACHINE_SECRET; do
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

# AI-5: n8n's machine secret over its life: kept, rotated, switched off, back on, repaired.
cp infra/aiweb/docker-compose.yml "$BOX/infra/aiweb/"
secrets
[ "$RC" = 0 ] && why="$(accounts_ok 1)" && ok "the box is whole again (every key present, one n8n entry)" || bad "reset: $RC $OUT $why"
cp "$BOX/.env" "$W/before"
key_before="$(val AIWEB_N8N_ENCRYPTION_KEY)"
secret_before="$(val AIWEB_N8N_MACHINE_SECRET)"
secrets
cmp -s "$BOX/.env" "$W/before" && ok "a secret with more than 30 days left: nothing written" || bad "a fresh secret was changed: $OUT"

# Fewer than 30 days left: a new secret and day; the old entry stays (n8n holds it until this
# deploy's setup gives it the new one) with its own day; the other account as it was.
soon="$(date -u -d '+10 days' +%F)"
old_sha="$(printf '%s' "$secret_before" | sha256sum | cut -d' ' -f1)"
sed -i -e "s/^AIWEB_N8N_MACHINE_NOT_AFTER=.*/AIWEB_N8N_MACHINE_NOT_AFTER=$soon/" \
  -e "s/\"notAfter\":\"$(val AIWEB_N8N_MACHINE_NOT_AFTER)\"/\"notAfter\":\"$soon\"/" "$BOX/.env"
secrets
if [ "$RC" = 0 ] && [ "$(val AIWEB_N8N_MACHINE_SECRET)" != "$secret_before" ] && why="$(accounts_ok 2)" &&
  grep -qF "\"secretSha256\":\"$old_sha\",\"scopes\":[\"franchiseApplicationNotify\"],\"notAfter\":\"$soon\"" "$BOX/.env"; then
  ok "10 days left: rotated; MACHINE_ACCOUNTS holds the old entry (its own day) and the new one"
else
  bad "rotation: rc=$RC $why: $(val MACHINE_ACCOUNTS)"
fi
[ "$(val AIWEB_N8N_ENCRYPTION_KEY)" = "$key_before" ] && ok "  ...and AIWEB_N8N_ENCRYPTION_KEY is never made again" ||
  bad "the n8n encryption key changed"
printf '%s' "$OUT" | grep -qF "$(val AIWEB_N8N_MACHINE_SECRET)" && bad "the new machine secret was printed" || ok "  ...and the new secret is never printed"
# An entry already past its day is dropped by the next rotation, never carried on.
past="$(date -u -d '-1 days' +%F)"
sed -i -e "s/\"notAfter\":\"$soon\"/\"notAfter\":\"$past\"/" \
  -e "s/^AIWEB_N8N_MACHINE_NOT_AFTER=.*/AIWEB_N8N_MACHINE_NOT_AFTER=$soon/" "$BOX/.env"
secrets
why="$(accounts_ok 2)" && ! grep -qF "\"notAfter\":\"$past\"" "$BOX/.env" &&
  ok "an entry past its day is dropped at the next rotation" || bad "expired entry: $why $(val MACHINE_ACCOUNTS)"

# The kill switch: the secret line kept and blanked.
sed -i 's/^AIWEB_N8N_MACHINE_SECRET=.*/AIWEB_N8N_MACHINE_SECRET=/' "$BOX/.env"
secrets
why="$(accounts_ok 0)" && grep -qx 'AIWEB_N8N_MACHINE_SECRET=' "$BOX/.env" && printf '%s' "$OUT" | grep -qF "n8n's kill switch" &&
  ok "a blank secret: every n8n entry leaves MACHINE_ACCOUNTS, the other stays, the line stays blank" ||
  bad "kill switch: rc=$RC $why: $(val MACHINE_ACCOUNTS)"
cp "$BOX/.env" "$W/before"
secrets
cmp -s "$BOX/.env" "$W/before" && ok "  ...and stays off: the next run writes nothing" || bad "the switched-off box changed: $OUT"
# Back on, by the deploy workflow alone (env-set cannot delete a line): any placeholder secret
# with no valid day is rotated into a real one.
sed -i -e 's/^AIWEB_N8N_MACHINE_SECRET=.*/AIWEB_N8N_MACHINE_SECRET=renew/' -e 's/^AIWEB_N8N_MACHINE_NOT_AFTER=.*/AIWEB_N8N_MACHINE_NOT_AFTER=/' "$BOX/.env"
secrets
[[ "$(val AIWEB_N8N_MACHINE_SECRET)" =~ ^[0-9a-f]{64}$ ]] && why="$(accounts_ok 1)" &&
  ok "back on: 'renew' with a blank day becomes a real secret and one n8n entry" || bad "back on: $why: $OUT"
# MACHINE_ACCOUNTS overwritten by hand without n8n: its entry comes back, nothing else moves.
sed -i "s/^MACHINE_ACCOUNTS=.*/MACHINE_ACCOUNTS='[$OTHER]'/" "$BOX/.env"
secrets
why="$(accounts_ok 1)" && printf '%s' "$OUT" | grep -q 'making on this box: MACHINE_ACCOUNTS$' &&
  ok "a MACHINE_ACCOUNTS that lost n8n's entry gets it back, and only that is written" || bad "repair: $why: $OUT"

# Nothing written when MACHINE_ACCOUNTS cannot be read, has two lines, or the release lacks n8n's
# capability (auth-service would refuse to boot, and a rollback does not undo .env).
ma_refused() { # <label> <words>
  if [ "$RC" != 0 ] && cmp -s "$BOX/.env" "$W/before" && printf '%s' "$OUT" | grep -qF "$2"; then
    ok "$1: nothing written, exit $RC"
  else
    bad "$1: exit $RC, .env $(cmp -s "$BOX/.env" "$W/before" && echo unchanged || echo CHANGED): $OUT"
  fi
}
cp "$BOX/.env" "$W/good.env"
sed -i -e "s/^MACHINE_ACCOUNTS=.*/MACHINE_ACCOUNTS='not json'/" -e '/^AIWEB_N8N_TOKEN=/d' "$BOX/.env"
cp "$BOX/.env" "$W/before"
secrets
ma_refused "a MACHINE_ACCOUNTS that is not JSON" 'MACHINE_ACCOUNTS in .env is not a JSON list'
cp "$W/good.env" "$BOX/.env"
printf "MACHINE_ACCOUNTS='[$OTHER]'\n" >> "$BOX/.env"
cp "$BOX/.env" "$W/before"
secrets
ma_refused "MACHINE_ACCOUNTS on two lines" 'more than one line'
cp "$W/good.env" "$BOX/.env"
sed -i -e '/^AIWEB_N8N_MACHINE_SECRET=/d' -e '/^AIWEB_N8N_DB_PASSWORD=/d' "$BOX/.env"
printf '%s\n' "$CAPS" | grep -v franchiseApplicationNotify > "$BOX/packages/access/src/index.ts"
cp "$BOX/.env" "$W/before"
secrets
ma_refused "a release without the capability franchiseApplicationNotify (PR #1042)" 'no capability franchiseApplicationNotify'
# The release a failed gate rolls back to (.deploy/last-good-sha) must have it too: rolled back,
# its auth-service boots with this .env.
git -C "$BOX" init -q
git -C "$BOX" -c user.name=t -c user.email=t@example.invalid add packages >/dev/null
git -C "$BOX" -c user.name=t -c user.email=t@example.invalid commit -qm 'before #1042' >/dev/null
mkdir -p "$BOX/.deploy"
git -C "$BOX" rev-parse HEAD > "$BOX/.deploy/last-good-sha"
printf '%s\n' "$CAPS" > "$BOX/packages/access/src/index.ts"
secrets
ma_refused "the last good release without the capability (a rollback would not boot)" 'last good release'
rm -rf "$BOX/.deploy" "$BOX/.git"
secrets
[ "$RC" = 0 ] && why="$(accounts_ok 2)" && ok "  ...and written once the release has it" || bad "with the capability back: $why $OUT"
# The real packages/access declares CAPABILITIES the way the lookup above reads it.
sed -n '/^export const CAPABILITIES = {/,/^}/p' packages/access/src/index.ts | grep -qE '^  dashboard:' &&
  ok "packages/access/src/index.ts declares CAPABILITIES in the shape aiweb-secrets.sh reads" ||
  bad "aiweb-secrets.sh can no longer find CAPABILITIES' keys in packages/access/src/index.ts"

# -------------------------------------------------------------- 3. the deploy, fake docker
echo "deploy (aiweb-deploy.sh, fake docker):"
T="$W/deploy"
mkdir -p "$T/scripts/lib" "$T/infra/aiweb"
cp scripts/aiweb-deploy.sh scripts/aiweb-firewall.sh "$T/scripts/"
cp scripts/lib/deploy-common.sh scripts/lib/tcp-reach.cjs "$T/scripts/lib/"
cp infra/aiweb/docker-compose.yml infra/aiweb/roles.sql infra/aiweb/app-role.sql "$T/infra/aiweb/"
GOOD_ENV='AIWEB_POSTGRES_PASSWORD=p1
AIWEB_DB_OWNER_PASSWORD=p2
AIWEB_DB_APP_PASSWORD=p3
AIWEB_N8N_DB_PASSWORD=p4
AIWEB_N8N_ENCRYPTION_KEY=k5
AIWEB_N8N_TOKEN=t6
AIWEB_N8N_MACHINE_ID=11111111-2222-4333-8444-555555555555
AIWEB_N8N_MACHINE_SECRET=s7
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
mig="$(line_of ' run .* migrate$')"
n8nrm="$(line_of ' rm --stop --force n8n$')"
setup="$(line_of ' run .* n8n-setup$')"
approle="$(line_of '^psql-file app-role$')"
app="$(line_of ' up .*--remove-orphans')"
[ -n "$db" ] && [ -n "$roles" ] && [ -n "$mig" ] && [ -n "$n8nrm" ] && [ -n "$setup" ] && [ -n "$approle" ] && [ -n "$app" ] &&
  [ "$db" -lt "$roles" ] && [ "$roles" -lt "$mig" ] && [ "$mig" -lt "$n8nrm" ] && [ "$n8nrm" -lt "$setup" ] &&
  [ "$setup" -lt "$approle" ] && [ "$approle" -lt "$app" ] &&
  ok "order: database, roles, migration as the owner, n8n removed and set up, ai_app's password, then the app and n8n" ||
  bad "wrong order: db=$db roles=$roles migrate=$mig n8n-rm=$n8nrm setup=$setup app-role=$approle app=$app"
nostart="$(line_of ' up --no-start --no-recreate --scale aiweb=1 --scale n8n=1$')"
fwat="$(line_of '^iptables -w -S$')"
[ -n "$nostart" ] && [ -n "$fwat" ] && [ -n "$db" ] && [ "$nostart" -lt "$fwat" ] && [ "$fwat" -lt "$db" ] &&
  said "host ssh: TCP 22 is closed to the AI web's networks" &&
  ok "networks first (up --no-start, no one-shot job, the app and n8n held at the one container each has), then the host's ssh closed, then the first container starts" ||
  bad "up --no-start ($nostart), then aiweb-firewall.sh ($fwat), then the database ($db): $(grep -E ' up |^iptables' "$W/log" | head -4 | tr '\n' ' ')"
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
  172.19.0.2:80 172.19.0.2:443 172.19.0.2:2019 172.19.0.1:5432 172.19.0.1:8080 postgres:5432 gateway:8080 \
  172.19.0.1:22 172.20.0.1:22 172.21.0.1:22 api.hydromart-digital.com:22; do
  grep -qx "$t" "$W/asked" || missed="$missed $t"
done
[ -z "$missed" ] && ok "the probe tries each container's every address and TCP port, the names, the host's ports, and the host's ssh at the gateway of edge, private and egress and at the public address" ||
  bad "the probe did not try:$missed"
grep -qE '^172\.19\.0\.1:(80|443)$' "$W/asked" && bad "the probe tried Caddy's public ports on the host as a way in" ||
  ok "the host's 80/443 (Caddy's public front) are not counted as a way into hydromart"
grep -q ':443$' "$W/asked" && ! grep -qE '/udp|443/udp' "$W/asked" && ok "UDP ports are not tried as TCP" || bad "a UDP port reached the TCP probe"
said 'hydromart-postgres@hydromart_default 172.18.0.4:5432 timeout/CODE-x -> isolated' &&
  ok "a timeout is isolation, and every target is printed with its outcome" || bad "a timeout was not printed as isolated"
said 'hydromart-scheduler-1 exposes no TCP port' && ok "a container with no TCP port is said, not skipped in silence" ||
  bad "the port-less container went unmentioned"
missed=''
for t in 172.19.0.1:22 172.20.0.1:22 172.21.0.1:22 api.hydromart-digital.com:22; do
  said "probe: host-ssh $t timeout/CODE-x -> closed" && said "probe(n8n): host-ssh $t timeout/CODE-x -> closed" || missed="$missed $t"
done
[ -z "$missed" ] && ok "the host's ssh, dropped, is closed at every gateway and at the public address, from the app and from n8n" ||
  bad "host ssh not printed as closed at:$missed ($(grep -F host-ssh "$W/out" | head -2 | tr '\n' ' '))"
said 'cloud-metadata 169.254.169.254:80 timeout/CODE-x -> not reachable (informational)' &&
  ok "the metadata address is printed, informational" || bad "the metadata line is missing"
said 'service-name postgres:5432 not-found/CODE-x -> does not resolve (informational)' && ! said 'probe: 0 hydromart' &&
  ok "a name that does not resolve is informational, never counted as isolated" || bad "not-found was not reported as informational"

deploy FAKE_HM="pg1 gw1 web1 caddy1 sched1"
n172="$(grep -c '^172\.18\.' "$W/asked")"
[ "$RC" = 0 ] && [ "$n172" = 7 ] && grep -qx 172.18.0.29:3000 "$W/asked" && grep -qx 172.18.0.29:3001 "$W/asked" &&
  ok "5 containers (one with two ports, one with none, Caddy on two networks): 7 hydromart-network attempts" ||
  bad "expected 7 attempts on hydromart's network, got $n172 ($RC)"

# The registry: token on stdin, a throwaway config, gone afterwards, and in no child's environment.
deploy FAKE_PRESENT= GHCR_TOKEN=fake-tok1 GHCR_USER=bot
[ "$RC" = 0 ] && [ "$(grep -c '^pull --quiet .*@sha256:' "$W/log")" = 4 ] &&
  ok "missing images are pulled by digest, each once (n8n and its setup share one)" || bad "pull path ($RC): $(grep -E '^(login|pull)' "$W/log" | tr '\n' ' ')"
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
[ "$RC" = 1 ] && alerted 'did not become healthy' && said "the app's last line" && called '^iptables -w -S$' &&
  ok "an unhealthy app: its last log lines, an alert, and the host's ssh closed before it started all the same" || bad "unhealthy path ($RC)"

deploy FAKE_NOSTART_RC=1
[ "$RC" = 1 ] && ! called ' up .* db$' && ! called ' run ' && ! called '^iptables' && alerted "could not make the release's networks" &&
  ok "the networks cannot be made: nothing started, nothing run, an alert" || bad "up --no-start failing ($RC): $(tail -2 "$W/out" | tr '\n' ' ')"

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
# The host's ssh (owner decision 2026-11-24): any answer from port 22 is a breach, wherever it comes from.
probe_fails "the host's ssh answering at edge's gateway" 'isolation: the AI web reaches host-ssh at 172.19.0.1:22 (open)' \
  FAKE_OUTCOMES=172.19.0.1:22=open
probe_fails "the host's ssh answering at the private network's gateway (internal, but its gateway is the host)" \
  'isolation: the AI web reaches host-ssh at 172.20.0.1:22 (open)' FAKE_OUTCOMES=172.20.0.1:22=open
probe_fails "the host's ssh answering at the public address" 'isolation: the AI web reaches host-ssh at api.hydromart-digital.com:22 (open)' \
  FAKE_OUTCOMES=api.hydromart-digital.com:22=open
probe_fails "the public name not resolving: nothing proved" 'no usable answer for host-ssh at api.hydromart-digital.com:22' \
  FAKE_OUTCOMES=api.hydromart-digital.com:22=not-found
probe_fails "a gateway it cannot read: the host's ssh untried there is not closed" \
  'probe: could not read the gateway of the hydromart-ai_private network' FAKE_NO_GW=hydromart-ai_private
deploy FAKE_NO_SUDO=1
[ "$RC" = 1 ] && said 'needs passwordless sudo for iptables' && said 'could not close the host' &&
  alerted 'isolation: the AI web reaches host-ssh at 172.19.0.1:22 (open)' && alerted 'host ssh may be reachable from the AI web' &&
  [ ! -e "$W/fw/AIWEB-NO-SSH" ] &&
  ok "no passwordless sudo: the deploy says what root access is missing, writes nothing, and the probe finds the ssh open" ||
  bad "the firewall without sudo in a deploy ($RC): $(grep -F '!!' "$W/out" | head -3 | tr '\n' ' ')"

deploy FAKE_OUTCOMES='172.18.0.4:5432=unreachable 172.19.0.1:5432=timeout 172.19.0.2:2019=timeout 172.19.0.1:22=refused 169.254.169.254:80=open'
[ "$RC" = 0 ] && said '172.18.0.4:5432 unreachable/CODE-x -> isolated' && said 'host-ssh 172.19.0.1:22 refused/CODE-x -> closed' &&
  ok "no route (unreachable) is isolation too, a refused ssh is closed, and the informational metadata line never fails the probe" ||
  bad "unreachable, a refused ssh or the informational line failed the probe ($RC)"

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

# AI-5: n8n in the deploy and the probe.
deploy
said 'n8n: set up from the' && said 'app and n8n: healthy' && said 'n8n: the AI web reaches http://n8n:5678/healthz' &&
  said 'n8n: reaches https://api.hydromart-digital.com over its egress network' && said '[n8n-drift] none' &&
  ok "n8n: set up, started, reached by the app, reaching hydromart's API, holding what git holds" ||
  bad "the n8n half of a clean deploy: $(grep -F 'n8n' "$W/out" | tail -5 | tr '\n' ' ')"
cmp -s "$W/asked" "$W/asked.n8n1" && [ -s "$W/asked.n8n1" ] &&
  ok "the probe tries the same hydromart addresses from inside n8n as from inside the app" ||
  bad "n8n's probe plan differs: $(diff "$W/asked" "$W/asked.n8n1" 2>&1 | head -3 | tr '\n' ' ')"
said 'probe(n8n): hydromart-postgres@hydromart_default 172.18.0.4:5432 timeout/CODE-x -> isolated' &&
  ok "  ...every target printed with its outcome, as n8n saw it" || bad "no probe(n8n) lines"
grep -F 'run' "$W/log" | grep -F 'n8n-setup' | grep -qF -- '--profile n8n-setup run --rm --no-deps -T n8n-setup' &&
  ok "n8n-setup runs as a one-shot (run --rm, no deps, behind its profile)" || bad "setup call: $(grep -F n8n-setup "$W/log")"
grep '^compose' "$W/log" | grep -q 'config --images' && grep '^compose' "$W/log" | grep 'config --images' | grep -q -- '--profile n8n-setup' &&
  ok "the images to pull include the setup job's" || bad "config --images without the n8n-setup profile"

deploy FAKE_SETUP_RC=1
[ "$RC" = 1 ] && ! called '^psql-file app-role' && ! called '\-\-remove-orphans' && alerted "n8n's setup failed (exit 1" &&
  said "hydromart's events wait in the AI web's hd_events" && called ' rm --stop --force n8n$' &&
  ok "a failed n8n setup: n8n left off (removed, so the watchdog cannot start it), the app untouched, events said to wait" ||
  bad "setup failure ($RC): $(tail -3 "$W/out" | tr '\n' ' ')"
deploy AIWEB_N8N_SETUP_TIMEOUT=2 FAKE_SETUP_HANG=1
[ "$RC" = 1 ] && called '^rm -f setup1' && ! called '^psql-file app-role' && alerted 'stopped after 2s' &&
  ok "a hung n8n setup: stopped at its timeout, its container removed, nothing after it runs" ||
  bad "hung setup ($RC): $(grep -E '^(rm|ps -aq)' "$W/log" | tr '\n' ' ') $(tail -2 "$W/out" | tr '\n' ' ')"

# The kill switch: secret kept and blanked. No setup, n8n scaled to nothing, the deploy green.
ENV_FILE="$(sed 's/^AIWEB_N8N_MACHINE_SECRET=.*/AIWEB_N8N_MACHINE_SECRET=/' <<<"$GOOD_ENV")" deploy FAKE_NO_N8N=1
[ "$RC" = 0 ] && ! called 'n8n-setup run' && ! called ' rm --stop --force n8n' && called ' up .*--remove-orphans.*--scale n8n=0' &&
  called ' up --no-start --no-recreate --scale aiweb=1 --scale n8n=0$' && said 'n8n is switched off' && said 'AI web OK' &&
  ok "n8n switched off (blank secret): never set up, held at none from the networks step on, the deploy still green" ||
  bad "kill switch deploy ($RC): $(grep -E 'n8n' "$W/out" | tail -3 | tr '\n' ' ')"
ENV_FILE="$(sed 's/^AIWEB_N8N_MACHINE_SECRET=.*/AIWEB_N8N_MACHINE_SECRET=/' <<<"$GOOD_ENV")" deploy
[ "$RC" = 1 ] && alerted 'n8n runs although AIWEB_N8N_MACHINE_SECRET is blank' &&
  ok "switched off yet running (the fake up leaves it): the probe says so" || bad "off but running ($RC)"
ENV_FILE="$(sed '/^AIWEB_N8N_MACHINE_SECRET=/d' <<<"$GOOD_ENV")" deploy
[ "$RC" = 1 ] && ! called '^compose' && said 'no value in .env for: AIWEB_N8N_MACHINE_SECRET' &&
  ok "no machine secret line at all: named, nothing touched" || bad "absent secret ($RC): $(tail -2 "$W/out" | tr '\n' ' ')"

probe_fails "n8n not running though not switched off" 'no n8n container is running' FAKE_NO_N8N=1
called ' up --no-start --no-recreate --scale aiweb=1 --scale n8n=0$' &&
  ok "  ...and an n8n with no container is held at none by the networks step: never made there for the watchdog to start" ||
  bad "the networks step with no n8n container: $(grep -F ' up --no-start' "$W/log")"
probe_fails "n8n on another network" 'isolation: n8n is attached to network hydromart_default' FAKE_N8N_EXTRA_NET=hydromart_default
probe_fails "n8n's editor published wide" 'isolation: n8n publishes a host port (0.0.0.0:5678->5678/tcp)' "FAKE_N8N_BIND=0.0.0.0:5678->5678/tcp "
probe_fails "a second n8n port" 'isolation: n8n publishes a host port' "FAKE_N8N_BIND=127.0.0.1:5678->5678/tcp 127.0.0.1:5679->5679/tcp "
probe_fails "someone else on n8n's egress" 'hydromart/gateway(gw1) is on the hydromart-ai_egress network, where n8n can reach it' FAKE_EGRESS_EXTRA=gw1
probe_fails "a hydromart address answering n8n" 'isolation: n8n reaches hydromart-gateway-1@hydromart_default at 172.18.0.9:8080 (open)' \
  FAKE_N8N_OUTCOMES=172.18.0.9:8080=open
probe_fails "the host's ssh answering n8n at its egress gateway" 'isolation: n8n reaches host-ssh at 172.21.0.1:22 (open)' \
  FAKE_N8N_OUTCOMES=172.21.0.1:22=open
probe_fails "the host's ssh answering n8n at the public address" 'isolation: n8n reaches host-ssh at api.hydromart-digital.com:22 (open)' \
  FAKE_N8N_OUTCOMES=api.hydromart-digital.com:22=open
probe_fails "n8n blind: its own database does not open" 'n8n could not open its own database' FAKE_N8N_OUTCOMES=db:5432=timeout
probe_fails "n8n cut off from hydromart's API" "n8n: cannot fetch https://api.hydromart-digital.com/auth/api/v1/auth/jwks" FAKE_N8N_JWKS_FAIL=1
probe_fails "the app cut off from n8n" 'n8n: the AI web cannot reach http://n8n:5678/healthz' FAKE_N8N_HEALTH_RC=1
probe_fails "n8n drifted from git" 'drift.mjs exit 1' FAKE_DRIFT_RC=1
said 'workflow x1 is published in n8n but is not in git' && ok "  ...naming the drift" || bad "the drift line was not shown"
probe_fails "ai_app can delete hd_events in effect (through PUBLIC or a role)" 'ai_app can, in effect (PUBLIC or a role it belongs to): hd_events:DELETE' \
  "FAKE_EFFECTIVE=hd_events:DELETE"
probe_fails "ai_app may delete from hd_events" 'must hold exactly INSERT,SELECT,UPDATE on hd_events' \
  "FAKE_GRANTS=answer_trail:INSERT,SELECT
hd_events:DELETE,INSERT,SELECT,UPDATE
kill_switch_events:INSERT,SELECT"
probe_fails "no hd_events (a release before AI-5)" "must hold exactly INSERT,SELECT,UPDATE on hd_events, and holds ''" \
  "FAKE_GRANTS=answer_trail:INSERT,SELECT
kill_switch_events:INSERT,SELECT"

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

# ------------------------------------------------- 5. the nightly n8n check (AI-5), fake docker
echo "nightly n8n check (aiweb-n8n-check.sh):"
N="$W/n8ncheck"
mkdir -p "$N/scripts/lib" "$N/infra/aiweb" "$N/bin"
cp scripts/aiweb-n8n-check.sh "$N/scripts/"
cp scripts/lib/deploy-common.sh "$N/scripts/lib/"
cp infra/aiweb/docker-compose.yml "$N/infra/aiweb/"
cat > "$N/bin/docker" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_LOG"
case "$1" in
  ps)
    case "$*" in
      *project=hydromart-ai*service=n8n*) [ -n "${FAKE_NO_N8N:-}" ] || echo n8n1 ;;
      *project=hydromart-ai*service=db*) [ -n "${FAKE_NO_DB:-}" ] || echo db1 ;;
    esac ;;
  exec)
    case "$2" in
      db1)
        [ -z "${FAKE_PSQL_FAIL:-}" ] || { echo 'ERROR:  column "kind" does not exist' >&2; exit 1; }
        [ -z "${FAKE_PSQL_WARN:-}" ] || echo 'WARNING:  could not flush dirty data: harmless' >&2
        printf '%s\n' "${FAKE_NO_2FA:-0 0 }" ;;
      *)
        case "${FAKE_DRIFT:-0}" in
          0) echo '[n8n-drift] none: 2 workflow(s) and 2 credential(s) as git holds them' ;;
          *) echo '[n8n-drift] workflow x1 is published in n8n but is not in git' >&2; exit "$FAKE_DRIFT" ;;
        esac ;;
    esac ;;
esac
exit 0
EOF
cp "$BIN/curl" "$N/bin/curl"
chmod +x "$N/bin/docker" "$N/bin/curl"
check() { # <AIWEB_N8N_MACHINE_SECRET line> <AIWEB_N8N_MACHINE_NOT_AFTER value> <env...>
  local secret_line="$1" not_after="$2"
  shift 2
  printf '%s\nAIWEB_N8N_MACHINE_NOT_AFTER=%s\nALERT_WEBHOOK_URL=https://alert.invalid/hook\n' "$secret_line" "$not_after" > "$N/.env"
  : > "$W/log"
  : > "$W/alerts"
  OUT="$(cd "$N" && env PATH="$N/bin:$PATH" FAKE_LOG="$W/log" FAKE_ALERTS="$W/alerts" FAKE_CURL="$W/curl" FAKE_ENVS="$W/envs" \
    "$@" bash scripts/aiweb-n8n-check.sh 2>&1)"
  RC=$?
}
later="$(date -u -d '+60 days' +%F)"
check AIWEB_N8N_MACHINE_SECRET=s "$later"
[ "$RC" = 0 ] && [ ! -s "$W/alerts" ] && grep -q 'exec n8n1 node /opt/hydromart/bin/drift.mjs' "$W/log" &&
  ok "no drift and 60 days left: exit 0, silent, drift.mjs run inside the running n8n" || bad "all well ($RC): $OUT"
check AIWEB_N8N_MACHINE_SECRET=s "$later" FAKE_DRIFT=1
[ "$RC" = 1 ] && grep -q 'n8n drift check exit 1' "$W/alerts" && grep -q 'workflow x1 is published in n8n but is not in git' "$W/alerts" &&
  ok "drift (exit 1): alerted, with the line that says what differs" || bad "drift ($RC): $(cat "$W/alerts")"
check AIWEB_N8N_MACHINE_SECRET=s "$later" FAKE_DRIFT=1
[ "$RC" = 1 ] && [ ! -s "$W/alerts" ] && ok "  ...once: the same drift the next night is not said again" || bad "drift said twice"
check AIWEB_N8N_MACHINE_SECRET=s "$later"
[ ! -e "$N/.deploy/alerted/aiweb-n8n-drift" ] && ok "  ...and forgotten when it ends" || bad "the drift memory survived a clean night"
check AIWEB_N8N_MACHINE_SECRET=s "$later" FAKE_DRIFT=2
[ "$RC" = 1 ] && grep -q 'n8n drift check exit 2' "$W/alerts" && ok "could not check (exit 2): alerted too" || bad "exit 2 ($RC)"
check AIWEB_N8N_MACHINE_SECRET=s "$later" FAKE_NO_N8N=1
[ "$RC" = 1 ] && grep -q 'n8n is not running on this box' "$W/alerts" && ! grep -q '^exec n8n1' "$W/log" &&
  ok "no n8n running: alerted, nothing run in it" || bad "no n8n ($RC): $(cat "$W/alerts")"
check AIWEB_N8N_MACHINE_SECRET=s "$(date -u -d '+10 days' +%F)"
[ "$RC" = 1 ] && grep -q 'n8n machine secret stops on' "$W/alerts" && grep -q 'run Deploy (mode deploy)' "$W/alerts" &&
  ok "the machine secret 10 days from its end: alerted, saying a deploy renews it" || bad "10 days ($RC): $(cat "$W/alerts")"
check AIWEB_N8N_MACHINE_SECRET=s "$(date -u -d '+20 days' +%F)"
[ "$RC" = 0 ] && [ ! -s "$W/alerts" ] && [ ! -e "$N/.deploy/alerted/aiweb-n8n-secret" ] &&
  ok "  ...20 days: silent (a deploy rotates it from 30), the earlier alert forgotten" || bad "20 days ($RC): $(cat "$W/alerts")"
check AIWEB_N8N_MACHINE_SECRET=s 'soon'
[ "$RC" = 1 ] && grep -q 'has no valid end date' "$W/alerts" && ok "an end date that is not a date: alerted" || bad "bad date ($RC)"
check AIWEB_N8N_MACHINE_SECRET= "$(date -u -d '+3 days' +%F)" FAKE_DRIFT=1
[ "$RC" = 0 ] && [ ! -s "$W/alerts" ] && [ ! -s "$W/log" ] && grep -q 'switched off' <<<"$OUT" &&
  ok "n8n switched off (blank secret): said, nothing asked of docker, nothing alerted" || bad "switched off ($RC): $OUT"
check AIWEB_N8N_MACHINE_SECRET=s "$later"
grep -q '^exec db1 psql -tAX -U postgres -d n8n -v ON_ERROR_STOP=1 -c' "$W/log" &&
  grep -qF "WHERE kind = 'person' AND NOT disabled AND NOT \"mfaEnabled\" AND email IS NOT NULL" "$W/log" &&
  ok "2FA (D5): database n8n is asked for the persons who can sign in without it" || bad "2FA query not sent: $(cat "$W/log")"
check AIWEB_N8N_MACHINE_SECRET=s "$later" FAKE_NO_2FA='2 1 global:admin,global:owner'
[ "$RC" = 1 ] &&
  grep -q '2 n8n account(s) can sign in to the editor without 2FA, 1 of them an invite not yet taken (roles global:admin,global:owner)' "$W/alerts" &&
  grep -q 'or remove the account or the invite' "$W/alerts" &&
  ok "  ...two accounts without it, one an invite: alerted with their roles, no address" || bad "no 2FA ($RC): $(cat "$W/alerts")"
check AIWEB_N8N_MACHINE_SECRET=s "$later" FAKE_NO_2FA='2 1 global:admin,global:owner'
[ "$RC" = 1 ] && [ ! -s "$W/alerts" ] && ok "  ...once: the next night is not said again" || bad "2FA said twice"
check AIWEB_N8N_MACHINE_SECRET=s "$later"
[ "$RC" = 0 ] && [ ! -s "$W/alerts" ] && [ ! -e "$N/.deploy/alerted/aiweb-n8n-2fa" ] &&
  ok "  ...and forgotten once every account has it" || bad "the 2FA memory survived ($RC)"
check AIWEB_N8N_MACHINE_SECRET=s "$later" FAKE_PSQL_FAIL=1
[ "$RC" = 1 ] && grep -q 'n8n 2FA check could not read' "$W/alerts" && grep -q 'column kind does not exist' "$W/alerts" &&
  ok "  ...a query that fails (a renamed column) is alerted as could not check, never all well" || bad "psql failure ($RC): $(cat "$W/alerts")"
check AIWEB_N8N_MACHINE_SECRET=s "$later" FAKE_NO_2FA='not a count'
[ "$RC" = 1 ] && grep -q 'n8n 2FA check could not read' "$W/alerts" &&
  ok "  ...and so is an answer that is not <count> <invites> <roles>" || bad "odd answer ($RC): $(cat "$W/alerts")"
check AIWEB_N8N_MACHINE_SECRET=s "$later" FAKE_PSQL_WARN=1
[ "$RC" = 0 ] && [ ! -s "$W/alerts" ] && [ ! -e "$N/.deploy/alerted/aiweb-n8n-2fa" ] &&
  ok "  ...a warning psql prints on a good answer is not read as the answer" || bad "psql warning ($RC): $(cat "$W/alerts")"
mkdir -p "$N/.deploy/alerted" && echo 'an old 2FA alert' > "$N/.deploy/alerted/aiweb-n8n-2fa"
check AIWEB_N8N_MACHINE_SECRET= "$later"
[ "$RC" = 0 ] && [ ! -e "$N/.deploy/alerted/aiweb-n8n-2fa" ] &&
  ok "  ...switching n8n off forgets a 2FA alert too, so switching it back on says it again" || bad "kill switch kept the 2FA memory ($RC)"
check AIWEB_N8N_MACHINE_SECRET=s "$later" FAKE_NO_DB=1
[ "$RC" = 1 ] && grep -q "the AI web's database is not running" "$W/alerts" &&
  ok "  ...no database running: alerted" || bad "no database ($RC): $(cat "$W/alerts")"
grep -q 'aiweb-n8n-check.sh' scripts/install-host-cron.sh && ok "install-host-cron.sh schedules it" || bad "install-host-cron.sh does not schedule the n8n check"

# ------------------------------- 6. the host's ssh (aiweb-firewall.sh), fake docker, sudo, iptables
echo "host ssh closed to the AI web (aiweb-firewall.sh):"
fw() { # <env assignments...>: one run on the deploy's scratch box, against the fake firewall as it stands
  OUT="$(cd "$T" && env "${FAKE_ENV[@]}" "$@" bash scripts/aiweb-firewall.sh 2>&1)"
  RC=$?
}
chain() { cat "$W/fw/$1" 2>/dev/null; }
# The jump as the fake, like iptables, stores and prints it.
JUMP='-p tcp -m tcp --dport 22 -j AIWEB-NO-SSH'
CLOSED='-i br-a1a1a1a1a1a1 -j DROP
-i br-b2b2b2b2b2b2 -j DROP
-i br-e0e0e0e0e0e0 -j DROP'
SAVED="$T/.deploy/aiweb-firewall.bridges"
SAVED_LIST='hydromart-ai_private=br-a1a1a1a1a1a1
hydromart-ai_egress=br-b2b2b2b2b2b2
edge=br-e0e0e0e0e0e0'
printf '%s\n' "$GOOD_ENV" > "$T/.env"
rm -f "$T/.deploy/alerted/aiweb-firewall" "$SAVED"
reset_fakes
fw
[ "$RC" = 0 ] && [ "$(chain AIWEB-NO-SSH)" = "$CLOSED" ] &&
  ok "fresh from a reboot: TCP 22 dropped on the bridges of private, egress and edge (br- and 12 of the id), and on no other" ||
  bad "the chain after a first run ($RC): $(chain AIWEB-NO-SSH | tr '\n' ' ') $OUT"
[ "$(chain INPUT)" = "$JUMP
-i lo -j ACCEPT" ] && ok "INPUT gains one rule, first, for TCP 22 only; the rule already there stays, after it" ||
  bad "INPUT after a first run: $(chain INPUT | tr '\n' ' ')"
[ "$(chain DOCKER-USER)" = '-j RETURN' ] && ! grep -E '^iptables .*(DOCKER|FORWARD|OUTPUT|-t )' "$W/log" &&
  ok "no Docker chain, no other chain and no other table is touched" || bad "something else was touched: $(grep '^iptables' "$W/log" | tr '\n' ' ')"
grep -qF 'TCP 22 now dropped from: hydromart-ai_private=br-a1a1a1a1a1a1 hydromart-ai_egress=br-b2b2b2b2b2b2 edge=br-e0e0e0e0e0e0 (wrote AIWEB-NO-SSH INPUT)' <<<"$OUT" &&
  ok "  ...and says which network got which bridge, and what it wrote" || bad "the first run said: $OUT"
[ "$(cat "$SAVED" 2>/dev/null)" = "$SAVED_LIST" ] &&
  ok "  ...and saves the bridges it wrote, network by network, for a run docker cannot answer" || bad "saved: $(cat "$SAVED" 2>&1)"
[ "$(head -1 "$W/log")" = 'flock -w 60 8' ] && ok "one run at a time: the lock is taken before docker or iptables is asked anything" ||
  bad "the first call was not the lock: $(head -2 "$W/log" | tr '\n' ' ')"
: > "$W/log"
fw
[ "$RC" = 0 ] && [ -z "$OUT" ] && [ "$(grep -c '^iptables' "$W/log")" = 1 ] && ! grep -qE '^iptables -w -[NFAICD] ' "$W/log" &&
  ok "a second run reads (one call), writes nothing and says nothing" || bad "a second run ($RC) wrote or spoke: $OUT $(grep '^iptables' "$W/log" | tr '\n' ' ')"
sed -i '/AIWEB-NO-SSH/d' "$W/fw/INPUT"
: > "$W/log"
fw
[ "$RC" = 0 ] && [ "$(chain INPUT)" = "$JUMP
-i lo -j ACCEPT" ] && ! grep -q '^iptables -w -[NFA] ' "$W/log" &&
  ok "a jump taken out of INPUT is put back first; the chain, still right, is left alone" || bad "jump repair ($RC): $(chain INPUT | tr '\n' ' ') $OUT"
printf '%s\n' '-p tcp -m tcp --dport 22 -j ACCEPT' "$JUMP" '-i lo -j ACCEPT' > "$W/fw/INPUT"
fw
[ "$RC" = 0 ] && [ "$(chain INPUT)" = "$JUMP
-p tcp -m tcp --dport 22 -j ACCEPT
-i lo -j ACCEPT" ] && grep -qF '(wrote INPUT)' <<<"$OUT" &&
  ok "a rule put ahead of the jump (an ACCEPT for 22 would let all of it through): the jump goes back first, that rule stays after it" ||
  bad "the jump not first ($RC): $(chain INPUT | tr '\n' ' ') $OUT"
printf '%s\n' "$JUMP" '-i lo -j ACCEPT' "$JUMP" > "$W/fw/INPUT"
fw
[ "$RC" = 0 ] && [ "$(chain INPUT)" = "$JUMP
-i lo -j ACCEPT" ] && ok "the jump in twice (two runs once raced): one copy left, first" ||
  bad "a doubled jump ($RC): $(chain INPUT | tr '\n' ' ') $OUT"
: > "$W/log"
fw FAKE_FLOCK_BUSY=1
[ "$RC" = 1 ] && grep -qF 'could not lock .deploy/aiweb-firewall.lock within 60 seconds' <<<"$OUT" && [ "$(grep -vc '^flock ' "$W/log")" = 0 ] &&
  ok "another run holding the lock: this one asks and writes nothing, says so, exit 1" || bad "the lock held ($RC): $OUT $(head -3 "$W/log" | tr '\n' ' ')"
fw FAKE_PRIVATE_ID=f9f9f9f9f9f9
[ "$RC" = 0 ] && [ "$(chain AIWEB-NO-SSH)" = '-i br-b2b2b2b2b2b2 -j DROP
-i br-e0e0e0e0e0e0 -j DROP
-i br-f9f9f9f9f9f9 -j DROP' ] && [ "$(grep -c AIWEB-NO-SSH "$W/fw/INPUT")" = 1 ] && grep -qx 'hydromart-ai_private=br-f9f9f9f9f9f9' "$SAVED" &&
  ok "a network made again (a new bridge): the chain and the saved bridges follow it, the old bridge leaves, INPUT keeps its one jump" ||
  bad "a re-made network ($RC): $(chain AIWEB-NO-SSH | tr '\n' ' ') $OUT"
fw
: > "$W/log"
fw FAKE_DOCKER_DOWN=1
[ "$RC" = 0 ] && [ -z "$OUT" ] && [ "$(chain AIWEB-NO-SSH)" = "$CLOSED" ] && ! grep -qE '^iptables -w -[NFAICD] ' "$W/log" &&
  ok "docker not answering (live-restore keeps the containers up), the rules in place: they are the saved bridges, nothing written" ||
  bad "docker down, rules in place ($RC): $(chain AIWEB-NO-SSH | tr '\n' ' ') $OUT"
# A reboot: the kernel's rules are gone, .deploy/ is not, and docker is not up yet.
reset_fakes
fw FAKE_DOCKER_DOWN=1
[ "$RC" = 0 ] && [ "$(chain AIWEB-NO-SSH)" = "$CLOSED" ] && [ "$(chain INPUT)" = "$JUMP
-i lo -j ACCEPT" ] && grep -qF 'from the bridges the last run saved: docker is not answering (Cannot connect to the Docker daemon)' <<<"$OUT" &&
  [ ! -s "$W/alerts" ] && [ "$(cat "$SAVED")" = "$SAVED_LIST" ] &&
  ok "at boot, docker not up yet: port 22 closed from the saved bridges before docker starts a container, no alert, the list kept" ||
  bad "the boot run ($RC): $(chain AIWEB-NO-SSH | tr '\n' ' ') $OUT"
rm -f "$SAVED"
reset_fakes
fw FAKE_DOCKER_DOWN=1
[ "$RC" = 1 ] && [ ! -e "$W/fw/AIWEB-NO-SSH" ] && grep -qF 'and no bridges were saved, so the rules were left as they were' <<<"$OUT" &&
  grep -qF 'host ssh may be reachable from the AI web: docker did not list' "$W/alerts" &&
  ok "docker not answering and nothing saved: nothing written, exit 1, an alert" || bad "docker down, nothing saved ($RC): $OUT"
printf '%s\n' 'edge=br-e0e0e0e0e0e0' 'x=--modprobe=/tmp/x' > "$SAVED"
: > "$W/log"
fw FAKE_DOCKER_DOWN=1
[ "$RC" = 1 ] && grep -qF "holds 'x=--modprobe=/tmp/x', not a network and its bridge" <<<"$OUT" && ! grep -q '^iptables' "$W/log" &&
  ok "a saved list that is not network=bridge lines is refused before anything reaches iptables" || bad "a bad saved list ($RC): $OUT"
rm -f "$SAVED"
: > "$W/log"
fw FAKE_EDGE_ID=--modprobe=x
[ "$RC" = 1 ] && grep -qF "the id '--modprobe=x', not 12 hex characters" <<<"$OUT" && ! grep -q '^iptables' "$W/log" &&
  ok "a network id that is not 12 hex characters is refused before anything reaches iptables" || bad "a bad id ($RC): $OUT"
rm -f "$T/.deploy/alerted/aiweb-firewall"
reset_fakes
fw FAKE_EGRESS_IPV6=true
[ "$RC" = 1 ] && [ "$(chain AIWEB-NO-SSH)" = "$CLOSED" ] && [ "$(head -1 "$W/fw/INPUT")" = "$JUMP" ] &&
  grep -qF '!! IPv6 is on for: hydromart-ai_egress, and only IPv4 is closed to them' <<<"$OUT" && grep -qF 'IPv6 is on for' "$W/alerts" &&
  ok "an AI web network with IPv6 on: every network still closed over IPv4, then the IPv6 one reported, exit 1, an alert" ||
  bad "IPv6 beside IPv4 ($RC): $(chain AIWEB-NO-SSH | tr '\n' ' ') $OUT"
reset_fakes
fw 'AI_PROJECT=x # y'
[ "$RC" = 1 ] && grep -qF "'x # y' (the name: line of infra/aiweb/docker-compose.yml) is not a compose project name" <<<"$OUT" &&
  ! grep -qE '^(network|iptables) ' "$W/log" && grep -qF 'is not a compose project name' "$W/alerts" &&
  ok "a project name that is not one (a comment on its line): refused before docker or iptables is asked, an alert" || bad "a bad project name ($RC): $OUT"
mv "$T/infra/aiweb/docker-compose.yml" "$T/infra/aiweb/compose.away"
: > "$W/log"
fw
[ "$RC" = 1 ] && grep -qF "!! '' (the name: line of infra/aiweb/docker-compose.yml) is not a compose project name" <<<"$OUT" &&
  ! grep -qE '^(network|iptables) ' "$W/log" &&
  ok "no compose file at all: the same refusal, said and alerted, not a silent exit" || bad "no compose file ($RC): $OUT"
mv "$T/infra/aiweb/compose.away" "$T/infra/aiweb/docker-compose.yml"
rm -f "$T/.deploy/alerted/aiweb-firewall"
reset_fakes
fw FAKE_NO_SUDO=1
[ "$RC" = 1 ] && [ ! -e "$W/fw/AIWEB-NO-SSH" ] && [ "$(chain INPUT)" = '-i lo -j ACCEPT' ] &&
  grep -qF '!! sudo -n iptables -S failed (sudo: a password is required): the deploy user needs passwordless sudo for iptables' <<<"$OUT" &&
  grep -qF 'host ssh may be reachable from the AI web: sudo -n iptables -S failed' "$W/alerts" &&
  ok "no passwordless sudo: nothing written, the '!!' line names the root access missing, one alert" || bad "no sudo ($RC): $OUT"
n_alerts="$(wc -l < "$W/alerts")"
fw FAKE_NO_SUDO=1
[ "$RC" = 1 ] && [ "$(wc -l < "$W/alerts")" = "$n_alerts" ] && grep -qF '!! sudo -n iptables -S failed' <<<"$OUT" &&
  ok "  ...said again on the next run, alerted once" || bad "the same failure alerted twice, or went quiet ($RC): $OUT"
fw
[ "$RC" = 0 ] && [ "$(chain AIWEB-NO-SSH)" = "$CLOSED" ] && [ ! -e "$T/.deploy/alerted/aiweb-firewall" ] &&
  ok "  ...and forgotten by the run that closes it" || bad "after sudo came back ($RC): $OUT"
# D3 staging: its networks (edge-staging, and every network of the staging project) are closed
# like the AI web's, in the same chain; with none of them on the box nothing above changes.
reset_fakes
rm -f "$SAVED"
fw FAKE_STAGING=1
[ "$RC" = 0 ] && [ "$(chain AIWEB-NO-SSH)" = '-i br-a1a1a1a1a1a1 -j DROP
-i br-a5a5a5a5a5a5 -j DROP
-i br-b2b2b2b2b2b2 -j DROP
-i br-d6d6d6d6d6d6 -j DROP
-i br-e0e0e0e0e0e0 -j DROP
-i br-f4f4f4f4f4f4 -j DROP' ] &&
  ok "the staging networks (edge-staging, the staging project's private and tunnel) get TCP 22 dropped beside the AI web's, and no other network does" ||
  bad "the chain with staging networks ($RC): $(chain AIWEB-NO-SSH | tr '\n' ' ') $OUT"
grep -qF 'edge-staging=br-f4f4f4f4f4f4' "$SAVED" && grep -qF 'hydromart-ai-staging_private=br-a5a5a5a5a5a5' "$SAVED" &&
  ok "  ...and saves their bridges for a run docker cannot answer" || bad "saved: $(cat "$SAVED" 2>&1)"
reset_fakes
rm -f "$SAVED"
fw
[ "$RC" = 0 ] && [ "$(chain AIWEB-NO-SSH)" = "$CLOSED" ] &&
  ok "with no staging network on the box the chain is the same three bridges as before" || bad "without staging ($RC): $(chain AIWEB-NO-SSH | tr '\n' ' ') $OUT"
fw STAGING_PROJECT='x # y'
[ "$RC" = 1 ] && grep -qF "'x # y' (the staging project's name) is not a compose project name" <<<"$OUT" &&
  ok "a staging project name that is not one is refused before iptables" || bad "a bad staging name ($RC): $OUT"
for prod in hydromart hydromart-ai; do
  : > "$W/log"
  fw "STAGING_PROJECT=$prod"
  [ "$RC" = 1 ] && grep -qF "is a production project; refused" <<<"$OUT" && ! grep -q '^iptables' "$W/log" &&
    ok "a staging project named '$prod' (a production project) is refused before iptables is touched" ||
    bad "staging project '$prod' ($RC): $OUT"
done
rm -f "$T/.deploy/alerted/aiweb-firewall"
reset_fakes
fw
fw_lines="$(bash scripts/install-host-cron.sh --show 2>/dev/null | grep -F 'scripts/aiweb-firewall.sh')"
case "$fw_lines" in
  "@reboot cd "*" && bash scripts/aiweb-firewall.sh >> /var/log/hydromart-watchdog.log 2>&1
*/5 * * * * cd "*" && bash scripts/aiweb-firewall.sh >> /var/log/hydromart-watchdog.log 2>&1")
    ok "install-host-cron.sh runs it at boot (@reboot) and every 5 minutes, into the watchdog's log" ;;
  *) bad "install-host-cron.sh does not run aiweb-firewall.sh at boot and every 5 minutes: '$fw_lines'" ;;
esac

if [ "$fails" -gt 0 ]; then
  echo "aiweb: $fails check(s) failed" >&2
  exit 1
fi
echo "aiweb: all checks passed"
