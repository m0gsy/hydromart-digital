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

```bash
# from the repo root, with .env already filled in:
set -a; . ./.env; set +a          # load POSTGRES_PASSWORD into the shell

export AUTH_DATABASE_URL="postgresql://hydromart:${POSTGRES_PASSWORD}@localhost:5432/hydromart_auth?schema=public"
export CUSTOMER_DATABASE_URL="postgresql://hydromart:${POSTGRES_PASSWORD}@localhost:5432/hydromart_customer?schema=public"
export PRODUCT_DATABASE_URL="postgresql://hydromart:${POSTGRES_PASSWORD}@localhost:5432/hydromart_product?schema=public"
export ORDER_DATABASE_URL="postgresql://hydromart:${POSTGRES_PASSWORD}@localhost:5432/hydromart_order?schema=public"
export PAYMENT_DATABASE_URL="postgresql://hydromart:${POSTGRES_PASSWORD}@localhost:5432/hydromart_payment?schema=public"
export DELIVERY_DATABASE_URL="postgresql://hydromart:${POSTGRES_PASSWORD}@localhost:5432/hydromart_delivery?schema=public"
export DEPOT_DATABASE_URL="postgresql://hydromart:${POSTGRES_PASSWORD}@localhost:5432/hydromart_depot?schema=public"
export LOYALTY_DATABASE_URL="postgresql://hydromart:${POSTGRES_PASSWORD}@localhost:5432/hydromart_loyalty?schema=public"
export PROMO_DATABASE_URL="postgresql://hydromart:${POSTGRES_PASSWORD}@localhost:5432/hydromart_promo?schema=public"
export REFERRAL_DATABASE_URL="postgresql://hydromart:${POSTGRES_PASSWORD}@localhost:5432/hydromart_referral?schema=public"
export CRM_DATABASE_URL="postgresql://hydromart:${POSTGRES_PASSWORD}@localhost:5432/hydromart_crm?schema=public"
export RECOMMENDATION_DATABASE_URL="postgresql://hydromart:${POSTGRES_PASSWORD}@localhost:5432/hydromart_recommendation?schema=public"
export FORECAST_DATABASE_URL="postgresql://hydromart:${POSTGRES_PASSWORD}@localhost:5432/hydromart_forecast?schema=public"

npm ci                 # installs workspaces + generates Prisma clients (postinstall)
npm run db:migrate     # runs `prisma migrate deploy` in every service workspace
```

`npm run db:migrate` fans out `prisma migrate deploy` across all service
workspaces (`--if-present`); the web app has no schema and is skipped.
Re-running it is safe — already-applied migrations are no-ops.

> Alternative (no Node on the host): run migrations from a throwaway container
> on the compose network, pointing the URLs at `postgres:5432` instead of
> `localhost:5432`:
>
> ```bash
> docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm \
>   -e AUTH_DATABASE_URL="postgresql://hydromart:${POSTGRES_PASSWORD}@postgres:5432/hydromart_auth?schema=public" \
>   auth npx prisma migrate deploy
> ```
>
> (repeat per service, or script the loop). The host-side path above is simpler.

After migrating, restart the app tier so anything that bailed on empty tables
comes up clean:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml restart
```

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

## 6. TLS / real domain (recommended, not included)

This stack serves plain HTTP on `3000`/`8080`. For a real domain with HTTPS,
put a reverse proxy in front and terminate TLS there — don't expose `3000`/`8080`
directly. Two easy options:

- **Caddy** — automatic Let's Encrypt certs. A ~6-line `Caddyfile` reverse-proxies
  `your-domain.com → web:3000` and `api.your-domain.com → gateway:8080`. Add it as
  one more service on the compose network and publish only `80`/`443`.
- **nginx + certbot** — the classic manual route.

If you do this, rebuild the `web` image with
`PUBLIC_API_URL=https://api.your-domain.com` so the browser bundle calls the
right host, and restrict the `web`/`gateway` port publishing to `127.0.0.1` so
only the proxy reaches them.

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
