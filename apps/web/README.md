# @hydromart/web

Customer web app for Hydromart — browse the catalog, manage a cart, check out, pay,
and track order delivery. Next.js (App Router) + Tailwind v4, TypeScript.

## Architecture

- **Single ingress.** Every request goes through the API gateway (`NEXT_PUBLIC_API_URL`,
  default `http://localhost:8080`). Paths are built in [`src/lib/endpoints.ts`] as
  `/{service}/api/v1/...` — the gateway strips the first segment and forwards the rest.
- **Auth.** Phone + OTP (register / login) and rotating refresh tokens, handled by
  `auth-service`. Tokens live in `localStorage` via [`src/lib/session-store.ts`]; the
  API client ([`src/lib/api.ts`]) attaches the bearer token and transparently
  refreshes-and-retries once on a 401.
- **Data fetching** is client-side (`useAsync`) so the production build needs no
  running backend. Every list/detail screen implements loading, empty, error, and
  success states.

## Scripts

```bash
npm run dev        # http://localhost:3000
npm run build      # production build (no backend required)
npm run typecheck  # tsc --noEmit
npm run lint       # eslint, zero warnings
npm run test       # vitest (pure logic: formatting, endpoints, status, api client)
```

## Environment

Copy `.env.example` to `.env.local` and point `NEXT_PUBLIC_API_URL` at the gateway.
In local dev the OTP code is delivered to the `auth-service` console (or WhatsApp/SMS
adapters), not returned in the API response.
