#!/usr/bin/env bash
# Self-check for scripts/ci-affected.sh (audit CI-2). Runs in CI beside the other
# shell self-checks — the whole point of this filter is to SKIP the Docker jobs, so a
# wrong "false" here is an untested image reaching main with a green tick.
#
#   bash scripts/ci-affected.test.sh
set -uo pipefail
cd "$(dirname "$0")/.."

CI_AFFECTED_LIB=1
# shellcheck source=scripts/ci-affected.sh
. scripts/ci-affected.sh

fails=0
check() {
  local name="$1" expected="$2" files="$3" got
  got=$(affects_images "$files")
  if [ "$got" = "$expected" ]; then
    echo "  ok   $name"
  else
    echo "  FAIL $name — expected $expected, got $got"
    fails=$((fails + 1))
  fi
}

echo "ci-affected.sh:"

check "empty diff"                 false ""
check "a README"                   false "README.md"
check "docs only"                  false "$(printf 'docs/DEPLOY.md\nREADME.md\n')"
check "the audit register"         false "docs/audit/register.md"
check ".claude rules"              false ".claude/COMMIT_RULES.md"

check "a service source file"      true  "services/order-service/src/main.ts"
check "a service migration"        true  "services/order-service/prisma/migrations/1_x/migration.sql"
check "the web app"                true  "apps/web/src/app/page.tsx"
check "a shared package"           true  "packages/platform/src/index.ts"
check "the lockfile"               true  "package-lock.json"
check "the root tsconfig"          true  "tsconfig.base.json"
check "a Dockerfile"               true  "services/order-service/Dockerfile"
check "the compose file"           true  "docker-compose.prod.yml"
check "the integration harness"    true  "test/integration/run.mjs"
check "a script"                   true  "scripts/seed.mjs"
check "the workflow itself"        true  ".github/workflows/ci.yml"

# The dangerous shape: a mixed diff must follow the ONE file that matters, not the many
# that do not.
check "docs plus one service file" true  "$(printf 'README.md\ndocs/x.md\nservices/hr-service/src/app.module.ts\n')"

if [ "$fails" -gt 0 ]; then
  echo "ci-affected.sh: $fails check(s) failed" >&2
  exit 1
fi
echo "ci-affected.sh: all checks passed"
