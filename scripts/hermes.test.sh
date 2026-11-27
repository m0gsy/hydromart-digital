#!/usr/bin/env bash
# Hermes Agent's stack, proved without the box:
#
#   1. scripts/check-hermes-compose.mjs passes the committed file and refuses each edit that undoes
#      the isolation (a check that cannot go red proves nothing);
#   2. scripts/hermes-firewall.sh --print writes the rules text it would hold, for a fake bridge, with no root;
#   3. the scripts parse, deploy.yml dispatches both modes, cron runs the firewall.
#
#   bash scripts/hermes.test.sh
#
# `set +e` for the reason its siblings give: CI runs them as `bash -e <file>`, and several commands
# below exit non-zero on purpose.
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

echo "compose policy (check-hermes-compose.mjs):"
if node scripts/check-hermes-compose.mjs >/dev/null 2>&1; then
  ok "the committed compose file passes"
else
  bad "the committed file fails: $(node scripts/check-hermes-compose.mjs 2>&1 | tail -3 | tr '\n' ' ')"
fi

mutant() { # <name> <JS statement on `doc`>
  node -e '
    const fs = require("fs");
    const yaml = require("js-yaml");
    const doc = yaml.load(fs.readFileSync(process.argv[1], "utf8"));
    new Function("doc", process.argv[2])(doc);
    fs.writeFileSync(process.argv[3], yaml.dump(doc));
  ' infra/hermes/docker-compose.yml "$2" "$W/$1.yml"
}
refuses() { # <name> <JS statement> <words the refusal must contain> <what it undoes>
  mutant "$1" "$2" || {
    bad "could not build the mutant $1"
    return
  }
  local out
  if out="$(node scripts/check-hermes-compose.mjs "$W/$1.yml" 2>&1)"; then
    bad "accepts $4"
  elif printf '%s' "$out" | grep -qF "$3"; then
    ok "refuses $4"
  else
    bad "refuses $4, but not for that reason: $(printf '%s' "$out" | tail -2 | tr '\n' ' ')"
  fi
}
# The control: the same round trip with no edit must pass, or every refusal below is vacuous.
mutant identity 'void doc' && node scripts/check-hermes-compose.mjs "$W/identity.yml" >/dev/null 2>&1 &&
  ok "an unedited round trip through js-yaml still passes (the refusals below are the edits')" ||
  bad "an unedited round trip fails, so the refusals below prove nothing"

S='doc.services.hermes'
refuses socket "$S.volumes.push('/var/run/docker.sock:/var/run/docker.sock')" 'volumes must be exactly' "a docker socket mount"
refuses hostmount "$S.volumes = ['/srv:/opt/data']" 'volumes must be exactly' "a host bind mount"
refuses ports "$S.ports = ['9119:9119']" 'sets `ports`' "a published port"
refuses privileged "$S.privileged = true" 'sets `privileged`' "privileged"
refuses hostnet "$S.network_mode = 'host'" 'sets `network_mode`' "host networking"
refuses foreign "$S.environment.ANTHROPIC_API_KEY = '\${JWT_ACCESS_SECRET:?x}'" 'only HERMES_* keys' "a non-HERMES interpolation"
refuses allowall "$S.environment.GATEWAY_ALLOW_ALL_USERS = 'true'" 'must never be set' "GATEWAY_ALLOW_ALL_USERS"
refuses yolo "$S.environment.HERMES_YOLO_MODE = '1'" 'must never be set' "HERMES_YOLO_MODE"
refuses nomem "delete $S.mem_limit" 'mem_limit must be set' "a missing mem_limit"
refuses nopids "delete $S.pids_limit" 'pids_limit must be set' "a missing pids_limit"
refuses tag "$S.image = 'nousresearch/hermes-agent:v0.23.4'" 'pinned by digest' "a tag instead of a digest"
refuses extranet "doc.networks.edge = {external: true}; $S.networks = ['hermes', 'edge']" 'networks must be exactly' "an extra network"
refuses othernet "$S.networks = ['default']" 'must join the `hermes` network' "a network that is not its own"
refuses nodrop "$S.cap_drop = []" 'cap_drop must be [ALL]' "caps not dropped"
refuses morecap "$S.cap_add.push('SYS_ADMIN')" 'cap_add must be exactly' "an extra capability"
refuses extraenv "$S.environment.OPENAI_API_KEY = 'x'" 'only ANTHROPIC_API_KEY' "a fourth environment key"
refuses restart "$S.restart = 'unless-stopped'" 'restart must be "no"' "a docker restart policy (it would start before the firewall at boot)"
refuses extends "$S.extends = {file: '/etc/x.yml', service: 'a'}" 'sets `extends`' "extends"
refuses configs "doc.configs = {c: {file: '/etc/shadow'}}" 'top level' "top-level configs with a host file"
refuses secrets "doc.secrets = {s: {file: '/etc/shadow'}}" 'top level' "top-level secrets with a host file"
refuses include "doc.include = ['../aiweb/docker-compose.yml']" 'top level' "include"
refuses dns "$S.dns = ['10.0.0.2']" 'sets `dns`' "a dns setting"
refuses runtime "$S.runtime = 'runc'" 'sets `runtime`' "a runtime"
refuses labels "$S.labels = {x: '/etc'}" 'sets `labels`' "labels"
refuses nethost "doc.networks.hermes = {driver: 'host'}" 'plain' "network driver host"
refuses netmacvlan "doc.networks.hermes = {driver: 'macvlan'}" 'plain' "network driver macvlan"
refuses netinternal "doc.networks.hermes = {internal: true}" 'plain' "an internal network (Telegram would be unreachable; not the committed shape)"
refuses voldriver "doc.volumes['hermes-data'] = {driver_opts: {type: 'none', device: '/', o: 'bind'}}" 'plain named volume' "a bind-backed volume"
refuses extrasvc "doc.services.other = {image: 'x@sha256:0000000000000000000000000000000000000000000000000000000000000000'}" 'exactly one service' "a second service"

