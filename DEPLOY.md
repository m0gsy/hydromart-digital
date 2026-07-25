# Deploying Hydromart on a single VPS

A production single-host deploy with Docker Compose: base infra
(`docker-compose.yml` → Postgres + Redis) plus the production overlay
(`docker-compose.prod.yml` → all 15 microservices + the Next.js web app).

The app services are only reachable on the internal docker network. The two
ports you actually serve are **8080** (API gateway) and **3000** (web).

> Postgres (`5432`) and Redis (`6379`) come from the base infra file, which
> publishes them on the host so host-side migrations can reach `localhost:5432`.
> They are **not** locked to loopback by the compose files — you MUST block them
> at the VPS firewall (see §1). Never let the public internet reach 5432/6379.

---

## 1. Prerequisites (on the VPS)

- Linux with **Docker Engine + the Compose v2 plugin** (`docker compose version`).
- **~4 GB RAM** minimum (17 containers: Postgres, Redis, 15 Node services + web),
  8 GB comfortable. A couple of GB free disk for images.
- **Node.js 20+** on the host — needed once, to run database migrations
  (`prisma migrate deploy`) against the compose Postgres over `localhost:5432`.
- **Host firewall (required).** Allow only `22` (SSH) + `3000` + `8080` (or
  `80`/`443` with a reverse proxy — see §6). Explicitly block `5432` and `6379`
  from the internet, e.g. with ufw:

  ```bash
  ufw default deny incoming
  ufw allow 22/tcp && ufw allow 3000/tcp && ufw allow 8080/tcp
  ufw enable
  ```

---

## 2. Clone + configure secrets

```bash
git clone <your-repo-url> hydromart
cd hydromart

cp .env.production.example .env
# Edit .env and fill EVERY value marked REQUIRED. Generate strong secrets with:
#   openssl rand -hex 32
```

Compose auto-loads `./.env`. The prod overlay uses `${VAR:?...}` for every
secret, so `up` fails fast with a clear message if any required value is unset.

---

## 3. Build + start everything

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

First run builds 16 images (slow — many minutes). Watch them come up healthy:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

The app services will boot but return errors until migrations are applied
(next step) — their databases exist (init-databases.sql) but have no tables yet.

---

## 4. Run database migrations (do this once per deploy, host-side)

