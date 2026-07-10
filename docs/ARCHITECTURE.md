# Hydromart — Architecture

> Living document. Updated at the end of every milestone (per `.claude/MEMORY_PROTOCOL.md`).

## 1. Context

Hydromart digitizes the operations of a network of refillable drinking-water depots
(~50 today, targeting 100+). It replaces phone/WhatsApp ordering and manual
spreadsheets with a single platform spanning customers, drivers, depots, franchise
owners, and head office.

Non-functional targets (PRD §20): 99.9% uptime; Login < 2s, Checkout < 3s,
Dashboard < 5s; scale to 1,000+ orders/day and 100,000+ customers; JWT + refresh,
RBAC, TLS 1.3, AES-256 at rest, audit logging.

## 2. Architecture style

**Microservices** behind an API gateway, one service per bounded context. Each
service owns its own database schema (no cross-service DB access) and communicates
over REST (`/api/v1/...`). This matches PRD §23–25.

```
                    ┌──────────────┐
   Customer Web ───▶│              │
   Driver App    ──▶│  API Gateway │──▶ auth-service        (identity, OTP, JWT)
   Admin Depot   ──▶│  (routing,   │──▶ customer-service    (profile, addresses)
   HO Portal     ──▶│   authn edge,│──▶ order-service
                    │   rate limit)│──▶ delivery-service
                    └──────────────┘──▶ payment-service
                                    └─▶ inventory / crm / reporting …
                          │
                          ▼
                  PostgreSQL (per-service schema) · Redis · Object Storage
```

Bounded contexts follow the PRD data model: Customer, Order, Product, Inventory,
Delivery, Payment, Depot, Franchise, CRM, Reporting.

Cross-cutting building blocks (DomainError, Role, JWT/Roles guards, decorators,
exception filter, validation pipe, request-context) are shared via the
`@hydromart/platform` package (`packages/platform`) — consumed by all services
except auth-service, which predates it and remains self-contained. Each service
verifies auth-service's JWT access tokens using the shared `JWT_ACCESS_SECRET`.
Each service owns its own Prisma client (custom generator `output`) so the hoisted
`node_modules/@prisma/client` is never shared across schemas.

### Deployment target

Docker images → Google Cloud Run; Cloud SQL (PostgreSQL); Memorystore (Redis);
Secret Manager for secrets; Cloud Build CI/CD; Artifact Registry. Firebase Hosting
for the web frontends.

## 3. Service internal architecture (Clean Architecture / DDD)

Every service is layered so dependencies point inward (SOLID / Dependency Rule):

```
interface/        Controllers, DTOs, guards, filters, Swagger  (HTTP edge)
   │  depends on
application/       Use-case services, ports (interfaces)        (orchestration)
   │  depends on
domain/            Entities, value objects, domain errors, rules (pure, no I/O)
   ▲  implemented by
infrastructure/    Prisma repositories, external adapters, config, logging
```

- **Ports & adapters**: the application layer declares interfaces (e.g.
  `OtpDeliveryPort`, `CustomerRepository`); `infrastructure/` provides concrete
  adapters. Business logic never imports Prisma or HTTP directly.
- **Dependency injection** via NestJS providers + injection tokens.
- Enables unit tests that run **without a database** by substituting in-memory/mock
  adapters at the port boundary.

## 4. Milestone 1 — auth-service

Implements PRD Module 1 (Authentication, FR-001…010) and the related business rules.

| Endpoint                          | Purpose                                  | FR / BR            |
| --------------------------------- | ---------------------------------------- | ------------------ |
| `POST /api/v1/auth/register`      | Start phone registration, issue OTP      | FR-001, FR-002     |
| `POST /api/v1/auth/otp/verify`    | Verify OTP, activate account, issue JWTs | FR-003/004, BR-002 |
| `POST /api/v1/auth/otp/resend`    | Resend OTP (cooldown enforced)           | FR-002             |
| `POST /api/v1/auth/login`         | Phone login → issue OTP challenge        | FR-005             |
| `POST /api/v1/auth/google`        | Google Sign-In (verify ID token)         | FR-006             |
| `POST /api/v1/auth/token/refresh` | Rotate refresh token, new access token   | FR-005             |
| `POST /api/v1/auth/logout`        | Revoke a refresh token (one session)     | FR-008             |
| `POST /api/v1/auth/logout/all`    | Revoke all sessions (multi-device)       | FR-010             |
| `GET  /api/v1/auth/me`            | Current authenticated identity           | FR-009             |
| `GET  /api/v1/sessions`          | List active sessions (devices)           | FR-010             |
| `GET  /health`                    | Liveness/readiness                       | NFR                |

### Enforced business rules

- **BR-001** one phone number ↔ at most one account (unique constraint + guard).
- **BR-002** OTP valid ≤ 5 minutes (`OTP_TTL_SECONDS`), single-use, max attempts,
  resend cooldown.
- JWT: short-lived access token + long-lived **rotating** refresh token (reuse of a
  rotated/revoked refresh token revokes the whole family — theft detection).
- RBAC scaffolding: `Role` claim (`CUSTOMER` default) + `RolesGuard` for downstream
  services.
- Audit log for every security-relevant event (register, verify, login, refresh,
  logout, failures).

### Data model (auth schema)

- `Customer` — identity (id, phone unique, email nullable-unique, fullName, role,
  status, googleSub nullable-unique, timestamps).
- `OtpToken` — hashed OTP code, purpose, expiresAt, attempts, consumedAt.
- `RefreshToken` — hashed token, family id, expiresAt, revokedAt, replacedById,
  device metadata.
- `AuditLog` — actor, action, ip, userAgent, metadata, createdAt.

OTP codes and refresh tokens are **hashed at rest** (never stored in plaintext).

## 5. MVP roadmap

| Milestone | Scope                                              | Status         |
| --------- | -------------------------------------------------- | -------------- |
| M1        | Authentication                                     | Done           |
| M2        | Customer profile + addresses, Product catalog      | Done           |
| M3        | Cart → Checkout → Payment                          | Planned        |
| M4        | Order management + Delivery (proof of delivery)     | Planned        |
| M5        | Depot management + Inventory                        | Planned        |
| M6        | Operational dashboard; API gateway hardening        | Planned        |

Release 2: Loyalty, Membership, Voucher, Referral, CRM, WhatsApp automation.
Release 3: BI/Franchise dashboards, AI recommendation, dynamic pricing.

## 6. Cross-cutting standards

- **Validation** — `class-validator` DTOs; whitelist + forbid unknown fields.
- **Errors** — domain errors mapped to RFC-7807-style problem responses by a global
  exception filter; standard HTTP codes (PRD §21).
- **Logging** — structured JSON (`nestjs-pino`), request id correlation, secrets
  redacted.
- **Config** — validated at boot (`@nestjs/config` + Joi schema); no hardcoded
  secrets or URLs.
- **Security** — Helmet, CORS allow-list, rate limiting on public endpoints,
  bcrypt/argon2-grade hashing for secrets.
- **Docs** — OpenAPI/Swagger generated from decorators at `/docs`.
