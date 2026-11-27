#!/usr/bin/env bash
# Hermes Agent's docker network, shut to the box and to everything private (owner decision, 27 Nov
# 2026; infra/hermes/docker-compose.yml). The `hermes` network is not internal (Telegram and the LLM
# provider are on the internet), so the way off it is closed here instead:
#
#   bash scripts/hermes-firewall.sh          # close it; says nothing when it already is
#   bash scripts/hermes-firewall.sh --print  # the rules it would hold for HERMES_BRIDGES; no root, no docker
#
# Two chains of its own, each reached by ONE jump, and nothing else of the box's rules touched:
#   HERMES-NO-HOST  in INPUT:       `-i <bridge> -j DROP`. Everything addressed to the box itself from that
#                   bridge: ssh, the docker API, exporters, postgres, and the box's own public address (the
#                   box holds it on eth0, so such a packet is local delivery and never leaves it).
#   HERMES-NO-LAN   in DOCKER-USER: `-i <bridge> -d <range> -j DROP` for 169.254.0.0/16 (the cloud
#                   metadata service), 10.0.0.0/8, 172.16.0.0/12 and 192.168.0.0/16: other containers (also
#                   those a published port would DNAT to, which DOCKER-USER sees after the rewrite) and the
#                   provider's private network. The internet (Telegram, api.anthropic.com) is untouched.
# Docker's embedded DNS (127.0.0.11) keeps working: that address lives inside the container's own network
# namespace, where Docker redirects it to the daemon's resolver, so the packet never reaches the host's INPUT
# or FORWARD chains these rules sit in. A container resolves names, then reaches the internet through eth0.
#
# The jump into INPUT is only required to EXIST once, not to be first: scripts/aiweb-firewall.sh insists on
# being rule 1 of INPUT and moves itself there on every run, so insisting too would make the two fight. The two
# drop different bridges, so their order does not matter.
#
# Kept: the kernel forgets the rules at a reboot and a network made again gets a new bridge, so cron runs this
# at boot and every 5 minutes (scripts/install-host-cron.sh) and the deploy before the container starts
# (scripts/hermes-deploy.sh). The bridges of the last run that had docker's answer are saved in
# .deploy/hermes-firewall.bridges and used when docker does not answer (at boot). At boot DOCKER-USER may not
# exist yet (docker makes it); the INPUT half is written, the other half by the next run, and the deploy's own
# run always has both (the container starts only after it).
#
# Root through `sudo -n` like aiweb-firewall.sh. Without it: nothing written, a `!!` line, one alert, exit 1.
# Undo: sudo iptables -D INPUT -j HERMES-NO-HOST; sudo iptables -D DOCKER-USER -j HERMES-NO-LAN; then -F and -X
# both chains (and take out the cron lines and the deploy's call by reverting the PR that brought this file).
#
# Exit: 0 closed (just now, or already) · 1 not closed, or not known to be (alerted once).
set -euo pipefail
cd "$(dirname "$0")/.."

HOST_CHAIN=HERMES-NO-HOST
LAN_CHAIN=HERMES-NO-LAN
RANGES=(169.254.0.0/16 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16)
SAVED=.deploy/hermes-firewall.bridges

# The rules as `iptables -S` prints them, for the bridges given.
host_rules() { # <bridge>...
  local br out="-N $HOST_CHAIN"
  for br in "$@"; do out+=$'\n'"-A $HOST_CHAIN -i $br -j DROP"; done
  printf '%s' "$out"
}
lan_rules() { # <bridge>...
  local br r out="-N $LAN_CHAIN"
  for br in "$@"; do for r in "${RANGES[@]}"; do out+=$'\n'"-A $LAN_CHAIN -i $br -d $r -j DROP"; done; done
  printf '%s' "$out"
}

if [ "${1:-}" = --print ]; then
  # shellcheck disable=SC2086 # a list of bridges
  { host_rules ${HERMES_BRIDGES:-}; echo; lan_rules ${HERMES_BRIDGES:-}; echo; }
  exit 0
fi

# shellcheck source=scripts/lib/deploy-common.sh
. scripts/lib/deploy-common.sh

say() { echo "[hermes-firewall] $*"; }
fail() {
  say "!! $1"
  alert_once hermes-firewall "the host may be reachable from Hermes: $(printf '%s' "$1" | tr -cd '[:alnum:] .,:;=()/_+@-' | cut -c1-300)"
  exit 1
}

mkdir -p .deploy
exec 8>>.deploy/hermes-firewall.lock
flock -w 60 8 || fail "could not lock .deploy/hermes-firewall.lock within 60 seconds (another run holds it, or flock is missing)"

