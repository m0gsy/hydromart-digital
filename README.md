# Hydromart

Digital platform for **refillable drinking-water depot operations** (depot air minum isi ulang) in Indonesia — unifying customer ordering, delivery, depot inventory, franchise management, and head-office reporting into one system.

- Depot ownership types: **HKP** (company-owned) and **Waralaba** (franchise).
- Surfaces: Customer app (web + mobile), Driver app, Admin Depot, Franchise Portal, Head Office Portal.
- Requirements: `docs/PRD.docx`, `docs/BRD.docx`.

## Tech stack

| Layer    | Choice                                          |
| -------- | ----------------------------------------------- |
| Language | TypeScript                                      |
| Backend  | NestJS — 18 services + a gateway, Prisma ORM    |
| Database | PostgreSQL, one database per service            |
| Web      | Next.js / React — one app, every surface        |
| Auth     | JWT access + rotating refresh tokens, phone OTP |
| Storage  | S3-compatible object storage (BiznetGio NEO)    |
| Observ.  | Prometheus + Alertmanager + Grafana (`ops/`)    |
| Deploy   | Docker Compose, single VPS, Caddy for TLS       |

There is no Redis and no message broker: the rate limiter keeps an in-process store,
and scheduled work is a database cursor driven by the `scheduler` sidecar.

Architecture overview: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Repository layout

```
hydromart/
├── services/                   NestJS services — each owns its database + Prisma schema
│   ├── gateway-service/        Public edge: routing, CORS, rate limit, session BFF (:8080)
│   ├── auth-service/           Identity, OTP, JWT, the RBAC matrix               (:3001)
│   ├── customer-service/       Profiles, addresses, consent + retention          (:3002)
│   ├── product-service/        Catalog, categories, pricing                      (:3003)
│   ├── order-service/          Cart, checkout, order lifecycle, outbox           (:3004)
│   ├── payment-service/        Payments, refunds, signed gateway webhook         (:3005)
│   ├── delivery-service/       Driver assignment, proof of delivery              (:3006)
│   ├── depot-service/          Depots, inventory, purchase orders, counter sales (:3007)
│   ├── dashboard-service/      Cross-service read models for the consoles        (:3008)
│   ├── loyalty-service/        Points, tiers, reward catalogue                   (:3009)
│   ├── promo-service/          Vouchers, promotions, budgets                     (:3010)
│   ├── referral-service/       Referral codes and qualification                  (:3011)
│   ├── crm-service/            Segments, campaigns, tickets                      (:3012)
│   ├── recommendation-service/ Reorder and product suggestions                   (:3013)
│   ├── forecast-service/       Demand forecasting                                (:3014)
│   ├── payout-service/         Franchise ledger, commissions, withdrawals        (:3016)
│   ├── admin-service/          Feature flags, API keys, webhooks, purge engine   (:3017)
│   └── hr-service/             HRIS: employees, attendance, payroll, leave       (:3018)
├── apps/web/                   Next.js app — customer, courier, depot, HQ surfaces
├── packages/
│   ├── platform/               Shared NestJS building blocks (@hydromart/platform)
│   └── access/                 The single RBAC capability map (@hydromart/access)
├── ops/                        Prometheus, Alertmanager, Grafana, daemon config
├── scripts/                    Deploy, migrate, backup, seed, load tests, CI gates
├── docs/                       Requirements (BRD/PRD), architecture, perf baseline
├── docker-compose.yml          Local PostgreSQL
├── docker-compose.prod.yml     The production overlay (see DEPLOY.md)
└── infra/caddy/Caddyfile       TLS termination, HSTS + CSP
```

Each service owns its own database and Prisma schema, consumes `@hydromart/platform`
for cross-cutting concerns (JWT/RBAC guards, exception filter, validation, settings),
and exposes Swagger at `/docs` — Basic-auth'd in production, or not mounted at all.
No service reads another's database; every call that crosses a boundary goes over HTTP
with the shared internal key. The order-service resolves authoritative prices from
product-service at checkout (never trusts client prices); the payment-service validates
the amount against the order before charging, and settles online methods via a gateway
adapter and a signed webhook.

## Prerequisites

- Node.js **>= 20** (developed on 25.x)
- npm **>= 10** (workspaces)
- Docker (needed to run PostgreSQL locally, or the whole stack)

## Getting started

```bash
# 1. Install all workspace dependencies
npm install

# 2. Configure environment
cp .env.example .env        # then edit secrets

# 3. Start PostgreSQL (Docker); the init script creates every per-service database
npm run db:up

# 4. Apply every service's migrations
npm run db:migrate

# 5. Seed a working dataset (depots, products, accounts)
npm run db:seed
```

Then run one service in watch mode
(`npm run start:dev --workspace @hydromart/auth-service`), or bring the whole stack up
with Docker — [`DEPLOY.md`](DEPLOY.md) is the production procedure and works locally
too. Each service serves OpenAPI at `/docs`.

## Quality gates

```bash
npm run typecheck   # tsc --noEmit across every workspace
npm run lint        # eslint, --max-warnings 0
npm run test:cov    # unit tests + the 98% coverage gate every workspace enforces
npm run audit:ci    # production dependency vulnerabilities (scripts/audit-gate.mjs)
npm run db:validate # every Prisma schema, no database needed
npm run build       # compile all workspaces
```

CI runs those plus static gates that each exist to stop one specific regression coming
back: index concurrency, API response documentation, frontend endpoint contracts, the
performance baseline's test references, and the env contract
(`scripts/check-env-contract.mjs` — an env var a service reads must be a key its Joi
schema validates).

Unit tests run **without a database** (repositories are mocked at the port boundary), so
they work even when Docker is unavailable. The integration and e2e jobs do use Docker.

## Where things are documented

| Question                                           | File                                             |
| -------------------------------------------------- | ------------------------------------------------ |
| How do I deploy, migrate, roll back, restore?      | [`DEPLOY.md`](DEPLOY.md)                         |
| How is the system laid out?                        | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)   |
| What does a hot path cost, and what pins it there? | [`docs/perf/BASELINE.md`](docs/perf/BASELINE.md) |
| How are large reads bounded?                       | [`docs/QUERY_BOUNDS.md`](docs/QUERY_BOUNDS.md)   |
| Databases, migrations, seeding                     | [`docs/DATABASE.md`](docs/DATABASE.md)           |
| How do I report a vulnerability?                   | [`SECURITY.md`](SECURITY.md)                     |
| Who must review what before merge                  | [`.github/CODEOWNERS`](.github/CODEOWNERS)       |

An M1–M4 milestone list used to sit here. Every surface it named has shipped and eleven
services it never mentioned exist, so it was describing a repository that no longer
exists — the audit's Q-18. Requirements of record remain `docs/PRD.docx` and
`docs/BRD.docx`.