refuses poolreq "$S.environment.ANTHROPIC_API_KEY_2 = '\${AIWEB_LLM_ANTHROPIC_API_KEY:?x}'" 'must be exactly' "a required (:?) fallback key"
refuses poolname "$S.environment.TELEGRAM_BOT_TOKEN = '\${AIWEB_LLM_ANTHROPIC_API_KEY:-}'" 'may only feed ANTHROPIC_API_KEY_2' "the AI web key under another env name"
refuses poolonce "$S.environment.ANTHROPIC_API_KEY_3 = '\${AIWEB_LLM_ANTHROPIC_API_KEY:-}'" 'read 2 times' "the AI web key read twice"
refuses aiwebother "$S.environment.ANTHROPIC_API_KEY_2 = '\${AIWEB_LLM_OPENAI_API_KEY:-}'" 'only HERMES_* keys' "another AIWEB_* interpolation"
refuses pgother "$S.environment.ANTHROPIC_API_KEY_2 = '\${POSTGRES_PASSWORD:-}'" 'only HERMES_* keys' "a POSTGRES_* interpolation"
node scripts/check-hermes-compose.mjs infra/hermes/docker-compose.yml 2>&1 | grep -q 'ANTHROPIC_API_KEY_2' &&
  ok "the committed file passes with the optional fallback key" || bad "the OK line does not name the fallback key"
grep -q '^  anthropic: fill_first$' infra/hermes/config.yaml && ok "config.yaml: anthropic pool strategy fill_first" || bad "config.yaml lacks credential_pool_strategies anthropic: fill_first"

echo "pool count line (hermes-deploy.sh --pool-line):"
out="$(printf 'anthropic (2 credentials):\n  #1  ANTHROPIC_API_KEY api_key id=ab priority=0 env:ANTHROPIC_API_KEY <-\n  #2  ANTHROPIC_API_KEY_2 api_key id=cd priority=1 env:ANTHROPIC_API_KEY_2\n' | bash scripts/hermes-deploy.sh --pool-line)"
[ "$out" = "anthropic credential pool: 2 entries" ] && ok "two entries: the count only, no note" || bad "two entries: $out"
out="$(printf 'anthropic (1 credentials):\n  #1  ANTHROPIC_API_KEY api_key id=ab priority=0 env:ANTHROPIC_API_KEY <-\n' | bash scripts/hermes-deploy.sh --pool-line)"
{ grep -qx 'anthropic credential pool: 1 entries' <<<"$out" && grep -q '^note: 1 entry' <<<"$out" && ! grep -q 'ANTHROPIC_API_KEY \|id=' <<<"$out"; } &&
  ok "one entry: the count and the note, no key line" || bad "one entry: $out"
out="$(printf '' | bash scripts/hermes-deploy.sh --pool-line)"
[ "$out" = "anthropic credential pool: 0 entries" ] && ok "nothing listed: 0 entries" || bad "nothing listed: $out"

