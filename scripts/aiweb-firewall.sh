#!/usr/bin/env bash
# The host's ssh (TCP 22), closed to the AI web's docker networks: the owner's decision of
# 24 November 2026. Those networks are `edge` (Caddy and the app; hydromart's compose file makes
# it) and every network compose makes for the AI web's project (`private`, n8n's `egress`). SSH
# from anywhere else, the internet included, is left exactly as it was.
#
#   bash scripts/aiweb-firewall.sh   # close it; says nothing when it already is
#
# How: a chain of its own, AIWEB-NO-SSH, holding `-i <bridge> -j DROP` for each of those networks'
# bridges (br- and the first 12 characters of the network's id), and ONE rule in INPUT, first:
# `-p tcp --dport 22 -j AIWEB-NO-SSH`. No other INPUT rule, and none of Docker's chains, is
# touched. A packet is matched by the bridge it comes in on, so every address of the host is
# closed to it at once: each network's gateway, hydromart's and docker0's, and the public address
# the AI web reaches hydromart by (the box holds that address, so the packet never leaves it).
# SSH from outside comes in on the box's own interface and passes the chain untouched.
#
# IPv4 only, on purpose: the three networks are IPv4-only, and Docker turns IPv6 off on a
# container's interface on such a network (disable_ipv6=1, no address at all: measured on Docker
# 29.7), so there is no IPv6 way to the host to close. A network with IPv6 on is refused below.
#
# Kept: the kernel forgets all of it at a reboot, and a network made again gets a new bridge. So
# every AI web deploy runs this just before its probe (scripts/aiweb-deploy.sh), host cron every 5
# minutes (scripts/install-host-cron.sh), and the chain is rewritten only when it differs. The
# probe proves it after each deploy: port 22 answering, at the gateway of any network the app or
# n8n is on or at the public address, from inside either container, fails it.
#
# Root through `sudo -n`: the deploy user's passwordless sudo, which install-host-cron.sh and the
# install-host-* scripts already use. Without it: a `!!` line saying so, one alert, exit 1, and
# nothing written; the probe then keeps the finding open.
#
# Check, on the box:  bash scripts/aiweb-deploy.sh --probe   (host-ssh ... -> closed)
#                     sudo iptables -S AIWEB-NO-SSH; sudo iptables -S INPUT | head -3
# Undo: revert the PR that brought this file (the cron line, the deploy's call and the probe's
# verdict go with it) and deploy, then on the box (or reboot):
#   sudo iptables -D INPUT -p tcp --dport 22 -j AIWEB-NO-SSH
#   sudo iptables -F AIWEB-NO-SSH && sudo iptables -X AIWEB-NO-SSH
#
# Exit: 0 closed (just now, or already) · 1 not closed, or not known to be (alerted once).
#
# ponytail: no lock. A deploy's run racing cron's can at worst leave a rule in twice, which drops
# the same packets; the next rewrite of the chain tidies it.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib/deploy-common.sh
. scripts/lib/deploy-common.sh

CHAIN=AIWEB-NO-SSH
JUMP=(-p tcp --dport 22 -j "$CHAIN")
AI_PROJECT="${AI_PROJECT:-$(sed -n 's/^name: *//p' infra/aiweb/docker-compose.yml | tr -d "\"' \r")}"

say() { echo "[aiweb-firewall] $*"; }
fail() {
  say "!! $1"
  # alert() writes the text into JSON as it is: only plain characters may reach it.
  alert_once aiweb-firewall "host ssh may be reachable from the AI web: $(printf '%s' "$1" | tr -cd '[:alnum:] .,:;=()/_+@-' | cut -c1-300)"
  exit 1
}

# The bridges, read from docker every time. Its answer, never an empty one, is what gets written:
# with the daemon down (live-restore keeps the containers running) the rules stay as they are.
nets="$(docker network ls --format '{{.ID}} {{.IPv6}} {{.Name}} {{.Label "com.docker.compose.project"}}' 2>&1)" ||
  fail "docker did not list its networks ($(tail -1 <<<"$nets")), so the rules were left as they were"
bridges=''
named=''
while read -r id ipv6 name project; do
  [ "$name" = edge ] || [ "$project" = "$AI_PROJECT" ] || continue
  [[ "$id" =~ ^[0-9a-f]{12}$ ]] || fail "docker gave network $name the id '$id', not 12 hex characters"
  [ "$ipv6" = false ] || fail "network $name has IPv6 on, and this closes IPv4 only"
  bridges+=" br-$id"
  named+=" $name=br-$id"
done < <(LC_ALL=C sort <<<"$nets")

# What `iptables -S` prints for the chain as it should be.
want="-N $CHAIN"
for br in $bridges; do
  want+="
-A $CHAIN -i $br -j DROP"
done

# Read as root first: a refusal there is sudo's, and nothing has been written yet.
have="$(sudo -n iptables -w -S 2>&1)" ||
  fail "sudo -n iptables -S failed ($(tail -1 <<<"$have")): the deploy user needs passwordless sudo for iptables"
wrote=''
if [ "$(awk -v c="$CHAIN" '($1 == "-N" || $1 == "-A") && $2 == c' <<<"$have")" != "$want" ]; then
  sudo -n iptables -w -N "$CHAIN" 2>/dev/null || sudo -n iptables -w -F "$CHAIN" ||
    fail "could not make or empty the $CHAIN chain"
  for br in $bridges; do
    sudo -n iptables -w -A "$CHAIN" -i "$br" -j DROP || fail "could not add the rule for $br to $CHAIN"
  done
  wrote+=" $CHAIN"
fi
# -C, not the text above: it matches the rule however iptables prints it, so the jump is never
# put in twice.
if ! sudo -n iptables -w -C INPUT "${JUMP[@]}" 2>/dev/null; then
  sudo -n iptables -w -I INPUT 1 "${JUMP[@]}" || fail "could not put the jump to $CHAIN first in INPUT"
  wrote+=" INPUT"
fi
[ -z "$wrote" ] || say "TCP 22 now dropped from:${named:- (no AI web network on this box)} (wrote${wrote})"
alert_clear aiweb-firewall
