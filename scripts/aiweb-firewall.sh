#!/usr/bin/env bash
# The host's ssh (TCP 22), closed to the AI web's docker networks: the owner's decision of
# 24 November 2026. Those networks are `edge` (Caddy and the app; hydromart's compose file makes
# it) and every network compose makes for the AI web's project (`private`, n8n's `egress`). SSH
# from anywhere else, the internet included, is left exactly as it was.
#
# D3 staging: the AI web's staging copy (its own compose project, infra/aiweb-staging/) is closed
# the same way: `edge-staging` (the internal network hydromart's compose file makes so Caddy can
# reach it) and every network of the project named by STAGING_PROJECT (hydromart-ai-staging).
# They are listed beside the others when they exist and add nothing when they do not.
#
#   bash scripts/aiweb-firewall.sh   # close it; says nothing when it already is
#
# How: a chain of its own, AIWEB-NO-SSH, holding `-i <bridge> -j DROP` for each of those networks'
# bridges (br- and the first 12 characters of the network's id), and ONE rule in INPUT, first:
# `-p tcp --dport 22 -j AIWEB-NO-SSH`. No other INPUT rule, and none of Docker's chains, is
# touched. A packet is matched by the bridge it comes in on, so every address of the host is
# closed to it at once: each network's gateway, hydromart's and docker0's, and the public address
# the AI web reaches hydromart by (the box holds that address on eth0, so the packet never leaves
# it). SSH from outside comes in on eth0 and passes the chain untouched.
#
# IPv4 only, on purpose: the three networks are IPv4-only, and Docker turns IPv6 off on a
# container's interface on such a network (disable_ipv6=1, no address at all: measured on Docker
# 29.7.2; the box runs 29.7.1), so there is no IPv6 way to the host to close. A network with IPv6
# on is still closed over IPv4 like the others, then reported: `!!`, an alert, exit 1.
#
# Kept: the kernel forgets all of it at a reboot, and a network made again gets a new bridge. So
# host cron runs this at boot and every 5 minutes (scripts/install-host-cron.sh), and every AI web
# deploy once its networks are made and before any of its containers starts on them
# (scripts/aiweb-deploy.sh). The chain is rewritten only when it differs, and the jump put back
# first, once, when it is not first or not alone. A run that has docker's answer saves the
# bridges it wrote in .deploy/aiweb-firewall.bridges; a run without one (at boot, before docker
# is up) writes those: a network keeps its id, and so its bridge's name, across a reboot. The
# probe in aiweb-deploy.sh proves it after each deploy: port 22 answering at the gateway of any
# network the app or n8n is on, or at the public address, from inside either container, fails it.
#
# Root through `sudo -n`: the deploy user's passwordless sudo, which install-host-cron.sh and the
# install-host-* scripts already use. Without it: nothing written, a `!!` line on every run, one
# alert (alert_once), exit 1; the probe then keeps the finding open.
#
# Check, on the box:  bash scripts/aiweb-deploy.sh --probe   (host-ssh ... -> closed)
#                     sudo iptables -S AIWEB-NO-SSH; sudo iptables -S INPUT | head -2
# Undo: revert the PR that brought this file (the cron lines, the deploy's call and the probe's
# verdict go with it) and deploy, then on the box (or reboot):
#   sudo iptables -D INPUT -p tcp --dport 22 -j AIWEB-NO-SSH
#   sudo iptables -F AIWEB-NO-SSH && sudo iptables -X AIWEB-NO-SSH
#
# Exit: 0 closed (just now, or already) · 1 not closed, or not known to be (alerted once).
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib/deploy-common.sh
. scripts/lib/deploy-common.sh

CHAIN=AIWEB-NO-SSH
JUMP=(-p tcp --dport 22 -j "$CHAIN")
# The jump as `iptables -S` prints it, the same on nft and legacy.
JUMP_LINE="-A INPUT -p tcp -m tcp --dport 22 -j $CHAIN"
SAVED=.deploy/aiweb-firewall.bridges

say() { echo "[aiweb-firewall] $*"; }
fail() {
  say "!! $1"
  # alert() writes the text into JSON as it is: only plain characters may reach it.
  alert_once aiweb-firewall "host ssh may be reachable from the AI web: $(printf '%s' "$1" | tr -cd '[:alnum:] .,:;=()/_+@-' | cut -c1-300)"
  exit 1
}

