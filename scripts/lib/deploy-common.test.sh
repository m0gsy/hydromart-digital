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
# H-17: a rebuild that dies midway leaves services with no container at all, and
# `stopped_services` cannot see those — it reports containers whose STATE is wrong, and
# an absent container has no row and no state. The empty-second-list case is the same
# blind spot wearing a different hat: when `docker compose ps` itself fails it prints
# nothing, and "nothing stopped" used to read as "everything healthy".
is "absent: one never created"  "$(absent_services "$(printf 'gateway\norder\nweb\n')" "$(printf 'gateway\nweb\n')")" "order "
is "absent: none missing"       "$(absent_services "$(printf 'gateway\nweb\n')"         "$(printf 'web\ngateway\n')")" ""
is "absent: ps returned nothing" "$(absent_services "$(printf 'gateway\nweb\n')"        "")"                           "gateway web "
is "absent: blank lines ignored" "$(absent_services "$(printf 'gateway\n\nweb\n')"      "$(printf '\ngateway\nweb\n')")" ""
is "absent: extra container is not an error" "$(absent_services "$(printf 'web\n')"     "$(printf 'web\nleftover\n')")" ""

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
# Only keys compose reads from .env can be acted on, so the fixture has to say which those
# are. Without this file the check cannot tell, and must keep reporting everything.
printf 'services:\n  x:\n    environment:\n      A: ${A:-}\n      ORDER_ALERT_PHONE: ${ORDER_ALERT_PHONE:-}\n' > "$tmp/docker-compose.yml"
is "missing key reported" "$(cd "$tmp" && missing_env_keys)" "ORDER_ALERT_PHONE "
printf 'A=9\nORDER_ALERT_PHONE=62812\n' > "$tmp/.env"
is "no gap reported"      "$(cd "$tmp" && missing_env_keys)" ""

# 65 of the 77 keys this once reported were written by compose itself as literals, so .env
# had no say over them and no operator could act on the warning.
printf 'A=1\nJWT_ACCESS_TTL=900\n' > "$tmp/.env.example"
printf 'A=9\n' > "$tmp/.env"
printf 'services:\n  x:\n    environment:\n      A: ${A:-}\n      JWT_ACCESS_TTL: 900\n' > "$tmp/docker-compose.yml"
is "a key compose hardcodes is not reported" "$(cd "$tmp" && missing_env_keys)" ""
# The one answer this check must never give is a false all-clear.
rm -f "$tmp/docker-compose.yml"
is "no compose file: report everything"      "$(cd "$tmp" && missing_env_keys)" "JWT_ACCESS_TTL "

# Object storage on the container disk loses every upload at the next deploy, silently.
printf 'STORAGE_DRIVER=s3\nHR_STORAGE_DRIVER=s3\n' > "$tmp/.env"
is "s3 everywhere is quiet"      "$(cd "$tmp" && throwaway_storage_driver)" ""
printf 'STORAGE_DRIVER=\n' > "$tmp/.env"
is "empty means the s3 default"  "$(cd "$tmp" && throwaway_storage_driver)" ""
printf 'STORAGE_DRIVER=local\n' > "$tmp/.env"
is "local driver reported"       "$(cd "$tmp" && throwaway_storage_driver)" "STORAGE_DRIVER=local "
printf 'STORAGE_DRIVER=s3\nHR_STORAGE_DRIVER=local\n' > "$tmp/.env"
is "per-service one reported"    "$(cd "$tmp" && throwaway_storage_driver)" "HR_STORAGE_DRIVER=local "

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

# --- the scheduler's crontab must not arrive as a bind mount ------------------------
# A bind mount carries the HOST file's ownership. The checkout on the box belongs to the
# deploy user, so /etc/crontabs/root landed as uid 1000, and busybox crond discards every
# entry of a crontab it does not see as owned by the user it is for — while still starting,
# still answering `crontab -l`, and still waking once a minute. Production ran a scheduler
# that had executed zero sweeps. The entrypoint installs a root-owned copy instead.
if grep -qE '^\s+- \./scripts/scheduler/crontab:/etc/crontabs' "$COMPOSE_PROD"; then
  echo "FAIL the crontab is bind-mounted again — busybox crond will ignore every entry"
  fail=1
