#!/usr/bin/env bash
# Self-check for scripts/mobile-release-gate.sh. Runs in CI beside the other shell self-checks.
#
#   bash scripts/mobile-release-gate.test.sh
#
# The gate decides whether a signed, publishable AAB gets built, so every branch is pinned
# here. `mobile.yml` fires on `push: tags: ['mobile-v*']` from ANY commit on ANY branch,
# and its `bundle` job runs no typecheck, no lint, no unit test and no export suite. So a
# tag on a commit that never passed one test still produced — and published — a signed
# bundle. docs/MOBILE_PLAY_STORE.md:411-424 records that a stale AAB has already gone out
# twice. This is the gate that makes that impossible, and these are its rules:
#
#   1. the tagged commit must be an ancestor of main — no releasing off a side branch
#   2. CI must have concluded `success` for that exact SHA — not "a run exists", not
#      "some run on the branch passed": that SHA, that conclusion
#
# The CI lookup is injected as a command so this test never touches the network.
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
GATE="$ROOT/scripts/mobile-release-gate.sh"

fails=0
ok() { echo "  ok   $1"; }
bad() {
  echo "  FAIL $1"
  fails=$((fails + 1))
}

echo "mobile-release-gate.sh:"

[ -f "$GATE" ] || {
  echo "  FAIL scripts/mobile-release-gate.sh does not exist"
  exit 1
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# A throwaway repo with a real main and a real side branch, so the ancestry check is
# answered by git itself rather than by a stub that could agree with a wrong implementation.
REPO="$TMP/repo"
mkdir -p "$REPO"
(
  cd "$REPO" || exit 1
  git init -q -b main
  git config user.email t@t && git config user.name t && git config core.autocrlf false
  echo one >f && git add f && git commit -qm one
  MAIN_SHA="$(git rev-parse HEAD)"
  git checkout -q -b side
  echo two >f && git commit -qam two
  SIDE_SHA="$(git rev-parse HEAD)"
  git checkout -q main
  echo "$MAIN_SHA" >"$TMP/main-sha"
  echo "$SIDE_SHA" >"$TMP/side-sha"
)
MAIN_SHA="$(cat "$TMP/main-sha")"
SIDE_SHA="$(cat "$TMP/side-sha")"

# The CI-conclusion probe, stubbed. $1 is the sha; it prints a conclusion and exits 0.
mkstub() {
  printf '#!/usr/bin/env bash\necho "%s"\n' "$1" >"$TMP/probe"
  chmod +x "$TMP/probe"
}

run() { (cd "$REPO" && CI_CONCLUSION_CMD="$TMP/probe" bash "$GATE" "$1" main 2>&1); }
rc() { (cd "$REPO" && CI_CONCLUSION_CMD="$TMP/probe" bash "$GATE" "$1" main >/dev/null 2>&1); echo $?; }

mkstub success
[ "$(rc "$MAIN_SHA")" = 0 ] && ok "an ancestor of main with green CI passes" ||
  bad "an ancestor of main with green CI must pass"

mkstub success
[ "$(rc "$SIDE_SHA")" != 0 ] && ok "a commit that is not an ancestor of main is refused" ||
  bad "a side-branch commit must be refused even when its CI is green"
case "$(run "$SIDE_SHA")" in
  *ancestor*) ok "the refusal says the commit is not an ancestor of main" ;;
  *) bad "the refusal must name ancestry as the reason" ;;
esac

mkstub failure
[ "$(rc "$MAIN_SHA")" != 0 ] && ok "a red CI is refused" || bad "a red CI must be refused"

# The dangerous one: no run at all reads as "nothing failed" to anything that only checks
# for the string `failure`. A tag pushed before CI even started must not build.
mkstub ''
[ "$(rc "$MAIN_SHA")" != 0 ] && ok "no CI run at all is refused" ||
  bad "a SHA with no CI run must be refused, not treated as green"

# `cancelled` and `skipped` are not success either, and they are what a cancelled queue
# leaves behind.
for c in cancelled skipped neutral; do
  mkstub "$c"
  [ "$(rc "$MAIN_SHA")" != 0 ] && ok "CI conclusion '$c' is refused" ||
    bad "CI conclusion '$c' must be refused"
done

if [ "$fails" -ne 0 ]; then
  echo "mobile-release-gate.sh: $fails check(s) failed" >&2
  exit 1
fi
echo "mobile-release-gate.sh: all checks passed"