echo "allow-list (hermes-deploy.sh --check-env):"
envcase() { # <value> <expect ok|refused> <label>
  printf 'HERMES_ANTHROPIC_API_KEY=x
HERMES_TELEGRAM_BOT_TOKEN=y
HERMES_TELEGRAM_ALLOWED_USERS=%s
' "$1" >"$W/env"
  # (the fallback AI web key is never in this file: the deploy must not require it)
  local out rc
  out="$(HERMES_ENV_FILE="$W/env" bash scripts/hermes-deploy.sh --check-env 2>&1)"
  rc=$?
  if [ "$2" = ok ] && [ $rc -eq 0 ]; then ok "accepts $3"
  elif [ "$2" = refused ] && [ $rc -ne 0 ] && grep -q HERMES_TELEGRAM_ALLOWED_USERS <<<"$out" && ! grep -qF -- "$1" <<<"$out"; then ok "refuses $3, naming the key and not the value"
  else bad "$3: rc=$rc ($(tail -1 <<<"$out"))"; fi
}
envcase 123456789 ok "one numeric id"
envcase 123,456 ok "two ids"
envcase '@owner' refused "a username"
envcase '123;456' refused "a semicolon list"
envcase '123,' refused "a trailing comma"
envcase '123 456' refused "a space"

echo "firewall rules (hermes-firewall.sh --print):"
out="$(HERMES_BRIDGES='br-0123456789ab' bash scripts/hermes-firewall.sh --print 2>&1)"
for want in '-A HERMES-NO-HOST -i br-0123456789ab -j DROP' \
'-A HERMES-NO-LAN -d 169.254.0.0/16 -i br-0123456789ab -j DROP'   '-A HERMES-NO-LAN -d 10.0.0.0/8 -i br-0123456789ab -j DROP'   '-A HERMES-NO-LAN -d 172.16.0.0/12 -i br-0123456789ab -j DROP'   '-A HERMES-NO-LAN -d 192.168.0.0/16 -i br-0123456789ab -j DROP'   '-A HERMES-NO-LAN -d 100.64.0.0/10 -i br-0123456789ab -j DROP'   '-A HERMES-NO-LAN -d 0.0.0.0/8 -i br-0123456789ab -j DROP'; do
  if grep -qxF -- "$want" <<<"$out"; then ok "writes: $want"; else bad "does not write: $want"; fi
done
out="$(HERMES_RESOLVERS='169.254.169.253 8.8.8.8 100.64.0.2' HERMES_BRIDGES='br-0123456789ab' bash scripts/hermes-firewall.sh --print 2>&1)"
for want in '-A HERMES-NO-LAN -d 169.254.169.253/32 -i br-0123456789ab -p udp -m udp --dport 53 -j ACCEPT' \
  '-A HERMES-NO-LAN -d 100.64.0.2/32 -i br-0123456789ab -p tcp -m tcp --dport 53 -j ACCEPT'; do
  if grep -qxF -- "$want" <<<"$out"; then ok "a resolver in a dropped range is let through: $want"; else bad "resolver rule missing: $want"; fi
done
if grep -q -- '8.8.8.8' <<<"$out"; then bad "a public resolver got an ACCEPT rule"; else ok "a public resolver gets no rule"; fi
first_accept="$(grep -n -- 'ACCEPT' <<<"$out" | head -1 | cut -d: -f1)"
first_drop="$(grep -n -- 'LAN -d 169.254.0.0/16' <<<"$out" | head -1 | cut -d: -f1)"
if [ -n "$first_accept" ] && [ "$first_accept" -lt "$first_drop" ]; then ok "the ACCEPTs come before the drops"; else bad "the ACCEPTs do not come before the drops"; fi
if [ "$(HERMES_BRIDGES='' bash scripts/hermes-firewall.sh --print | grep -c -- '-A ')" = 0 ]; then
  ok "no bridge, no rule (the chains are emptied)"
else
  bad "a rule is written with no bridge"
fi

echo "wiring:"
for f in scripts/hermes-deploy.sh scripts/hermes-firewall.sh scripts/hermes-ensure.sh; do
  if bash -n "$f"; then ok "$f parses"; else bad "$f does not parse"; fi
done
grep -q 'hermes)' .github/workflows/deploy.yml && grep -q 'hermes-stop)' .github/workflows/deploy.yml &&
  ok "deploy.yml resolves the modes hermes and hermes-stop" || bad "deploy.yml lacks the hermes modes"
grep -q 'hermes-ensure.sh --boot' scripts/install-host-cron.sh && grep -q 'scripts/hermes-ensure.sh >>' scripts/install-host-cron.sh &&
  ok "host cron runs the ensure script at boot and every 5 minutes" || bad "host cron does not run the ensure script"
grep -q 'hermes-ensure.sh' .github/workflows/deploy.yml && ok "deploy.yml checks the ensure script out" || bad "deploy.yml does not check out the ensure script"
grep -q 'HERMES_ANTHROPIC_API_KEY' .env.production.example &&
  ok ".env.production.example documents the keys" || bad ".env.production.example lacks the keys"

echo
if [ "$fails" -eq 0 ]; then echo "hermes.test.sh: all ok"; else echo "hermes.test.sh: $fails FAILED"; fi
exit "$fails"
