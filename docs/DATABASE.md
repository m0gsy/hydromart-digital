# Database setup & migrations

Each microservice owns its own PostgreSQL database (one bounded context per DB).
All databases live in a single local Postgres instance created by
[`docker-compose.yml`](../docker-compose.yml); the per-service databases are
created on first boot by [`infra/postgres/init-databases.sql`](../infra/postgres/init-databases.sql).

| Service | Database | Migrations |
| --- | --- | --- |
| auth-service | `hydromart_auth` | `services/auth-service/prisma/migrations` |
| customer-service | `hydromart_customer` | … |
| product-service | `hydromart_product` | … |
| order-service | `hydromart_order` | … |
| payment-service | `hydromart_payment` | … |
| delivery-service | `hydromart_delivery` | … |
| depot-service | `hydromart_depot` | … |
| loyalty-service | `hydromart_loyalty` | … |
| promo-service | `hydromart_promo` | … |
| referral-service | `hydromart_referral` | … |
| crm-service | `hydromart_crm` | … |
| dashboard-service | — (no DB, BFF aggregator) | — |
| gateway-service | — (no DB, reverse proxy) | — |

## First-time setup

Requires Docker (Postgres 16 + Redis 7). From the repo root:

```bash
cp .env.example .env          # fill in secrets
npm install                   # installs deps + generates every Prisma client
npm run db:up                 # start Postgres + Redis, creates all per-service DBs
npm run db:migrate            # apply every service's migrations (prisma migrate deploy)
```

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm run db:up` / `db:down` | Start / stop the Postgres + Redis containers |
| `npm run db:validate` | Validate every Prisma schema (no database needed — CI-safe) |
| `npm run db:generate` | Regenerate every service's Prisma client |
| `npm run db:migrate` | Apply all pending migrations to the running databases |
| `npm run prisma:migrate:dev -w @hydromart/<svc>` | Create + apply a new migration for one service (dev) |

Each migration directory ships a hand-written `rollback.sql` alongside Prisma's
`migration.sql` for manual, reviewed rollbacks (Prisma has no built-in `down`).

## Notes

- **Schemas are validated in CI** (`db:validate`) but migrations are applied only
  against a running Postgres — the dev shell here has no Docker/psql, so migrations
  have not been executed in-repo; run the setup above in an environment with Docker.
- Every service uses a **service-local Prisma client output**
  (`prisma/generated/client`) so the hoisted `node_modules/@prisma/client` is never
  shared or clobbered across schemas.
- Connection strings come from each service's `*_DATABASE_URL` env var
  (see [`.env.example`](../.env.example)); never commit a real `.env`.
