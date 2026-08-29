#!/usr/bin/env bash
# Audit CI-2: CI has no affected-only filter. Every push builds ~18 Docker images twice and
# boots the whole stack, including for a change that cannot touch any of it — a README, a
# doc, the audit register.
#
# This answers ONE question, on stdout: do the Docker jobs need to run for this diff?
#
#   scripts/ci-affected.sh <base-ref>          -> "true" | "false"
#   printf 'a\nb\n' | scripts/ci-affected.sh - -> same, from a file list on stdin (tests)
#
# The rule is deliberately conservative and reuses the mapping deploy.sh already trusts
# (scripts/lib/deploy-common.sh, unit-tested by deploy-common.test.sh): anything that maps
# to a service image, anything that invalidates every image, plus the compose files, the
# Dockerfiles, the migrations and the harness itself. Everything else — docs, .md files
# anywhere, .claude/ — is "false".
#
# Wrong in the cheap direction costs one wasted CI run. Wrong in the other direction ships
# an untested image, so an undecidable diff answers "true".
set -euo pipefail

# shellcheck source=scripts/lib/deploy-common.sh
. "$(dirname "$0")/lib/deploy-common.sh"

# Decide from a newline-separated file list. Echoes true/false.
affects_images() {
  local changed="$1" file

  [ -n "$changed" ] || { echo "false"; return; }

  if needs_full_rebuild "$changed"; then
    echo "true"
    return
  fi

  while IFS= read -r file; do
    [ -n "$file" ] || continue
    case "$file" in
      *.md|docs/*|.claude/*|LICENSE|.gitignore|.editorconfig) continue ;;
      docker-compose*.yml|Dockerfile|*/Dockerfile|.dockerignore) echo "true"; return ;;
      test/integration/*|scripts/*|.github/workflows/*) echo "true"; return ;;
      # M23. These are not image SOURCE, they are what the stack MOUNTS, and a skipped
      # job is reported by GitHub as a success — so a change here used to ship with no
      # integration run at all and nothing anywhere went red.
      #   infra/postgres/init-databases.sql -> docker-compose.yml:28, every DB in the stack
      #   ops/*                             -> prometheus, alert-rules, alertmanager, grafana
      #   Caddyfile                         -> the edge in front of all of it
      # Same class as docker-compose*.yml above, which already answers true.
      infra/*|ops/*) echo "true"; return ;;
    esac
    if [ -n "$(svc_of "$file")" ]; then
      echo "true"
      return
    fi
  done <<EOF
$changed
EOF

  echo "false"
}

# Sourced by the self-check — do not run the git plumbing then.
[ "${CI_AFFECTED_LIB:-}" = "1" ] && return 0

BASE="${1:-}"

if [ "$BASE" = "-" ]; then
  affects_images "$(cat)"
  exit 0
fi

if [ -z "$BASE" ]; then
  echo "true"
  exit 0
fi

# Shallow clone, force-push, unknown ref — cannot tell, so assume it matters.
if ! CHANGED=$(git diff --name-only "$BASE"...HEAD 2>/dev/null); then
  echo "true"
  exit 0
fi

affects_images "$CHANGED"