PROJECT="$(sed -n 's/^name: *//p' infra/hermes/docker-compose.yml 2>/dev/null | tr -d "\"' \r" || true)"
[[ "$PROJECT" =~ ^[a-z0-9][a-z0-9_-]*$ ]] && [ "$PROJECT" != hydromart ] ||
  fail "'$PROJECT' (the name: line of infra/hermes/docker-compose.yml) is not a project of its own, so Hermes' network is unknown"

bridges=''
named=''
from=''
if nets="$(timeout 30 docker network ls --format '{{.ID}} {{.Name}} {{.Label "com.docker.compose.project"}}' 2>&1)"; then
  while read -r id name project; do
    [ "$project" = "$PROJECT" ] || continue
    [[ "$id" =~ ^[0-9a-f]{12}$ ]] || fail "docker gave network $name the id '$id', not 12 hex characters"
    bridges+=" br-$id"
    named+=" $name=br-$id"
  done < <(LC_ALL=C sort <<<"$nets")
elif [ -s "$SAVED" ]; then
  from=", from the bridges the last run saved: docker is not answering ($(tail -1 <<<"$nets"))"
  while IFS='=' read -r name br; do
    [ -n "$name" ] && [[ "$br" =~ ^br-[0-9a-f]{12}$ ]] || fail "$SAVED holds '$name=$br', not a network and its bridge"
    bridges+=" $br"
    named+=" $name=$br"
  done <"$SAVED"
else
  fail "docker did not list its networks ($(tail -1 <<<"$nets")) and no bridges were saved, so the rules were left as they were"
fi

# shellcheck disable=SC2086 # a list of bridges
want_host="$(host_rules $bridges)"
# shellcheck disable=SC2086
want_lan="$(lan_rules $bridges)"

# Read as root first: a refusal there is sudo's, and nothing has been written yet.
have="$(sudo -n iptables -w -S 2>&1)" ||
  fail "sudo -n iptables -S failed ($(tail -1 <<<"$have")): the deploy user needs passwordless sudo for iptables"
wrote=''

# Rewrite the chain when it differs from what is wanted, and make sure exactly ONE jump to it exists.
sync_chain() { # <chain> <want> <parent>
  local chain="$1" want="$2" parent="$3" rule copies
  if [ "$(awk -v c="$chain" '($1 == "-N" || $1 == "-A") && $2 == c' <<<"$have")" != "$want" ]; then
    sudo -n iptables -w -N "$chain" 2>/dev/null || sudo -n iptables -w -F "$chain" || fail "could not make or empty the $chain chain"
    while IFS= read -r rule; do
      [ -n "$rule" ] && [ "${rule#-N}" = "$rule" ] || continue
      # shellcheck disable=SC2086 # the rule's words, as -S printed them
      sudo -n iptables -w $rule || fail "could not add '$rule'"
    done <<<"$want"
    wrote+=" $chain"
  fi
  copies="$(awk -v j="-A $parent -j $chain" '$0 == j { n++ } END { print n + 0 }' <<<"$have")"
  if [ "$copies" != 1 ]; then
    while sudo -n iptables -w -C "$parent" -j "$chain" 2>/dev/null; do
      sudo -n iptables -w -D "$parent" -j "$chain" || fail "could not take a copy of the jump to $chain out of $parent"
    done
    sudo -n iptables -w -I "$parent" 1 -j "$chain" || fail "could not put the jump to $chain into $parent"
    wrote+=" $parent"
  fi
}

sync_chain "$HOST_CHAIN" "$want_host" INPUT
if grep -q '^-[NA] DOCKER-USER\b' <<<"$have"; then
  sync_chain "$LAN_CHAIN" "$want_lan" DOCKER-USER
elif [ -z "$from" ]; then
  fail "docker answers but has no DOCKER-USER chain, so Hermes' way to the private ranges was not closed"
else
  say "DOCKER-USER does not exist yet (docker is starting): the private ranges are closed by the next run"
fi

# shellcheck disable=SC2086 # one name=bridge per line
if [ -z "$from" ] && [ "$(cat "$SAVED" 2>/dev/null)" != "$(printf '%s\n' $named)" ]; then
  printf '%s\n' $named | sed '/^$/d' >"$SAVED.new" && mv "$SAVED.new" "$SAVED"
fi
[ -z "$wrote" ] || say "the box and the private ranges now dropped from:${named:- (no Hermes network)} (wrote${wrote})$from"
alert_clear hermes-firewall
