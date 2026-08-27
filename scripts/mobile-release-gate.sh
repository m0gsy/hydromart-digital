#!/usr/bin/env bash
# Refuse to build a publishable Android bundle out of a commit that has not earned it.
#
#   bash scripts/mobile-release-gate.sh <sha> [branch]
#
# Why this exists: `mobile.yml` fires on `push: tags: ['mobile-v*']` — from any commit, on
# any branch — and its `bundle` job runs no typecheck, no lint, no unit test and no export
# suite. The real gates all live in `ci.yml`. So the one workflow that produces a SIGNED,
# uploadable artifact was the one workflow that checked nothing, and a tag on an unbuilt
# commit still shipped. docs/MOBILE_PLAY_STORE.md records a stale AAB going out twice.
#
# Rather than duplicate the gates here — which would drift, and would still be a subset —
# this asserts that the whole of CI already went green for this exact commit, and that the
# commit is on the line of development we release from.
#
# The CI lookup is a command so the self-check can run without a network. In the workflow
# it is `gh` reading the API; in the test it is a stub.
set -uo pipefail

SHA="${1:-}"
BRANCH="${2:-main}"
[ -n "$SHA" ] || {
  echo "usage: bash scripts/mobile-release-gate.sh <sha> [branch]" >&2
  exit 1
}

fail() {
  echo "release-gate: !! $*" >&2
  exit 1
}

# 1. Ancestry. `git merge-base --is-ancestor` answers "is this commit ON that branch's
# history", which is the question — not "does the branch contain a commit with this
# message", and not "is it reachable from some ref".
if ! FULL_SHA="$(git rev-parse --verify --quiet "$SHA^{commit}")"; then
  fail "$SHA is not a commit in this checkout — fetch it before releasing from it"
fi
# `gh run list --commit` matches ONLY the full 40-character SHA: an abbreviated one returns
# an empty list, which this script reads as "nothing has tested this commit" and refuses the
# release. The workflow passes `github.sha` and is fine, but a human running this by hand
# would be told their good commit was untested — and a gate that lies is a gate somebody
# switches off. Normalising here costs one line and removes the trap.
SHA="$FULL_SHA"
if ! git rev-parse --verify --quiet "$BRANCH^{commit}" >/dev/null; then
  fail "no branch '$BRANCH' in this checkout — cannot prove the tag descends from it"
fi
if ! git merge-base --is-ancestor "$SHA" "$BRANCH"; then
  fail "$SHA is not an ancestor of $BRANCH — release tags are cut from $BRANCH only"
fi

# 2. CI. Default probe: the newest CI run for this exact SHA. `--jq` prints nothing at all
# when there is no such run, and "nothing" must read as refusal, never as consent — that is
# the branch a tag pushed before CI starts would otherwise walk straight through.
PROBE="${CI_CONCLUSION_CMD:-}"
if [ -n "$PROBE" ]; then
  CONCLUSION="$("$PROBE" "$SHA" 2>/dev/null | tr -d '\r\n')"
else
  CONCLUSION="$(gh run list --workflow=ci.yml --commit "$SHA" --limit 1 \
    --json conclusion --jq '.[0].conclusion // empty' 2>/dev/null | tr -d '\r\n')"
fi

case "$CONCLUSION" in
  success) ;;
  '') fail "no CI run recorded for $SHA — nothing has tested this commit" ;;
  *) fail "CI concluded '$CONCLUSION' for $SHA — only 'success' may be released" ;;
esac

# 3. Push. `mobile/android/app/build.gradle` applies the google-services plugin only IF
# `google-services.json` is present, and when it is absent says so with `logger.info` —
# a level nobody sets, in a build that succeeds. So a release bundle could be signed,
# uploaded and installed with push that cannot work, and the only trace was a line no
# human or gate would ever read.
#
# That is the CMP-05 shape on the client side: the deploy probes the SERVER credentials
# now, and the server can hold perfectly good ones while the app on the phone was never
# built with a Firebase project at all. Both halves have to be there or nothing arrives.
#
# Presence only. The file is not a secret (it ships inside the APK), but it is not in the
# repo either, so this is a build-machine check, not a git one.
GS='mobile/android/app/google-services.json'
if [ ! -f "$GS" ]; then
  fail "$GS is missing — Gradle would skip the google-services plugin and this bundle would ship with Android push that cannot work. Download it from the Firebase console (see: node scripts/fcm-setup.mjs --help) and place it there."
fi
if ! grep -q '"project_id"' "$GS" 2>/dev/null; then
  fail "$GS does not look like a Firebase config (no project_id) — a placeholder file is worse than none, because the plugin applies and the push registration then fails at runtime"
fi

echo "release-gate: $SHA is on $BRANCH, CI passed for it, and the Firebase config is present — releasing"
