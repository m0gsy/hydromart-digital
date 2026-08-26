#!/usr/bin/env bash
#
# The one check branch protection should require. It exists because of a gap that was open
# in this repo and had already been walked through once:
#
#   Required contexts on `main` were verify, changes, image, sast, sbom, secrets.
#   `integration` and `e2e` were on NEITHER list — and both `needs: [verify, changes]`, so
#   they start only AFTER the required check has already gone green. The merge button turns
#   green while the two most end-to-end jobs in the repo are still running. Measured over
#   the last 25 merged PRs: 49 of 50 runs finished green before their merge, and #327 merged
#   53 seconds before its e2e finished. It happened to be green. Nothing checked.
#
# Adding `e2e` to the required contexts directly does NOT work, and that is the whole reason
# this script exists rather than a settings change. Both jobs are conditional on
# `changes.outputs.docker`, and a required check that gets SKIPPED leaves the PR blocked on a
# status that will never be reported. So the judgement cannot live in branch protection; it
# has to be a job that always runs and decides for itself whether a skip was earned.
#
# Which is the rule below: `skipped` is acceptable for the heavy jobs ONLY when `changes`
# said the diff does not touch docker. Everywhere else a skip is a failure, because GitHub
# reports a skipped job as successful and this file already carries one comment (at the
# `changes` job in ci.yml) about a run that concluded green having tested nothing.
#
# Self-check: scripts/ci-conclude.test.sh — proves every red path above can go red.
set -uo pipefail

docker=''
verify=''
integration=''
e2e=''
seen_docker=0

while [ $# -gt 0 ]; do
  case "$1" in
    --docker)      docker="${2-}";      seen_docker=1; shift 2 ;;
    --verify)      verify="${2-}";      shift 2 ;;
    --integration) integration="${2-}"; shift 2 ;;
    --e2e)         e2e="${2-}";         shift 2 ;;
    *) echo "ci-conclude: unknown argument '$1'" >&2; exit 1 ;;
  esac
done

# Every input must have been supplied. A missing `--e2e` used to be indistinguishable from
# an empty one, and an empty one compared false against every result name — which is to say
# it read as "not failed", which is to say it read as a pass.
missing=''
[ "$seen_docker" = 1 ] || missing="$missing --docker"
[ -n "$verify" ]       || missing="$missing --verify"
[ -n "$integration" ]  || missing="$missing --integration"
[ -n "$e2e" ]          || missing="$missing --e2e"
if [ -n "$missing" ]; then
  echo "ci-conclude: no answer for:$missing" >&2
  echo "             an absent result is not a passing one — refusing to conclude." >&2
  exit 1
fi

# `changes` exits 1 when ci-affected.sh answers nothing, but its output still reaches here as
# an empty string, and an unreadable instrument must never resolve to the permissive branch.
case "$docker" in
  true|false) ;;
  *)
    echo "ci-conclude: changes.outputs.docker='$docker' — expected 'true' or 'false'." >&2
    echo "             Without it there is no way to tell an earned skip from a lost job." >&2
    exit 1 ;;
esac

# Guard against a result string GitHub does not emit — a typo in the workflow expression
# would otherwise arrive here as a value that matches no failure test and passes by default.
known() {
  case "$1" in
    success|failure|cancelled|skipped) return 0 ;;
    *) return 1 ;;
  esac
}

bad=''
for pair in "verify:$verify" "integration:$integration" "e2e:$e2e"; do
  name="${pair%%:*}"
  result="${pair#*:}"
  known "$result" || { echo "ci-conclude: $name reported '$result', which is not a job result." >&2; exit 1; }
done

# verify covers gate/test/visual and is never conditional, so nothing excuses it.
[ "$verify" = success ] || bad="$bad verify($verify)"

# The heavy pair. A skip is judged, never assumed.
for pair in "integration:$integration" "e2e:$e2e"; do
  name="${pair%%:*}"
  result="${pair#*:}"
  if [ "$result" = success ]; then
    continue
  elif [ "$result" = skipped ] && [ "$docker" = false ]; then
    echo "$name skipped — the diff does not touch the image build, which is what it tests."
  else
    bad="$bad $name($result)"
  fi
done

if [ -n "$bad" ]; then
  echo "" >&2
  echo "CI did not conclude green:$bad" >&2
  [ "$docker" = true ] && echo "(the diff touches docker, so integration and e2e were not entitled to skip)" >&2
  exit 1
fi

echo "CI concluded green — verify=$verify integration=$integration e2e=$e2e docker=$docker"