# One run at a time (a deploy's, cron's, the boot's): each reads the rules before it writes them.
mkdir -p .deploy
exec 8>>.deploy/aiweb-firewall.lock
flock -w 60 8 || fail "could not lock .deploy/aiweb-firewall.lock within 60 seconds (another run holds it, or flock is missing)"

AI_PROJECT="${AI_PROJECT:-$(sed -n 's/^name: *//p' infra/aiweb/docker-compose.yml 2>/dev/null | tr -d "\"' \r" || true)}"
[[ "$AI_PROJECT" =~ ^[a-z0-9][a-z0-9_-]*$ ]] ||
  fail "'$AI_PROJECT' (the name: line of infra/aiweb/docker-compose.yml) is not a compose project name, so the AI web's networks are unknown"
# The staging project's name: its compose file's when this checkout has one, else the fixed one.
STAGING_PROJECT="${STAGING_PROJECT:-$(sed -n 's/^name: *//p' infra/aiweb-staging/docker-compose.yml 2>/dev/null | tr -d "\"' \r" || true)}"
STAGING_PROJECT="${STAGING_PROJECT:-hydromart-ai-staging}"
[[ "$STAGING_PROJECT" =~ ^[a-z0-9][a-z0-9_-]*$ ]] ||
  fail "'$STAGING_PROJECT' (the staging project's name) is not a compose project name, so the staging AI web's networks are unknown"

# The bridges. Docker's answer is what gets written, even one naming none of these networks (then
# there is nothing to close, and the chain is emptied). With no answer at all (the daemon down,
# when live-restore keeps the containers running, or not up yet at boot, when it is about to
# start them), the bridges the last run with an answer saved are written instead.
bridges=''
named=''
v6=''
from=''
if nets="$(timeout 30 docker network ls --format '{{.ID}} {{.IPv6}} {{.Name}} {{.Label "com.docker.compose.project"}}' 2>&1)"; then
  while read -r id ipv6 name project; do
    [ "$name" = edge ] || [ "$name" = edge-staging ] || [ "$project" = "$AI_PROJECT" ] || [ "$project" = "$STAGING_PROJECT" ] || continue
    [[ "$id" =~ ^[0-9a-f]{12}$ ]] || fail "docker gave network $name the id '$id', not 12 hex characters"
    [ "$ipv6" = false ] || v6+=" $name"
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
# The jump must be rule 1 of INPUT, and the only copy of itself: the first `-A INPUT` line `-S`
# printed above is rule 1. Otherwise every copy goes (-C matches it however it is printed) and it
# goes back in first, which also tidies a copy two racing runs once left.
first="$(awk '$1 == "-A" && $2 == "INPUT" { print; exit }' <<<"$have")"
copies="$(awk -v j="$JUMP_LINE" '$0 == j { n++ } END { print n + 0 }' <<<"$have")"
if [ "$first" != "$JUMP_LINE" ] || [ "$copies" != 1 ]; then
  while sudo -n iptables -w -C INPUT "${JUMP[@]}" 2>/dev/null; do
    sudo -n iptables -w -D INPUT "${JUMP[@]}" || fail "could not take a copy of the jump to $CHAIN out of INPUT"
  done
  sudo -n iptables -w -I INPUT 1 "${JUMP[@]}" || fail "could not put the jump to $CHAIN first in INPUT"
  wrote+=" INPUT"
fi

# Saved from docker's answer only, once written, and only when it changed.
# shellcheck disable=SC2086 # one name=bridge per line
if [ -z "$from" ] && [ "$(cat "$SAVED" 2>/dev/null)" != "$(printf '%s\n' $named)" ]; then
  printf '%s\n' $named | sed '/^$/d' >"$SAVED.new" && mv "$SAVED.new" "$SAVED"
fi
[ -z "$wrote" ] || say "TCP 22 now dropped from:${named:- (no AI web network)} (wrote${wrote})$from"
[ -z "$v6" ] || fail "IPv6 is on for:$v6, and only IPv4 is closed to them (TCP 22 is dropped from all the networks over IPv4)"
alert_clear aiweb-firewall
