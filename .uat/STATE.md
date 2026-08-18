# UAT run — working state

Goal: execute every case in `UAT_Script_Hydromart_v2.1.xlsx` (439 cases, 29 modules,
plus the 199-page coverage sheet) and write the results back into a filled workbook.

Source workbook: `C:\Users\IDEAPAD SLIM 3\Downloads\UAT_Script_Hydromart_v2.1.xlsx`
Parsed to: `../uat.json` (all sheets) and `../cases.txt` (flattened cases)
API route map: `../routes.txt` (458 routes, gateway-prefixed)

## Environment — Docker (decided)
Running the mesh natively from `services/*/dist` FAILS: every service that registers
`APP_GUARD: JwtAuthGuard` inside its feature module dies at boot with
`Nest can't resolve dependencies of the JwtAuthGuard (?, JwtService, ConfigService)`.
Only auth-service boots. This is an artifact of running out of the monorepo root
node_modules — the Docker images boot fine — so it is NOT a product defect.
`stack.mjs` is kept for reference but is not the runtime.

Runtime: `docker compose -f docker-compose.yml -f docker-compose.prod.yml`
Images are rebuilt **one service at a time** (`../buildall.sh`); parallel builds blow
the 8 GB Docker VM ("session healthcheck failed fatally").

Gotcha that cost time: a stale Docker stack from a previous session was still
serving `localhost:8080` (restart: unless-stopped + Docker Desktop autostart), so
early results came from months-old images. Always `docker ps` first.

## Harness
- `lib.mjs` — HTTP client, JWT minting, OTP capture from `docker compose logs auth`,
  result recording. OTP verify/resend need `purpose: REGISTRATION|LOGIN`.
- `m01-auth.mjs`, `m02-m05.mjs`, `m06-m07.mjs`, … one file per module group
- `run.mjs` — driver: provisions role tokens, runs modules, writes `results.json`
- `fill.py` — writes results back into the workbook

## Status
- [x] workbook parsed, cases + routes extracted
- [x] harness core + M1..M7 written
- [x] images rebuilt + stack up + seeded
- [x] M8..M29 written — 16 module files, m01 through m26-m29
- [x] full run — `results.json` holds all **439** cases
- [ ] 199-page smoke
- [ ] workbook filled (`fill.py` writes into the source workbook, which lives outside this repo)

## Last recorded run

**398 Pass / 36 N/A / 5 Blocked** (`results.json`). The 2026-07-27 baseline in the go-live
plan was 368 / 34 / 37 — the settlement, courier-balance and approval clusters are what
moved, which is exactly what PR-D and the seeded fixtures unblocked.

Two harness defects the plan names are already repaired, and both carry the comment that
explains them rather than only the fix:
- **M11-06** `from is not defined` — `from`/`to` were block-scoped to the earlier report
  cases; this one now makes its own.
- **M21-03** `Cannot read properties of undefined (reading 'slice')` —
  `JSON.stringify(undefined)` is `undefined`, not `"undefined"`, so an empty body crashed
  the failure branch that was trying to report the failure.

Re-running no longer needs anybody's laptop: the **UAT workflow** boots this stack from the
repo's own orchestrator and uploads `results.json` as an artifact. It is report-only on
purpose — five cases in the script contradict deliberate design decisions, so a red run
would mean "the script disagrees with us", not "the product is broken".
