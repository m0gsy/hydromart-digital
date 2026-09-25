#!/usr/bin/env bash
# Move the HOST's Node from 20 to 22. The containers already run 22; the host runs the cron jobs
# (backup-objects.mjs, the migrations, the deploy probes) and was v20.20.2 when asked on
# 2026-09-25. Node 20 reached end of life on 30 April 2026, and AWS SDK v3 stops supporting it in
# January 2027 — after which the nightly object backup would fail on the box that runs it.
#
#   bash scripts/install-host-node.sh          # upgrade (a no-op when the host is already on 22+)
#
# How: Node here came from the NodeSource apt repository (dpkg owns /usr/bin/node). That repo is one
# line, `deb ... /node_20.x nodistro main`, and every major version lives behind the same signing
# key — so the change is to say `node_22.x` in that line and let apt do the rest. No remote script
# is downloaded and executed, and no second copy of node is put beside the first.
#
# It refuses, rather than guesses, when node did NOT come from NodeSource (no such repo file, or
# a line it does not recognise), and when passwordless sudo is not available.
#
# Reversible: the repo file and the old package version are recorded first, and if the install
# fails or the new node is not 22+, the file is put back and the old version reinstalled.
# Idempotent: on 22 or newer it changes nothing.
set -euo pipefail

WANT="${WANT_NODE_MAJOR:-22}"
LIST="${NODESOURCE_LIST:-/etc/apt/sources.list.d/nodesource.list}"
SUDO="${SUDO:-sudo -n}"

major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

have="$(major)"
if [ "$have" -ge "$WANT" ]; then
  echo "host node is already $(node -v) — nothing to do"
  exit 0
fi

if ! $SUDO true 2>/dev/null; then
  echo "!! passwordless sudo is not available for $(id -un); run this as root or add a sudoers rule" >&2
  exit 2
fi
if [ ! -f "$LIST" ]; then
  echo "!! $LIST does not exist — node did not come from NodeSource, so this script cannot say how to upgrade it." >&2
  exit 2
fi
if ! grep -qE '/node_[0-9]+\.x' "$LIST"; then
  echo "!! $LIST has no node_<major>.x line I recognise; refusing to edit it:" >&2
  sed 's/^/     /' "$LIST" >&2
  exit 2
fi

OLD_VERSION="$(dpkg-query -W -f='${Version}' nodejs 2>/dev/null || true)"
BACKUP="$(mktemp)"
cp "$LIST" "$BACKUP"
echo "host node $(node -v) (nodejs $OLD_VERSION) -> ${WANT}.x via $LIST"

restore() {
  echo "!! putting the old NodeSource line back${OLD_VERSION:+ and reinstalling nodejs $OLD_VERSION}" >&2
  $SUDO cp "$BACKUP" "$LIST"
  $SUDO apt-get update -qq || true
  [ -n "$OLD_VERSION" ] && $SUDO apt-get install -y -qq --allow-downgrades "nodejs=$OLD_VERSION" || true
}

$SUDO sed -i -E "s#/node_[0-9]+\.x#/node_${WANT}.x#" "$LIST"

if ! $SUDO apt-get update -qq; then
  restore
  echo "!! apt-get update failed" >&2
  exit 1
fi
if ! $SUDO apt-get install -y -qq nodejs; then
  restore
  echo "!! apt-get install nodejs failed" >&2
  exit 1
fi

hash -r
now="$(major)"
if [ "$now" -lt "$WANT" ]; then
  restore
  echo "!! after the install node reports $(node -v 2>/dev/null || echo nothing), not ${WANT}.x" >&2
  exit 1
fi

rm -f "$BACKUP"
echo "host node is now $(node -v), npm $(npm -v 2>/dev/null || echo '?')"
echo "Next: run the object backup once (Deploy -> backup-objects) to prove the cron job's runtime."
