# Security policy

Hydromart handles customer addresses and phone numbers, payment records, employee
payroll and biometric templates. Treat a finding in any of those paths as serious by
default.

## Reporting a vulnerability

**Do not open a public GitHub issue.** Report privately, in this order of preference:

1. GitHub **Security Advisories** — the _Security_ tab → _Report a vulnerability_.
   This keeps the report and the fix private until a release exists.
2. Failing that, e-mail the repository owner listed in
   [`.github/CODEOWNERS`](.github/CODEOWNERS).

Please include: what you did, what happened, what you expected, and the smallest
input that reproduces it. A proof-of-concept request or a failing test is worth more
than a scanner's output.

What to expect: an acknowledgement within **3 working days** and an assessment
within **10**. A confirmed issue on an authentication, payment, payroll or biometric
path is fixed before other work. We will tell you when the fix ships, and we are
happy to credit you unless you ask otherwise.

## Scope

**In scope:** anything in this repository and the running deployment it describes —
authentication and session handling, RBAC and depot scoping, the internal
service-to-service key, payment and refund flows, the payout ledger, PoD and
attendance photos, face embeddings, exports and the bulk-import paths.

**Out of scope:** findings that need a compromised device or an already-authenticated
staff session to work; missing hardening headers on endpoints that serve no HTML;
rate-limit tuning; results from automated scanners with no demonstrated impact;
denial of service by traffic volume alone.

## Supported versions

There is one deployment and one supported version: whatever `main` is. There are no
maintenance branches and no backports — a fix ships from `main`.

## What the repository already enforces

Worth knowing before reporting, and worth keeping true:

- **Dependencies.** `npm run audit:ci` fails CI on any unreviewed high/critical
  advisory in production dependencies. Accepted residuals live in an allowlist in
  [`scripts/audit-gate.mjs`](scripts/audit-gate.mjs), each with a written reason and
  an upgrade path — that list is the triage record, not a mute button.
- **Transport.** Caddy terminates TLS and sets HSTS plus a Content-Security-Policy
  ([`Caddyfile`](infra/caddy/Caddyfile)). A deploy without the `tls` profile has neither; that
  posture is for testing only.
- **Secrets.** Every secret comes from the environment; the production overlay uses
  `${VAR:?}` so a missing one fails the deploy rather than starting with a default.
  `scripts/generate-secrets.sh` emits strong values. Boot-time validation rejects a
  production value that still contains a dev placeholder.
- **Logs.** `authorization`, `cookie`, `refreshToken`, `idToken` and `code` are
  redacted. Unhandled 5xx alerts are scrubbed of credentials, secrets, e-mail
  addresses and phone numbers before they leave the process
  ([`packages/platform/src/nest/error-alerter.ts`](packages/platform/src/nest/error-alerter.ts)).
- **Authorization.** One capability map (`@hydromart/access`) backs both the NestJS
  guards and the web console, so the two cannot drift. Depot scoping fails closed.
- **Callers outside the platform (HD-2).** The AI web and machine accounts (n8n) use
  ES256 tokens that only auth-service can sign; they never hold `JWT_ACCESS_SECRET` or
  `INTERNAL_SERVICE_KEY`. Such a token reaches only routes marked `@ExternalAccess`
  (403 elsewhere). A machine account may use exactly the capabilities its token lists.
  Services verify against the keys auth-service publishes and re-read them every 30
  seconds: publishing an empty set switches every AI and machine token off, and a set
  that cannot be re-read is trusted for 60 seconds, then not at all. Their requests are
  rate-limited per account, and a change they make is written to the audit trail before
  it runs, or refused. See
  [`packages/platform/src/nest/external-access.ts`](packages/platform/src/nest/external-access.ts).
  auth-service signs them (HD-3) with `AI_TOKEN_SIGNING_KEY`; leaving it blank is the
  kill switch. A person gets one only through a 60-second, single-use PKCE handoff from
  their own staff session; a machine account only with its secret, which expires within
  90 days. Tokens last 15 minutes and are never refreshed. See
  [`services/auth-service/src/application/services/external-access.service.ts`](services/auth-service/src/application/services/external-access.service.ts).
- **Personal data.** Consent and retention are enforced by a purge engine, not by
  intent; export and erasure paths exist for UU PDP.

## If you find a leaked secret

Assume it is disclosed and say so immediately — rotation is cheap, a quiet
"probably fine" is not. `INTERNAL_SERVICE_KEY` authenticates as SUPER_ADMIN on every
service, so it is the one to report first and rotate first.
