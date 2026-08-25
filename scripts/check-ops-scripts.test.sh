#!/usr/bin/env bash
# The runnable check for N13/N14: both ops scripts must FAIL when the thing they watch is
# wrong, and pass when it is right. Written because a check that cannot go red is the exact
# failure class both of them exist to close — see the twenty green checks that proved
# nothing before them.
#
#   bash scripts/check-ops-scripts.test.sh
set -euo pipefail
cd "$(dirname "$0")/.."
fails=0

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "ok   $label"
  else
    echo "FAIL $label (expected exit $expected, got $actual)"
    fails=1
  fi
}

run() {
  set +e
  "$@" >/dev/null 2>&1
  local code=$?
  set -e
  echo "$code"
}

# --- N13: a domain that cannot present a certificate must be reported, not skipped ------
# `.invalid` is reserved by RFC 2606 and never resolves, so this asserts the "no certificate
# at all" branch without depending on the network being up.
check "tls: unreachable host is a failure" 1 "$(run bash scripts/check-tls-expiry.sh nothing.invalid)"

# A deploy with no domains at all (bare IP) has no certificate to watch; saying so beats a
# green check that measured nothing.
check "tls: no domains is not a failure" 0 "$(WEB_DOMAIN= API_DOMAIN= run bash scripts/check-tls-expiry.sh)"

# --- N14: the log-retention check must fail when the daemon is not configured -----------
# No docker (or no hydromart-gateway container) is exactly the state a fresh host is in, and
# it must be reported rather than passed.
check "logs: unconfigured host is a failure" 1 "$(run bash scripts/check-log-retention.sh)"

exit "$fails"
