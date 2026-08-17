# Deploying Hydromart on a single VPS

A production single-host deploy with Docker Compose: base infra
(`docker-compose.yml` → Postgres) plus the production overlay
(`docker-compose.prod.yml` → all 15 microservices + the Next.js web app).

The app services are only reachable on the internal docker network. The two
ports you actually serve are **8080** (API gateway) and **3000** (web).

> Postgres (`5432`) comes from the base infra file, which publishes it on the
> host so host-side migrations can reach `localhost:5432`. It is **not** locked to
> loopback by the compose files — you MUST block it at the VPS firewall (see §1).
> Never let the public internet reach 5432.
>
> Redis is gone (Q-9). Nothing in the codebase ever imported a client; it was a
> container, a volume and an open port with no reader. After pulling this change,
> `docker compose ... up -d --remove-orphans` once, or the old container keeps
> running with nothing talking to it.

---

## 1. Prerequisites (on the VPS)

- Linux with **Docker Engine + the Compose v2 plugin** (`docker compose version`).
- **~4 GB RAM** minimum (16 containers: Postgres, 15 Node services + web),
  8 GB comfortable. A couple of GB free disk for images.
- **Node.js 20+** on the host — needed once, to run database migrations
  (`prisma migrate deploy`) against the compose Postgres over `localhost:5432`.
- **Host firewall (required).** Allow only `22` (SSH) + `3000` + `8080` (or
  `80`/`443` with a reverse proxy — see §6). Explicitly block `5432` from the
  internet, e.g. with ufw:

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

**Verify schema state first.** Some of these migrations add _unique_ indexes
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
(`orders/reminders/reorder`), daily at 03:30 it enforces retention
(`retention/internal/purge`), and every 15 minutes it releases HR announcements
whose schedule has come due (`announcements/publish-due`). Without the sidecar a
scheduled announcement simply never sends — there is no timer inside hr-service.
Times are **WIB** (`Asia/Jakarta`), not UTC: the container inherits `PRICING_TZ`, so the
whole platform cuts its days at one boundary. Override just this one with `SCHEDULER_TZ`
in `.env` if you ever need to.

That was a lie for as long as it was written. `TZ` was set, but the `alpine` image ships no
zone files, so the C library read every value as UTC and each sweep fired seven hours late
— the 08:00 refill nudge went out at 15:00 WIB, the 03:30 retention purge ran at 10:30 WIB.
The container now gets the host's `/usr/share/zoneinfo`, and **every deploy prints the
scheduler's clock**, so the claim on this line is re-proved on each release instead of
being trusted:

```text
[deploy] scheduler clock WIB+0700 (TZ=Asia/Jakarta) — cron times are local, as written
```

The same was true of the HOST crontab that `scripts/install-host-cron.sh` installs (backup,
restore drill, watchdog): it followed the host's UTC clock until `CRON_TZ` was declared in
the block. Both halves now read the same `.env` value.

Watch it with `docker compose logs -f scheduler`; disable with
`... up -d --scale scheduler=0`.

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
2. **Firewall** — open `80` + `443`, and _close_ `3000`/`8080` to the public so
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

**Security headers (H-23).** The `Caddyfile` now sets them, because this proxy is
the only component that sees TLS:

- `Strict-Transport-Security: max-age=31536000; includeSubDomains` on all three
  hostnames. No `preload` — that is a one-way submission to a browser-vendor list.
- A **Content-Security-Policy** on the web host, and a `default-src 'none'` one on
  the API host. `script-src` keeps `'unsafe-inline'`: Next's bootstrap and its
  hydration payload are un-nonced inline scripts. The strict directives are the
  ones that earn their keep — `frame-ancestors 'none'`, `object-src 'none'`,
  `base-uri`, `form-action`.
- `img-src` allows any `https:` origin (object-storage host is deployment-specific)
  plus `blob:`/`data:` for camera capture and canvas renders.

**Without the `tls` profile there is no HSTS and no CSP** — nothing else in the
stack sets them. A bare-IP deploy is a test posture, not a production one.

Changing the API hostname means changing `connect-src` too — it is interpolated
from `{$API_DOMAIN}`, so setting that variable is enough. Validate any edit before
restarting:

```bash
docker run --rm -e WEB_DOMAIN -e API_DOMAIN -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

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

# stop AND delete Postgres data — destructive
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
# `crontab -e` as the deploy user. NOTE: these paths are illustrative — the live box
# checks the repo out at /home/hydromart/hydromart, not /opt/hydromart. Use the real
# one, or cron fails silently into a log nobody reads.
0 3 * * *  cd /opt/hydromart && ALERT_WEBHOOK_URL=... bash scripts/backup-db.sh      >> /var/log/hydromart-backup.log 2>&1
0 4 * * 1  cd /opt/hydromart && ALERT_WEBHOOK_URL=... bash scripts/restore-db.sh --drill >> /var/log/hydromart-restore-drill.log 2>&1
*/5 * * * * cd /opt/hydromart && ALERT_WEBHOOK_URL=... bash scripts/watchdog.sh        >> /var/log/hydromart-watchdog.log 2>&1
```

### Docker daemon config — `live-restore` is load-bearing

Copy [`ops/docker-daemon.json`](ops/docker-daemon.json) to `/etc/docker/daemon.json` and
`sudo systemctl reload docker` (a reload, not a restart — containers keep running).

On 2026-08-02 at 17:48 WIB dockerd 29.6.1 died mid-deploy with