fi
if grep -q 'chown root:root /etc/crontabs/root' scripts/scheduler/entrypoint.sh; then
  :
else
  echo "FAIL the scheduler entrypoint no longer installs a root-owned crontab"
  fail=1
fi

# --- every npm cache mount must be locked -------------------------------------------
# 19 images build at once in CI and every one of them runs a full-monorepo `npm ci`
# against the same BuildKit cache at /root/.npm. BuildKit's default is sharing=shared,
# which permits concurrent writers — so npm's cacache tmp files collide (EEXIST), and
# with nothing serialising them all 19 miss the cache in the same instant and pull the
# whole workspace at once (ECONNRESET / ETIMEDOUT). Both symptoms, one cause. `locked`
# lets the first build populate the cache and the rest wait for a warm one.
unlocked="$(grep -rl --exclude-dir=node_modules --include='Dockerfile*' \
  -- '--mount=type=cache,target=/root/\.npm ' services apps 2>/dev/null || true)"
if [ -n "$unlocked" ]; then
  echo "FAIL npm cache mount is not sharing=locked in:"
  echo "$unlocked" | sed 's/^/  /'
  fail=1
fi

# --- deploy and watchdog cannot converge the same stack at once ----------------------
# A deploy runs for tens of minutes and the watchdog every five, so they overlap on every
# deploy. On 2026-08-05 the watchdog's converge hit a container the deploy was recreating
# and the deploy died on "removal of container ... is already in progress" — after the
# stack was up, but before the health gate wrote last-good-sha.
if command -v flock >/dev/null 2>&1; then
  lockdir="$(mktemp -d)"
  # A second, independent converger must NOT get the lock while the first holds it.
  held="$(STACK_LOCK="$lockdir/stack.lock" bash -c '
    . scripts/lib/deploy-common.sh
    stack_lock 0 || { echo first-failed; exit 0; }
    HYDROMART_STACK_LOCKED= bash -c ". scripts/lib/deploy-common.sh
      if stack_lock 0; then echo second-got-it; else echo second-blocked; fi"
    # Keep this shell alive past its child: bash exec()s into the LAST command of a
    # `-c` string, which would hand the lock fd to the very shell being tested.
    :')"
  is "a second converger is locked out" "$held" "second-blocked"
  # ...but a nested call inside the SAME deploy (deploy.sh -> rollback.sh) must not
  # deadlock on the lock its own parent already holds.
  nested="$(STACK_LOCK="$lockdir/stack.lock" HYDROMART_STACK_LOCKED=1 bash -c '
    . scripts/lib/deploy-common.sh
    if stack_lock 0; then echo nested-ok; else echo nested-deadlocked; fi')"
  is "a nested caller inherits the lock" "$nested" "nested-ok"
  rm -rf "$lockdir"
fi
# Every script that converges the stack must ask for the lock first.
for s in scripts/deploy.sh scripts/rollback.sh scripts/watchdog.sh; do
  if ! grep -q 'stack_lock' "$s"; then
    echo "FAIL $s converges the stack without taking the stack lock"
    fail=1
  fi
done

# --- a health probe must not resolve a name -----------------------------------------
# The rebuilt images map `localhost` to ::1 as well as 127.0.0.1, busybox wget tries the
# IPv6 address first, and Nest listens on IPv4 only: every probe answered "Connection
# refused" while the service was serving on that exact port. Seven containers sat
# unhealthy for over an hour and the deploy's health gate would have rolled back a good
# release. The address is the fix; this keeps it.
if grep -nE 'wget.*http://localhost:' "$COMPOSE_PROD"; then
  echo "FAIL a healthcheck probes localhost — use 127.0.0.1, or ::1 answers and refuses"
  fail=1
fi

[ "$fail" -eq 0 ] && echo "deploy-common: all checks passed"
exit "$fail"
