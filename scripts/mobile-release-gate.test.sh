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

# An abbreviated SHA must resolve to the same answer. `gh run list --commit` matches only
# the full 40 characters, so without normalising, a hand-run release would be refused with
# "nothing has tested this commit" about a commit CI had passed.
mkstub success
[ "$(rc "${MAIN_SHA:0:8}")" = 0 ] && ok "an abbreviated SHA is normalised, not refused" ||
  bad "an abbreviated SHA must be resolved to the full one before the CI lookup"

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

# ---------------------------------------------------------------------------
# M3b — the guard was bolted to the wrong job, so every released AAB was blind.
#
# `check-workflows.mjs` already proves that SOME step in mobile.yml refuses an empty
# SENTRY_DSN_MOBILE. It never asks WHICH job, and the answer was `testable` — the only path
# that produces an installable APK — while `bundle`, the path that signs the AAB and hands
# it to Play, read the same variable with nothing checking it. Measured 2026-08-25:
# `gh variable list` does not return SENTRY_DSN_MOBILE. So the guard blocked every test
# build, and every released binary inlined an empty NEXT_PUBLIC_SENTRY_DSN — permanently,
# because `NEXT_PUBLIC_*` is frozen into the export at build time.
#
# Read straight out of the workflow rather than from a copy of its rules here: a rule
# restated in a test is a rule that drifts. Steps open with `- ` at six spaces and jobs at
# two, which is all the structure needed to answer "which job" — no YAML parser, no network.
YML="$ROOT/.github/workflows/mobile.yml"
echo "mobile.yml release guards:"

job() { awk -v want="  $1:" '$0==want{on=1;next} on && /^  [a-zA-Z]/{exit} on' "$YML"; }

# Exit 0 when job $1 has a single step that both reads $2 and hard-exits over it.
guards() {
  job "$1" | awk -v v="$2" '
    /^      - / { if (reads && stops) found=1; reads=0; stops=0 }
    $0 ~ v && $0 !~ /^ *#/ { reads=1 }
    /exit 1/ { stops=1 }
    END { if (reads && stops) found=1; exit found ? 0 : 1 }'
}

[ -n "$(job bundle)" ] && [ -n "$(job testable)" ] ||
  bad "mobile.yml has no 'bundle' and 'testable' pair any more — these checks are reading nothing"

guards bundle SENTRY_DSN_MOBILE && ok "the release job refuses an empty SENTRY_DSN_MOBILE" ||
  bad "'bundle' builds the AAB it uploads to Play without checking SENTRY_DSN_MOBILE"

guards testable SENTRY_DSN_MOBILE &&
  bad "'testable' hard-exits on SENTRY_DSN_MOBILE, so no APK can be built for a real phone" ||
  ok "the testable job may build an APK with no DSN"

# The same shape, one step further along. build.gradle attaches the release signingConfig on
# `hydromartKeystore.exists()` alone (mobile/android/app/build.gradle), and the passwords come
# from `System.getenv`, which is null when the secret is unset. AGP names an unsigned bundle
# `app-release.aab` exactly like a signed one, so the `mv`, the permission audit and the
# artifact upload all succeed and the run is green. Play is the first thing that says no.
for secret in ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD; do
  guards bundle "$secret" && ok "the release job refuses an empty $secret" ||
    bad "'bundle' signs with \$$secret without checking it is set"
done

# A release that uploaded NOTHING must not read like one that did. The gate in `publish` is a
# deliberate opt-in and stays that way — measured 2026-08-29, `gh secret list` does not return
# PLAY_SERVICE_ACCOUNT_JSON, so every tag today skips both upload steps and the job goes green
# with the AABs sitting in an artifact (docs/MOBILE_PLAY_STORE.md:615 says that is the intent).
# The behaviour is right; the volume was not. `::notice::` is the quietest annotation GitHub
# has and does not surface on the run summary, so "tagged, all green" and "tagged, published"
# looked identical from the outside.
grep -q '::warning::PLAY_SERVICE_ACCOUNT_JSON' <<<"$(job publish)" &&
  ok "a release that publishes nothing says so where it can be seen" ||
  bad "'publish' skips the upload without a visible annotation — a green tag looks published"

if [ "$fails" -ne 0 ]; then
  echo "mobile-release-gate.sh: $fails check(s) failed" >&2
  exit 1
fi
echo "mobile-release-gate.sh: all checks passed"