```text
fatal error: concurrent map iteration and map write
  github.com/moby/buildkit/solver.(*subBuilder).EachValue      solver/jobs.go:359
  github.com/moby/buildkit/solver/llbsolver.loadProxyNetwork   llbsolver/network.go:51
docker.service: Main process exited, code=exited, status=2/INVALIDARGUMENT
```

A Go `fatal error` cannot be recovered, so the whole daemon went down and took all 25
containers with it — that is the "everything `Exited (0)` at the same instant" nobody
could explain. systemd restarted dockerd two seconds later, and the new daemon logged
`stopping restart-manager` for every container rather than restarting it, which is why
`restart: unless-stopped` rescued nothing. No OOM, no reboot: the box had been up 17
days and had 13 GB available.

The trigger is our own build concurrency. `rebuild-stale.sh` runs `docker compose build`
over a batch of 4, and BuildKit solves those jobs in parallel against shared solver
state — that is the map being iterated and written at once. Rare (once in 30 days), and
it fires exactly when a full rebuild is running, i.e. during a deploy.

`live-restore` is the answer to the class, not to this one bug: containers keep running
while dockerd is absent, so a daemon crash costs a failed build instead of a dead site.
Keep the engine current too (this is a BuildKit bug, and BuildKit ships inside it).

### Watchdog (host cron) — install this, it is not optional

[`scripts/watchdog.sh`](scripts/watchdog.sh) converges the stack every 5 minutes and
dumps diagnostics for anything it finds stopped.

On 2026-08-02 nineteen containers sat `Exited (0)` for four hours with RAM and disk
fine. `restart: unless-stopped` does not rescue that state: exit 0 under that policy
means the container was stopped _deliberately_ (a `docker stop`/`compose stop`, or a
daemon shutdown), and Docker honours the stop until something asks for the container
again. The only thing that ever asked was a deploy — which runs when someone merges,
not when prod falls over. The watchdog is what asks in between.

It also writes `.deploy/incident-<timestamp>.log` with each stopped container's exit
code, `OOMKilled` flag, last 40 log lines, and the daemon's recent `stop`/`die`/`kill`
events. We still do not know what issued the original stop — the daemon's event buffer
had rolled over by the time anyone looked. That report is how a second occurrence gets
a cause instead of a guess, so read it before restarting anything by hand.

A crash loop is reported separately: if a container is still down 20s after the
converge, the watchdog exits 1 and alerts with "still down" rather than "recovered".

**Why host cron and not the `scheduler` container:** the drill spins an _ephemeral
scratch Postgres_ (`docker run` + `docker exec`) to restore into. The scheduler
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

### Before you run a SECOND gateway — the rate limiter is in-memory

The gateway's throttler counts requests in the memory of **one process**. That is correct
today, because there is one gateway; it stops being correct the moment there are two.

Two replicas each hold their own counter, so a limit of 600/min becomes 1200/min for anyone
whose requests land alternately — and the person who notices first is whoever is scraping
you, not whoever is monitoring you. Nothing in the stack will report it: both processes are
enforcing their limit correctly, and the limit is simply no longer the limit.

**The trigger, stated so it is a decision rather than a surprise:** before scaling the
gateway past one replica, move the bucket to a shared store (Redis or Postgres) — or accept,
in writing, that the effective ceiling multiplies by the replica count.

The limiter is a **token bucket** now, not a fixed window: `RATE_LIMIT_MAX` per
`RATE_LIMIT_TTL_SECONDS` is the refill rate and `RATE_LIMIT_BURST_MAX` is the capacity. That
removed the window-boundary doubling entirely — a window let a caller spend a full quota at
the end of one and another at the start of the next, twice the limit in two seconds, inside
the rules. What it does NOT remove is this: two processes hold two buckets.

The same applies to the per-process alert dedupe in `packages/platform/src/nest/
error-alerter.ts`: with two processes, a 5xx storm sends two messages a minute instead of
one. That one is noise; the rate limit is exposure.

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

### Alerting (Prometheus + Alertmanager)

Each service already pings `ALERT_WEBHOOK_URL` on its own 5xx (error-alerter). The
`alertmanager` service adds the **infra-level** alerts a broken process can't send
about itself — down, crash-looping, high 5xx rate, high p95 latency, event-loop
lag — from Prometheus rules in [`ops/alert-rules.yml`](ops/alert-rules.yml).

One-time setup (the webhook URL is a secret, so it lives in a gitignored file, not
in `alertmanager.yml`):

```bash
# same URL the rest of ops uses; for Discord append /slack to the webhook
printf '%s' "$ALERT_WEBHOOK_URL" > ops/alertmanager.webhook-url
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d alertmanager
```

- No `ops/alertmanager.webhook-url` file → the container won't start. That's
  intentional: a missing webhook means alerting is unconfigured, and a silent
  no-op alerter is worse than a loud failure at boot.
- **Alerts:** `ServiceDown`/`ServiceCrashLooping` (critical), `HighErrorRate`
  (critical, >5% 5xx / 5m), `HighLatencyP95` (warning, >1.5s p95 / 10m),
  `EventLoopLagHigh` (warning, >200ms / 5m). A firing critical inhibits same-service
  warnings so an incident pages once, not three times.
- **View state:** Prometheus `Alerts` tab at `127.0.0.1:9090` (SSH-tunnel), or
  Alertmanager UI at `127.0.0.1:9093`. Both are loopback-only.
- **Validate after editing rules/config:**
  `docker run --rm --entrypoint promtool -v "$PWD/ops:/ops:ro" prom/prometheus:v2.54.1 check rules /ops/alert-rules.yml`
  and `... --entrypoint amtool ... prom/alertmanager:v0.27.0 check-config /ops/alertmanager.yml`.
