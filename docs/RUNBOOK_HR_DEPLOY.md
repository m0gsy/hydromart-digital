# Runbook — Deploy HR module + arm alerting (post PR #27)

Post-merge ops steps for the `feat/hr-module` → main merge (PR #27): deploy the
new `hr-service`, arm Alertmanager, and verify. Everything runs on the **VPS**,
from the repo root (`/opt/hydromart`), with `.env` already filled.

> These touch prod: a schema migration and a service deploy. Run in order — the
> DB migration must land before the HR app tier serves traffic.

```bash
DC="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
```

## 1. Deploy the HR module

HR is a **new service** (`hr-service`, port 3018), so this is build + migrate +
start — not just a migration. Gateway and web changed too (new route + console),
so they rebuild.

```bash
# Get the merged code
cd /opt/hydromart
git checkout main && git pull origin main

# Build the new + changed images. Batch (one at a time) to avoid OOM on 16GB.
$DC build hr
$DC build gateway
$DC build web

# Apply migrations. Creates hydromart_hr + all HR tables (Prisma migrate deploy
# creates the DB on first run); no-op for the other 15 services. Needs Node on
# the host + the stack up.
npm ci
npm run db:migrate:prod

# Start the new service, then roll the changed ones
$DC up -d hr
$DC up -d gateway web

# Confirm HR is healthy
curl -fsS http://localhost:8080/hr/health && echo " hr-OK"
$DC logs --tail 40 hr
```

Notes:

- `db:migrate:prod` ([`scripts/migrate-prod.sh`](../scripts/migrate-prod.sh))
  already loops in `hr` — no manual `createdb`.
- HR face storage/verifier needs its env vars in `.env` **before** `up -d hr`,
  or the container crash-loops. Check the `hr:` block in
  [`docker-compose.prod.yml`](../docker-compose.prod.yml) (~line 373) for the
  required `HR_STORAGE_*` / `FACE_VERIFIER_*` keys.

## 2. Arm alerting (Alertmanager)

```bash
cd /opt/hydromart

# Write the webhook secret to the gitignored file (same URL the rest of ops uses;
# for a Discord webhook, append /slack to it).
printf '%s' "$ALERT_WEBHOOK_URL" > ops/alertmanager.webhook-url

# Start Alertmanager + reload Prometheus so it picks up the rules + AM target
$DC up -d alertmanager
$DC restart prometheus

# Verify
curl -fsS http://127.0.0.1:9093/-/healthy && echo " AM-OK"
```

Check rules loaded: SSH-tunnel to `127.0.0.1:9090` → **Status → Rules** (5 rules)
and **Alerts**. Missing `ops/alertmanager.webhook-url` → the container won't
start (intentional: no silent no-op alerter). See DEPLOY.md §7 for the alert
list and config-validation commands.

## 3. Browser-verify HR

```bash
bash scripts/verify-indexes.sh   # re-run: HR tables should now show PASS
```

Then in a browser (via tunnel / domain):

1. Log in as an **HR** / admin user → HR link appears in the HQ rail.
2. HR console → create an employee → confirm it persists.
3. Self-service PWA → face check-in → attendance row records.
4. Payroll → generate a slip → PDF/xlsx export downloads.

## Rollback

If HR misbehaves, take it out of rotation without touching the rest of the stack:

```bash
$DC stop hr          # gateway 502s on /hr/* only; everything else keeps serving
```

The migration is additive (new `hydromart_hr` DB, no changes to other services'
schemas), so stopping `hr` is a safe, complete rollback of the deploy — no schema
revert needed.
