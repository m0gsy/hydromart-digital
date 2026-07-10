# Hydromart

Digital platform for **refillable drinking-water depot operations** (depot air minum isi ulang) in Indonesia — unifying customer ordering, delivery, depot inventory, franchise management, and head-office reporting into one system.

- Depot ownership types: **HKP** (company-owned) and **Waralaba** (franchise).
- Surfaces: Customer app (web + mobile), Driver app, Admin Depot, Franchise Portal, Head Office Portal.
- Requirements: `docs/PRD.docx`, `docs/BRD.docx`.

## Tech stack

| Layer    | Choice                                          |
| -------- | ----------------------------------------------- |
| Language | TypeScript                                      |
| Backend  | NestJS (microservices), Prisma ORM              |
| Database | PostgreSQL                                      |
| Cache    | Redis (optional in dev)                         |
| Web      | Next.js / React (customer app)                  |
| Auth     | JWT access + rotating refresh tokens, phone OTP |
| Deploy   | Docker → Google Cloud Run                       |

Architecture overview: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Repository layout

```
hydromart/
├── services/         Backend microservices (NestJS)
│   └── auth-service/ Authentication & identity (Milestone 1)
├── apps/             Frontend apps (Next.js) — added per milestone
├── packages/         Shared libraries — extracted when >1 service needs them
├── docs/             Requirements (BRD/PRD) + architecture docs
└── docker-compose.yml  Local PostgreSQL + Redis
```

## Prerequisites

- Node.js **>= 20** (developed on 25.x)
- npm **>= 10** (workspaces)
- Docker (optional — only needed to run PostgreSQL/Redis locally)

## Getting started

```bash
# 1. Install all workspace dependencies
npm install

# 2. Configure environment
cp .env.example .env        # then edit secrets

# 3. Start infrastructure (requires Docker)
docker compose up -d

# 4. Apply the auth-service database schema
npm run auth:migrate

# 5. Run the auth-service in watch mode
npm run auth:dev
```

The auth-service serves OpenAPI/Swagger docs at `http://localhost:3001/docs`.

## Quality gates

```bash
npm run typecheck   # tsc --noEmit across workspaces
npm run lint        # eslint
npm run test        # unit + integration tests
npm run build       # compile all workspaces
```

Unit tests run **without a database** (repositories are mocked at the port boundary), so `npm test` works even when Docker is unavailable.

## Milestones

Milestone 1 (this release): **Authentication** — phone registration + OTP, phone login, Google Sign-In, JWT access/refresh, session management. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full MVP roadmap.