Migrations run from the **host** against the compose Postgres, which is
published on `127.0.0.1:5432`. Each Prisma schema reads its own
`<SVC>_DATABASE_URL` from the environment (same mechanism as
`.github/workflows/ci.yml`'s integration job), so every URL must point at
`localhost:5432` with your **prod** `POSTGRES_PASSWORD`.

**Verify schema state first.** Some of these migrations add *unique* indexes
(one active payment per order, one primary address per customer, …). If the live
data already violates one, `db:migrate:prod` aborts partway through while building
that index. Check before you migrate:

```bash
bash scripts/verify-indexes.sh   # read-only; needs the stack (§3) up
```

[`scripts/verify-indexes.sh`](scripts/verify-indexes.sh) reports, per index,
whether it is already present and whether current data would violate it. **PASS**
= safe to migrate. A **DIRTY** result means resolve the duplicate rows first, or
the migration will fail. (On a first deploy every index shows MISSING — that's
expected; the migrate step below creates them. Re-run the check after migrating to
confirm PASS.)

```bash
# from the repo root, with .env already filled in:
npm ci                    # installs workspaces + generates Prisma clients (postinstall)
npm run db:migrate:prod   # derives all 13 *_DATABASE_URL from POSTGRES_PASSWORD, then migrates
```

`db:migrate:prod` ([`scripts/migrate-prod.sh`](scripts/migrate-prod.sh)) loads
`.env`, builds every `<SVC>_DATABASE_URL` from `POSTGRES_PASSWORD` in a loop
(no more 13 manual `export` lines — that's the whole point), then fans out
`prisma migrate deploy` across all service workspaces (`--if-present`); the web
app has no schema and is skipped. Re-running it is safe — already-applied
migrations are no-ops.

> Alternative (no Node on the host): run the same script inside a throwaway
> container on the compose network — `MIGRATE_DB_HOST=postgres` swaps the host:
>
> ```bash
> docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm \
>   -e MIGRATE_DB_HOST=postgres auth bash scripts/migrate-prod.sh
> ```
>
> The host-side path above is simpler.

After migrating, restart the app tier so anything that bailed on empty tables
comes up clean:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml restart
```

The `scheduler` sidecar comes up with the stack and drives the internal sweeps
that nothing else calls: hourly it places due subscription orders
(`subscriptions/process-due`), daily at 08:00 it sends refill reminders
(`orders/reminders/reorder`). Times are UTC — set `SCHEDULER_TZ=Asia/Jakarta`
in `.env` to shift. Watch it with `docker compose logs -f scheduler`; disable
with `... up -d --scale scheduler=0`.

---

## 5. Smoke test

```bash
curl -fsS http://localhost:8080/health && echo OK      # gateway
curl -fsS http://localhost:3000 >/dev/null && echo web-OK
```

Then open `http://<vps-ip>:3000` in a browser. The web app talks to the API
via `PUBLIC_API_URL` (baked at build time — default `http://localhost:8080`;
set it to your public gateway URL in `.env` **before** building if you serve a
real domain, since Next inlines `NEXT_PUBLIC_*` at build).

---

## 6. TLS / real domain (Caddy — included, opt-in)

Serving auth over plain HTTP on the public internet is not safe (bearer tokens
travel in cleartext). A **Caddy** reverse proxy is included as an opt-in `tls`
compose profile — it terminates HTTPS and auto-provisions/renews Let's Encrypt
certs. Without the profile the stack stays on plain HTTP `:3000`/`:8080`.

**Setup:**

1. **DNS** — point two records at your VPS's public IP:
   `app.your-domain.com` (web) and `api.your-domain.com` (gateway). Any names
   work; they just have to resolve to this host.
2. **Firewall** — open `80` + `443`, and *close* `3000`/`8080` to the public so
   visitors only reach Caddy:
   ```bash
   ufw allow 80/tcp && ufw allow 443/tcp
   ufw delete allow 3000/tcp && ufw delete allow 8080/tcp
   ```
   (Caddy reaches `web`/`gateway` over the internal docker network, so they need
   no host ports. Optionally also change their `ports:` to `127.0.0.1:3000:3000`
   / `127.0.0.1:8080:8080` in the overlay for defence in depth.)
3. **`.env`** — set the domains and point the baked API URL at the HTTPS gateway:
   ```
   WEB_DOMAIN=app.your-domain.com
   API_DOMAIN=api.your-domain.com
   PUBLIC_API_URL=https://api.your-domain.com
   ```
4. **Build + run with the profile** (the `PUBLIC_API_URL` change means the web
   image must be rebuilt — it's baked in):
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile tls up -d --build
   ```
   Caddy gets certs on first request (ports 80/443 must be reachable from the
   internet). Then browse `https://app.your-domain.com`.

The `Caddyfile` at the repo root is a plain reverse-proxy config; edit it to add
routes, headers (HSTS/CSP), rate limits, etc. as needed.

---

## 7. Operations

```bash
# logs (all or one service)
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f order

# update to new code
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
npm run db:migrate      # if new migrations landed (env exported as in §4)

# stop (keeps volumes/data)
docker compose -f docker-compose.yml -f docker-compose.prod.yml down

# stop AND delete Postgres/Redis data — destructive
docker compose -f docker-compose.yml -f docker-compose.prod.yml down -v
```

> Tip: alias the long invocation once —
> `alias dcp='docker compose -f docker-compose.yml -f docker-compose.prod.yml'`.

### Backups + restore drill (host cron)

[`scripts/backup-db.sh`](scripts/backup-db.sh) dumps the whole Postgres cluster
nightly; [`scripts/restore-db.sh --drill`](scripts/restore-db.sh) proves a dump
actually restores (a backup you have never restored is not a backup). Both run
from **host cron**, not the `scheduler` container:

```cron
# /etc/crontab (or `crontab -e`) on the VPS — paths assume /opt/hydromart
0 3 * * *  cd /opt/hydromart && ALERT_WEBHOOK_URL=... bash scripts/backup-db.sh      >> /var/log/hydromart-backup.log 2>&1
0 4 * * 1  cd /opt/hydromart && ALERT_WEBHOOK_URL=... bash scripts/restore-db.sh --drill >> /var/log/hydromart-restore-drill.log 2>&1
```

**Why host cron and not the `scheduler` container:** the drill spins an *ephemeral
scratch Postgres* (`docker run` + `docker exec`) to restore into. The scheduler
container is busybox `crond` with no Docker CLI and no Docker socket — giving it
one would mean mounting the host socket into a long-running container (a privilege
escalation) just for a weekly job. The host already owns the Docker daemon and
already runs the nightly backup, so the drill belongs next to it.

**Set `ALERT_WEBHOOK_URL`** in the cron env (same incoming webhook the services
use). A failed drill then POSTs a `🚨 ... restore drill FAILED` message to it —
without it a broken/empty dump fails silently into the log and you find out only
when you need the backup for real.

- **Run one manually:** `bash scripts/restore-db.sh --drill`
- **Passing drill** ends with `drill OK: <dump> restores cleanly (<N> db)` and
  exit 0 — non-destructive, the scratch container is always torn down.
- **Failed drill:** read `/var/log/hydromart-restore-drill.log` for the reason
  (no dump found / corrupt gzip / restore produced no databases). Until a drill
  passes, treat the backups as unusable: check that `backup-db.sh` is actually
  running and producing non-tiny `.sql.gz` files in `BACKUP_DIR`, and re-run the
  drill against a known-good dump to confirm the restore path itself works.

### Checkout load test (k6 — DB-7 hot path)

[`scripts/load/checkout.k6.js`](scripts/load/checkout.k6.js) load-tests the
checkout hot path. DB-7 (sequential per-product catalog fetch at checkout) is now
a parallel fan-out (`order.service.ts` `pricedAll`); this proves p95 stays flat as
`CART_LINES` grows instead of degrading linearly. Run it against **staging**, not
prod — it places real orders.

```bash
# Install k6 (once): https://k6.io/docs/get-started/installation
# Mint one bearer token per test customer the smoke.sh way, then:
TOKENS="<t1>,<t2>,...,<tN>" VUS=10 CART_LINES=3 \
  k6 run scripts/load/checkout.k6.js
```

- **One token per VU.** Checkout drains a customer's server-side cart, so VUs
  sharing a token contend on one cart and skew latency. Supply `VUS` tokens
  (comma-separated in `TOKENS`); the run warns if you give fewer.
- **DB-7 check:** bump `CART_LINES` (3 → 8 → 15) across runs. `checkout_latency`
  p95 should stay roughly flat. Linear growth means the fan-out regressed to
  sequential — inspect `pricedAll`.
- **Thresholds** (override via env): `checkout_latency` p95 < `CHECKOUT_P95_MS`
  (1500), `checkout_success` rate > 0.99, `http_req_failed` < 0.01. k6 exits
  non-zero if any breaches, so it gates in CI/pipeline use.
- Needs a seeded catalog (`scripts/seed.mjs`) — setup() reads the live product
  list and fails fast if there are fewer than `CART_LINES` products.
