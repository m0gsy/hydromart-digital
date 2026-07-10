# auth-service

Hydromart's authentication & identity microservice (Milestone 1). Implements PRD
Module 1 (Authentication, FR-001…010) with phone-OTP registration/login, Google
Sign-In, and rotating JWT sessions.

## Architecture

Clean Architecture / DDD layering (dependencies point inward):

```
interface (controllers, DTOs, guards, filters)  →  src/modules, src/common
application (use-cases + ports)                  →  src/application
domain (entities, value objects, rules)          →  src/domain
infrastructure (Prisma, adapters, crypto)        →  src/infrastructure
```

The application layer declares **ports** (interfaces) that infrastructure adapters
implement, so business logic is testable without a database. See
[`../../docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md).

## API

Base path: `/api/v1`. Interactive docs (Swagger) at `/docs`.

| Method & path                | Auth   | Purpose                                     |
| ---------------------------- | ------ | ------------------------------------------- |
| `POST /auth/register`        | public | Start phone registration → sends OTP        |
| `POST /auth/otp/verify`      | public | Verify OTP → activates account, issues JWTs |
| `POST /auth/otp/resend`      | public | Resend OTP (cooldown enforced)              |
| `POST /auth/login`           | public | Start phone login → sends OTP               |
| `POST /auth/google`          | public | Google Sign-In → issues JWTs                |
| `POST /auth/token/refresh`   | public | Rotate refresh token → new session          |
| `GET  /auth/me`              | bearer | Current identity                            |
| `GET  /sessions`             | bearer | List active device sessions                 |
| `POST /auth/logout`          | bearer | Revoke one session                          |
| `POST /auth/logout/all`      | bearer | Revoke all sessions                         |
| `GET  /health`               | public | Liveness + DB readiness                     |

### Example

```bash
# 1. Register (OTP is logged to the console in dev)
curl -X POST localhost:3001/api/v1/auth/register \
  -H 'content-type: application/json' \
  -d '{"phone":"081234567890","fullName":"Budi"}'

# 2. Verify the OTP to receive tokens
curl -X POST localhost:3001/api/v1/auth/otp/verify \
  -H 'content-type: application/json' \
  -d '{"phone":"081234567890","code":"123456","purpose":"REGISTRATION"}'
```

## Security & business rules enforced

- BR-001 one phone ↔ one account (unique constraint + guard).
- BR-002 OTP ≤ 5 min, single-use, max attempts, resend cooldown.
- OTP codes and refresh tokens are **hashed at rest** (bcrypt / HMAC-SHA256).
- Refresh-token **rotation with reuse detection** (revokes the family on replay).
- Global JWT guard (secure by default) + `@Public()` opt-out; `@Roles()` RBAC.
- Helmet, CORS allow-list, rate limiting, strict request validation, audit logging.

## Development

```bash
npm run start:dev        # watch mode (needs Postgres — see root docker-compose)
npm run prisma:migrate:dev
npm test                 # 97 tests, runs without a database
npm run test:cov         # coverage
npm run typecheck && npm run lint && npm run build
```

## OTP delivery

Selected by `OTP_DELIVERY_CHANNEL`: `console` (dev, logs the code), `whatsapp`
(WhatsApp Business Cloud API), or `sms` (generic gateway). Provider credentials are
required and validated at boot when a live channel is selected.
