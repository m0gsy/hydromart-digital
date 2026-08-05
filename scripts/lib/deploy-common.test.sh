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

# B-20 — the incoming diff carries a migration, so the deploy must apply it before any
# container starts on the new code.
is "migration dir detected" \
  "$(pending_migrations "$(printf 'services/hr-service/prisma/migrations/0016_x/migration.sql\n')")" \
  "services/hr-service/prisma/migrations/0016_x"
is "migration dir deduped across files in one migration" \
  "$(pending_migrations "$(printf 'services/order-service/prisma/migrations/2026_a/migration.sql\nservices/order-service/prisma/migrations/2026_a/rollback.sql\n')")" \
  "services/order-service/prisma/migrations/2026_a"
is "schema edit alone is not a migration" \
  "$(pending_migrations "services/order-service/prisma/schema.prisma")" ""
is "ordinary code change carries no migration" \
  "$(pending_migrations "$(printf 'services/order-service/src/a.ts\ndocker-compose.prod.yml\n')")" ""
# ...and answering "none" must EXIT ZERO. deploy.sh reads this into a variable under
# `set -euo pipefail`, where the status of a command substitution becomes the status of
# the assignment — so grep's no-match 1 killed every migration-less deploy right after the
# reset. The output checks above cannot catch it: a failing substitution inside an
# argument does not trip `set -e`, only one in an assignment does. Assert the status.
probe_status=0
probe="$(pending_migrations "docker-compose.prod.yml")" || probe_status=$?
is "no migration exits zero (deploy.sh reads this under set -e)" "$probe_status" "0"

# H-32 — the deploy gate reads compose `ps` state AND health. `running` alone passed a
# container that had been failing its own healthcheck since boot.
is "running + healthy passes" \
  "$(printf 'order running healthy\ngateway running healthy\n' | filter_unhealthy)" ""
is "running but unhealthy fails" \
  "$(printf 'order running unhealthy\ngateway running healthy\n' | filter_unhealthy)" "order "
is "still starting fails (the retry loop lets it resolve)" \
  "$(printf 'order running starting\n' | filter_unhealthy)" "order "
is "exited fails whatever its last health said" \
  "$(printf 'order exited healthy\n' | filter_unhealthy)" "order "
is "no healthcheck declared is judged on running only" \
  "$(printf 'caddy running \n' | filter_unhealthy)" ""
is "no healthcheck and not running still fails" \
  "$(printf 'caddy exited \n' | filter_unhealthy)" "caddy "

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

# The rebuild set must be measured from the last commit that actually reached the
# containers. Measuring from HEAD is what turned a deploy that died after `git reset
# --hard` into a later no-op that reported success.
# HEAD is the only commit a shallow CI checkout is guaranteed to have, so the recorded
# SHA is HEAD and the fallback is a sentinel — which is the distinction that matters:
# whether the file wins over the fallback, not which two commits they are.
head_sha="$(git rev-parse HEAD)"
printf '%s\n' "$head_sha" > "$tmp/last-good"
printf 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n' > "$tmp/unknown-sha"
: > "$tmp/empty"
is "base is the recorded DEPLOYED commit, not the tree" \
  "$(rebuild_base "$tmp/last-good" "FALLBACK")" "$head_sha"
is "no last-good file falls back (first deploy)" \
  "$(rebuild_base "$tmp/absent" "FALLBACK")" "FALLBACK"
is "empty last-good falls back" \
  "$(rebuild_base "$tmp/empty" "FALLBACK")" "FALLBACK"
is "a sha this checkout does not have falls back" \
  "$(rebuild_base "$tmp/unknown-sha" "FALLBACK")" "FALLBACK"

printf 'A=1\nORDER_ALERT_PHONE=\n# C=3\n' > "$tmp/.env.example"
printf 'A=9\n' > "$tmp/.env"
is "missing key reported" "$(cd "$tmp" && missing_env_keys)" "ORDER_ALERT_PHONE "
printf 'A=9\nORDER_ALERT_PHONE=62812\n' > "$tmp/.env"
is "no gap reported"      "$(cd "$tmp" && missing_env_keys)" ""

# --- B-12: the connection pool must be bounded on both sides -------------------------
# Prisma defaults to (cpus*2+1) connections PER SERVICE. Unbounded, 16 services on an
# 8-vCPU box ask for ~272 against postgres's default max_connections of 100 — and the
# failure looks like an intermittent network fault, not exhaustion. These assertions fail
# against the pre-fix compose file, and keep failing if service #17 arrives without a
# limit or if someone raises DB_POOL past what the server allows.
COMPOSE_PROD="docker-compose.prod.yml"

n_urls="$(grep -c '_DATABASE_URL: postgresql://' "$COMPOSE_PROD" || true)"
n_limited="$(grep '_DATABASE_URL: postgresql://' "$COMPOSE_PROD" | grep -c 'connection_limit=' || true)"
is "every service DB url bounds its pool" "$n_limited" "$n_urls"

max_conn="$(grep -oE 'max_connections=[0-9]+' "$COMPOSE_PROD" | head -1 | cut -d= -f2)"
is "postgres declares a connection ceiling" "${max_conn:-unset}" "150"

# Default pool x service count must leave room for psql, migrations, backups, exporters.
pool_default="$(grep -oE 'connection_limit=\$\{DB_POOL:-[0-9]+\}' "$COMPOSE_PROD" | head -1 | grep -oE '[0-9]+\}$' | tr -d '}')"
worst_case=$(( ${pool_default:-0} * n_urls ))
if [ "${pool_default:-0}" -gt 0 ] && [ "$worst_case" -lt "${max_conn:-0}" ]; then
  :
else
  echo "FAIL pool headroom: ${pool_default:-0} x $n_urls = $worst_case connections vs max_connections=${max_conn:-0}"
  fail=1
fi

# --- H-19: the public ports must not default to every interface ----------------------
# `trust proxy` is now on in the gateway, so a directly reachable port lets a client spoof
# X-Forwarded-For and mint a fresh rate-limit bucket. Loopback must stay the default.
for port in 8080 3000; do
  if grep -qE "^\s+- \"\\\$\{PUBLIC_BIND:-127\.0\.0\.1\}:${port}:${port}\"" "$COMPOSE_PROD"; then
    :
  else
    echo "FAIL port $port is not bound to loopback by default (H-19)"
    fail=1
  fi
done

[ "$fail" -eq 0 ] && echo "deploy-common: all checks passed"
exit "$fail"
