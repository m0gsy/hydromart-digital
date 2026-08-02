#!/usr/bin/env bash
# Self-check for the pure (no-Docker) helpers in deploy-common.sh — the ones that
# decide whether a deploy does anything at all. Run: bash scripts/lib/deploy-common.test.sh
#
# ponytail: asserts in a script, no framework. These three functions are the whole
# "which files matter" decision; everything else here needs a live Docker daemon.
set -euo pipefail
cd "$(dirname "$0")/../.."
. scripts/lib/deploy-common.sh

fail=0
is() { [ "$2" = "$3" ] || { echo "FAIL $1: expected '$3', got '$2'"; fail=1; }; }
yes_() { if needs_full_rebuild "$2"; then :; else echo "FAIL $1: expected full rebuild"; fail=1; fi; }
no_() { if needs_full_rebuild "$2"; then echo "FAIL $1: expected NO full rebuild"; fail=1; fi; }

is "service path"            "$(svc_of services/order-service/src/app.ts)" "order"
is "app path"                "$(svc_of apps/web/app/page.tsx)"             "web"
is "compose file maps to no service" "$(svc_of docker-compose.prod.yml)"   ""
is "env example maps to no service"  "$(svc_of .env.example)"              ""

yes_ "shared package"        "packages/access/src/index.ts"
yes_ "root lockfile"         "package-lock.json"
yes_ "root manifest"         "package.json"
yes_ "base tsconfig"         "tsconfig.base.json"
yes_ "mixed diff"            "$(printf 'README.md\npackage-lock.json\n')"
no_  "service manifest only" "services/order-service/package.json"
no_  "compose only"          "docker-compose.prod.yml"
no_  "service code only"     "$(printf 'services/order-service/src/a.ts\napps/web/x.tsx\n')"

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
printf 'A=1\nORDER_ALERT_PHONE=\n# C=3\n' > "$tmp/.env.example"
printf 'A=9\n' > "$tmp/.env"
is "missing key reported" "$(cd "$tmp" && missing_env_keys)" "ORDER_ALERT_PHONE "
printf 'A=9\nORDER_ALERT_PHONE=62812\n' > "$tmp/.env"
is "no gap reported"      "$(cd "$tmp" && missing_env_keys)" ""

[ "$fail" -eq 0 ] && echo "deploy-common: all checks passed"
exit "$fail"
