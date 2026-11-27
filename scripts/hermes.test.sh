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
refuses extrasvc "doc.services.other = {image: 'x@sha256:0000000000000000000000000000000000000000000000000000000000000000'}" 'exactly one service' "a second service"

echo "firewall rules (hermes-firewall.sh --print):"
out="$(HERMES_BRIDGES='br-0123456789ab' bash scripts/hermes-firewall.sh --print 2>&1)"
for want in '-A HERMES-NO-HOST -i br-0123456789ab -j DROP' \
  '-A HERMES-NO-LAN -i br-0123456789ab -d 169.254.0.0/16 -j DROP' \
  '-A HERMES-NO-LAN -i br-0123456789ab -d 10.0.0.0/8 -j DROP' \
  '-A HERMES-NO-LAN -i br-0123456789ab -d 172.16.0.0/12 -j DROP' \
  '-A HERMES-NO-LAN -i br-0123456789ab -d 192.168.0.0/16 -j DROP'; do
  if grep -qxF -- "$want" <<<"$out"; then ok "writes: $want"; else bad "does not write: $want"; fi
done
if [ "$(HERMES_BRIDGES='' bash scripts/hermes-firewall.sh --print | grep -c -- '-A ')" = 0 ]; then
  ok "no bridge, no rule (the chains are emptied)"
else
  bad "a rule is written with no bridge"
fi

echo "wiring:"
for f in scripts/hermes-deploy.sh scripts/hermes-firewall.sh; do
  if bash -n "$f"; then ok "$f parses"; else bad "$f does not parse"; fi
done
grep -q 'hermes)' .github/workflows/deploy.yml && grep -q 'hermes-stop)' .github/workflows/deploy.yml &&
  ok "deploy.yml resolves the modes hermes and hermes-stop" || bad "deploy.yml lacks the hermes modes"
grep -q 'scripts/hermes-firewall.sh' scripts/install-host-cron.sh &&
  ok "host cron runs the firewall" || bad "host cron does not run the firewall"
grep -q 'HERMES_ANTHROPIC_API_KEY' .env.production.example &&
  ok ".env.production.example documents the keys" || bad ".env.production.example lacks the keys"

echo
if [ "$fails" -eq 0 ]; then echo "hermes.test.sh: all ok"; else echo "hermes.test.sh: $fails FAILED"; fi
exit "$fails"
