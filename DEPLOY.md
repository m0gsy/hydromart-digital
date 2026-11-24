# Deploying Hydromart on a single VPS

A production single-host deploy with Docker Compose: base infra
(`docker-compose.yml` → Postgres) plus the production overlay
(`docker-compose.prod.yml` → the 18 microservices behind the gateway, the Next.js web app, the
`scheduler` sidecar, and the monitoring stack — 28 containers in all).

> **Day-to-day you do not run most of this by hand.** A merge to `main` runs CI, then
> `.github/workflows/deploy.yml` runs `scripts/deploy.sh` on the box: it applies pending migrations
> (after taking a dump), pulls the commit's images in registry mode, converges the stack, waits for
> health, smoke-tests, and rolls back on failure. The numbered steps below are the FIRST install and the
> manual fallback. `bash scripts/deploy.sh` is the manual form of the same thing.

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
- **Sizing (measured on the live box, 2026-09-24):** 28 containers idle at ~2.2 GB with 15 GiB present;
  the peaks that matter are image builds, which registry mode removes. **4 vCPU / 8 GB + 4 GB swap /
  80–100 GB NVMe** is the recommended target for ~50 depots in registry mode; grow it if CPU p95 stays
  above 60% or `MemAvailable` falls under 1.5 GB. The per-container ceilings in the compose file
  (512 MB each) add up to more than 8 GB on purpose — they are ceilings, not reservations.
- **Node.js 22+** on the host (`package.json` `engines` is `>=22.23.4 <23`; the containers are already
  `node:22`). The host runs the cron backup and the migration step. Node 20 reached end of life on
  30 April 2026 and AWS SDK v3 drops it in January 2027; `deploy.sh` reports a host below 22.
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

First run builds the images (slow — many minutes; with `IMAGE_PREFIX` set, see "Registry mode" below,
it pulls prebuilt ones instead). Watch them come up healthy:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

The app services will boot but return errors until migrations are applied
(next step) — their databases exist (init-databases.sql) but have no tables yet.

---

## 4. Run database migrations (first install only — `deploy.sh` does this for every later release)

`scripts/deploy.sh` applies a release's pending migrations itself, BEFORE any container starts on the new
code, after a fresh dump and after building new indexes concurrently (B-20, H-39). What follows is what it
runs, for a first install or a manual repair.

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
npm run db:migrate:prod   # derives every *_DATABASE_URL (16 databases) from POSTGRES_PASSWORD, then migrates
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
restarting, with the Caddy image the stack pins:

```bash
docker run --rm -e WEB_DOMAIN -e API_DOMAIN -v "$PWD/infra/caddy:/etc/caddy:ro" \
  "$(grep -o 'caddy:2-alpine@sha256:[0-9a-f]*' docker-compose.prod.yml)" \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

**More sites (HD-1).** The `Caddyfile` ends with `import sites/*.caddy`: one file per
extra site in `infra/caddy/sites/` (see its README). Their upstreams join the `edge`
network, never this project's default one. A release that changes anything under
`infra/caddy/` reloads Caddy, and a file that does not validate leaves the old config
serving and raises an alert.

---

## 7. Operations

```bash
# logs (all or one service)
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f order

# update to new code — merge to main and let deploy.yml do it, or by hand:
bash scripts/deploy.sh              # migrations, images, converge, health, smoke, rollback on failure
bash scripts/deploy.sh --all        # rebuild/pull everything

# stop (keeps volumes/data)
docker compose -f docker-compose.yml -f docker-compose.prod.yml down

# stop AND delete Postgres data — destructive
docker compose -f docker-compose.yml -f docker-compose.prod.yml down -v
```

> Tip: alias the long invocation once —
> `alias dcp='docker compose -f docker-compose.yml -f docker-compose.prod.yml'`.

### The AI web (HD-9) — a second compose project on this box

[`infra/aiweb/docker-compose.yml`](infra/aiweb/docker-compose.yml) runs the AI web
(m0gsy/hydromart-ai) as project `hydromart-ai`: `aiweb` (the app), `db` (its own Postgres, never
hydromart's), `migrate` (a one-shot job), and since AI-5 `n8n` with its one-shot `n8n-setup`
(see [n8n](#n8n-ai-5) below). Caddy serves it at `https://ai.hydromart-digital.com` from
[`infra/caddy/sites/aiweb.caddy`](infra/caddy/sites/aiweb.caddy) over the `edge` network, and
answers 404 for `/api/internal/*` (n8n's alarm route is the app's alone).

- **Every deploy** runs [`scripts/aiweb-secrets.sh`](scripts/aiweb-secrets.sh) before its
  converge and [`scripts/aiweb-deploy.sh`](scripts/aiweb-deploy.sh) after `DEPLOY OK`. The first
  makes, on the box, every key whose line is absent from `.env` (`AIWEB_*` database passwords,
  n8n's keys, `AI_TOKEN_SIGNING_KEY`, `TOTP_ENCRYPTION_KEY`, `AI_WEB_RETURN_URL`), through
  `env-set.sh`, never printing a value; `.env`'s nightly encrypted backup carries them off the
  box. It also keeps n8n's entry in `MACHINE_ACCOUNTS` (below), before the converge, so
  auth-service is recreated with it under the same deploy's gate.
  `TOTP_ENCRYPTION_KEY` is made only while `hydromart_auth.totp_credentials` is empty (a
  read-only count): over sealed secrets a new key would be data loss, so it writes nothing,
  alerts, and the old key comes back from the `.env` backup. The second pulls any missing image
  by digest (logged in with the Deploy job's own token, logged out at once), starts the
  database, applies [`infra/aiweb/roles.sql`](infra/aiweb/roles.sql) (`ai_owner` owns database
  `ai` and migrates; `ai_app` exists; `n8n` owns database `n8n`; each role may connect to its own
  database only), migrates as `ai_owner` (15 minutes at most), removes n8n and runs `n8n-setup`
  (5 minutes at most), only then gives `ai_app` its password
  ([`infra/aiweb/app-role.sql`](infra/aiweb/app-role.sql), row privileges only), starts the app
  and n8n until both are healthy, and probes. The probe tries every address of every running
  hydromart container on every TCP port it exposes, from inside the app's container and again
  from inside n8n's: only no answer at all (a timeout) or no route counts as isolated, while a
  connection or a refusal is a breach, and each one's own database must open or the probe counts
  itself blind. It also checks that only Caddy and `aiweb` sit on `edge` and only n8n on its
  `egress` network, that nothing publishes a host port but n8n's editor on `127.0.0.1:5678`, that
  no host port hydromart publishes opens, that the host's ssh answers neither at any gateway of
  their networks nor at the public address ([below](#the-hosts-ssh-closed-to-the-ai-web)), that
  the public URL answers, that the app and n8n both
  reach hydromart's API and the app reaches n8n, that n8n holds exactly what git holds
  (hydromart-ai's `drift.mjs`), and that `ai_app` holds exactly `INSERT, SELECT` on its two
  record tables and `INSERT, SELECT, UPDATE` on `hd_events`. Every target is printed with its
  outcome.
- **A failure there never fails hydromart's deploy.** It prints `[aiweb] !!` lines, alerts once
  (again when the reason or the release changes, else weekly) and leaves the AI web as it was:
  a refused pull or a failed migration does not touch the running app, nor the password it
  connects with. deploy.sh stops the step after 30 minutes.
- **A release is a PR** that changes the three `ghcr.io/m0gsy/hydromart-ai@sha256:` digests in
  the compose file: the app, `migrate`, and n8n (one digest on both `n8n` and `n8n-setup`);
  hydromart-ai's CI prints all three for every commit on its main. To go back, revert that PR; a
  migration it applied stays applied, so every AI web migration must be expand/contract: the
  release before it must still run on the new schema. n8n's workflows go back with it: its
  setup publishes the reverted image's copy of git.
- **Kill switch for AI tokens:** keep the line and blank it (`AI_TOKEN_SIGNING_KEY=` through
  deploy mode `env-set`, `services` = `auth`). Deleting the line instead makes a new key on the
  next deploy.
- **Its first appearance takes two deploys:** deploy.sh changes run one release late (its own
  header says why), so the deploy that merges HD-9 only reloads Caddy (the certificate). Press
  Deploy (mode `deploy`) once after it to bring the AI web up.

By hand, on the box:

```bash
alias dca='docker compose -f infra/aiweb/docker-compose.yml --env-file .env'
dca ps; dca logs -f aiweb
bash scripts/aiweb-deploy.sh --probe   # the isolation probe, against what runs now
bash scripts/aiweb-deploy.sh           # a full run; a missing image needs the Deploy workflow's token
bash scripts/aiweb-firewall.sh         # close the host's ssh to the AI web now (cron: every 5 minutes)
bash scripts/backup-aiweb-db.sh         # dump databases ai and n8n now (the 03:05 job)
bash scripts/backup-aiweb-db.sh --drill # restore the newest AI web dump into a scratch container
bash scripts/aiweb-n8n-check.sh         # n8n's drift check and its machine secret's day (the 04:40 job)
dca logs -f n8n                         # n8n's own log (a failed run is kept ~72 h, readable in the editor)
```

#### n8n (AI-5)

hydromart's events go to the AI web first (`POST /api/ingress/hd`, signed, recorded in its
`hd_events` before it answers); the AI web hands each one to n8n on the private network, and n8n
acts on hydromart only through `https://api.hydromart-digital.com`, with a machine account whose
token carries one capability (`franchiseApplicationNotify`). n8n is hydromart-ai's image (n8n
2.48.8 with its configuration locked in, the workflows from git and their setup): the compose file
gives it only its database, its encryption key and the editor's address. It sits on `private` and
its own `egress` network (its way to the public API, which nothing else joins), keeps nothing
outside its database (its `~/.n8n` is in memory), and publishes one port, the editor, on the box's
loopback only.

- **Every deploy** sets n8n up from git: `n8n-setup` stores the two credentials (the AI web's
  token, the machine account), unpublishes everything, imports and publishes the image's
  workflows, and checks the result; n8n then starts. A failed setup leaves n8n off (removed, so
  the watchdog cannot start it half set up) and the deploy reports the AI web as not deployed;
  events wait in `hd_events`, retried without end, until a deploy sets n8n up.
- **Keys**, made by `aiweb-secrets.sh` when their line is absent: `AIWEB_N8N_DB_PASSWORD`,
  `AIWEB_N8N_ENCRYPTION_KEY` (seals n8n's stored credentials: made once, never delete its line;
  it travels in the `.env` backup, and the weekly drill proves it still opens the backed-up
  credentials), `AIWEB_N8N_TOKEN` (the AI web and n8n, both ways), `AIWEB_N8N_MACHINE_ID`.
- **The machine secret** (`AIWEB_N8N_MACHINE_SECRET`, valid until `AIWEB_N8N_MACHINE_NOT_AFTER`)
  is rotated by any deploy from 30 days before its day: a new one until today + 89 days, and
  `MACHINE_ACCOUNTS` rewritten to keep the old entry (n8n holds it until that deploy's setup) and
  add the new one. Only n8n's entries are touched; another account's are kept as they are.
  `aiweb-secrets.sh` writes nothing if `MACHINE_ACCOUNTS` does not parse, or if the release being
  deployed has no capability `franchiseApplicationNotify` (auth-service would refuse to boot, and
  a rollback does not undo `.env`). The nightly check alerts when fewer than 14 days are left:
  press Deploy (mode `deploy`).
- **Nightly** at 04:40 [`scripts/aiweb-n8n-check.sh`](scripts/aiweb-n8n-check.sh) (log
  `/var/log/hydromart-aiweb-n8n.log`) runs hydromart-ai's `drift.mjs` inside n8n: what is
  published, and the credentials n8n holds, must be what the image's copy of git holds. A drift
  alerts once. Workflows change only by a PR in hydromart-ai and a release here; whatever is
  changed in the editor is drift, and the next deploy's setup unpublishes it.

**The editor**, through an ssh tunnel only (n8n's port is on the box's loopback):

```bash
ssh -L 5678:127.0.0.1:5678 hydromart@<box>
# then open http://localhost:5678 on your own machine
```

The first visit creates n8n's owner account. Do it at once, right after n8n first runs: until it
is done, whoever reaches that page first becomes the owner. Use a long unique password and turn on
two-factor authentication in the editor (Settings, Personal, per the access procedure); the
editor is for looking, not for changing workflows.

**Connecting hydromart's events (the owner, once):**

1. In hydromart's console at `/hq/webhooks` (SUPER_ADMIN), register
   `https://ai.hydromart-digital.com/api/ingress/hd` for `franchise.application_submitted` ONLY
   (never `delivery.delivered`, which carries a recipient's name). Copy the signing secret it
   shows once (64 hex characters).
2. Put `AIWEB_HD_EVENT_SECRET=<that secret>` in the `ENV_SET_BLOCK` repository secret, run Deploy
   with mode `env-set` and `services` left empty, then Deploy with mode `deploy`. The AI web is
   recreated with the secret; until then its ingress answers 503 and hydromart keeps retrying.

**Rotating that secret** (`contracts/ai-v1/events.openapi.json`, "Rotating the secret"): make a
new one (`openssl rand -hex 32`), set `AIWEB_HD_EVENT_SECRET_NEXT=<new>` (env-set, then deploy:
the AI web now accepts both), replace the endpoint's secret with
`PATCH https://api.hydromart-digital.com/admin/api/v1/webhooks/<id>` `{"secret":"<new>"}` as a
SUPER_ADMIN (the console has no rotate action yet), wait 5 minutes, then set
`AIWEB_HD_EVENT_SECRET=<new>` and `AIWEB_HD_EVENT_SECRET_NEXT=` (env-set, then deploy). Never
rotate by deleting and registering the endpoint again: that drops its queued deliveries.

**Kill switches**, fastest first:

- n8n off at once, on the box: `dca rm -sf n8n`. A removed container is one the watchdog leaves
  alone; the next deploy starts it again, unless the next switch is set too.
- n8n off and cut off from hydromart: keep `AIWEB_N8N_MACHINE_SECRET` and blank it (env-set, then
  deploy). Its entry leaves `MACHINE_ACCOUNTS` (auth refuses n8n from that deploy's converge), the
  AI web step removes n8n and never sets it up, the probe and the nightly check say "switched
  off". Events wait in `hd_events`. Back on: delete that line on the box (or, through the
  workflow, set it to any word with `AIWEB_N8N_MACHINE_NOT_AFTER=` blank) and deploy: a new
  secret is made and n8n set up with it.
- No event into the AI web: switch the endpoint off at `/hq/webhooks` (hydromart keeps what it
  queued and sends it when switched back on), or blank `AIWEB_HD_EVENT_SECRET` (env-set, then
  deploy: the ingress answers 503 and hydromart retries).
- Every AI and machine token: `AI_TOKEN_SIGNING_KEY` kept and blanked (above).

**A stuck event.** Each is a row of `hd_events` in database `ai`; the AI web retries a `PENDING`
one without end (30 s, 1, 2, 5, 10 minutes, then every 15) and tells on-call at the third
failure. As the database's superuser:

```bash
dca exec db psql -U postgres -d ai
```

```sql
-- what waits, and why
SELECT event_id, event, attempts, next_attempt_at, last_error, received_at
FROM hd_events WHERE state = 'PENDING' ORDER BY received_at;
-- try one again now (the sweep picks it up within 30 seconds)
UPDATE hd_events SET next_attempt_at = NULL WHERE event_id = '<eventId>' AND state = 'PENDING';
-- give one up for good: kept, never sent again, a replay of it deduped
UPDATE hd_events SET state = 'IGNORED', next_attempt_at = NULL,
  last_error = left('given up by <who> on <date>: <why>', 300)
WHERE event_id = '<eventId>' AND state = 'PENDING';
```

Never delete a row: `hd_events` is the dedupe ledger, and a deleted event would be processed
again when hydromart replays it.

Looked after between deploys (HD-9b), each apart from hydromart's own jobs so neither can fail or
hide the other:

- **Backups.** [`scripts/backup-aiweb-db.sh`](scripts/backup-aiweb-db.sh) dumps databases `ai`
  and `n8n` (one file: ai's dump, a `\connect n8n` line, n8n's) at
  03:05 next to hydromart's dumps, as `aiweb-<stamp>.sql.gz` (gzip, not encrypted, like
  hydromart's; 14 kept). `backup-offsite.sh --aiweb` copies it off the box at 03:22 under
  `<prefix>-aiweb/` with its own 14, `backup-second-provider.sh` copies it to the second provider
  at 04:00, `--drill` restores it weekly (Monday 04:45, log
  `/var/log/hydromart-aiweb-drill.log`) into a throwaway container on a throwaway internal
  network, with 512m of memory and half a CPU, and compares it with the live database; for n8n it
  then starts the image the live n8n runs on that network alone (1g, half a CPU, no capability),
  which must open one restored credential with the `AIWEB_N8N_ENCRYPTION_KEY` `.env` holds (the
  value is never printed). `check-backup-freshness.sh`
  alerts at 05:00 when any of that stopped. No dump is taken while the backup disk is 95% full
  (alerted). A missing AI web is said once a week; it never writes admin-service's backup card,
  which shows hydromart's verdict.
  If `install-host-cron.sh` could not create the drill's log (no passwordless sudo), it says so,
  installs the block anyway, and points the drill and the freshness check at
  `.deploy/hydromart-aiweb-drill.log` in the repo; n8n's nightly check likewise falls back to
  `.deploy/hydromart-aiweb-n8n.log`. Run once as the deploy user (sudo asks for its password),
  and the reinstall moves them back:

  ```bash
  sudo touch /var/log/hydromart-aiweb-drill.log /var/log/hydromart-aiweb-n8n.log
  sudo chown "$(id -un)" /var/log/hydromart-aiweb-drill.log /var/log/hydromart-aiweb-n8n.log
  bash scripts/install-host-cron.sh
  ```

- **Watchdog.** Every 5 minutes, after hydromart's own check, under the stack lock and for at most
  60 seconds: an `exited` or `created` `db`, `aiweb` or `n8n` is started again with `docker start`
  (the same container and image deploy left, never a pull or a compose `up`), the database
  first. Running but unhealthy, `restarting` (a crash loop), `paused`, `dead` and `removing` are
  alerted after two sightings and never started; those and a start that fails are said once per
  container until all run healthy again. `migrate` and `n8n-setup` are never touched, and a
  missing container (n8n switched off) is left to deploy.
- **docker-gc.** The weekly prune keeps the AI web images the compose file pins (n8n's
  included), those it pinned in the release before (a revert's rollback), and any a container
  uses, and removes the rest of that project's images. It leaves them all alone when the compose
  file pins no digest, and skips them (until next week) while a deploy holds the stack lock.

#### The host's ssh, closed to the AI web

The owner's decision of 24 November 2026: the box's ssh (TCP 22) answers nothing that comes from
the AI web's docker networks: `edge` (Caddy and the app), `hydromart-ai_private` (internal, but its
gateway is the host) and `hydromart-ai_egress` (n8n). SSH from anywhere else, the internet and the
Deploy workflow included, is exactly as it was.

- **What is closed.** [`scripts/aiweb-firewall.sh`](scripts/aiweb-firewall.sh) keeps a chain of
  its own, `AIWEB-NO-SSH`, holding `-i br-<first 12 of the network's id> -j DROP` for each of those
  networks, and one rule first in `INPUT`: `-p tcp --dport 22 -j AIWEB-NO-SSH`. No other `INPUT`
  rule and none of Docker's chains is touched. Matched by the bridge a packet comes in on, it
  closes every address of the host at once: each gateway, and the public address the AI web
  reaches hydromart by. IPv4 only: those networks are IPv4-only, and Docker leaves a container on
  one no IPv6 at all (the script refuses a network with IPv6 on).
- **Kept.** A reboot forgets the rules and a network made again gets a new bridge, so the AI web
  step of a deploy runs the script just before its probe (when it gets that far), and host cron
  every 5 minutes, whatever the deploy did (log
  `/var/log/hydromart-watchdog.log`; silent unless it wrote). It runs as the deploy user and gets
  root through `sudo -n`; without passwordless sudo it writes nothing, says so with `!!`, and
  alerts once.
- **Proved.** The probe asks port 22 at the gateway of every network the app and n8n are on and at
  `api.hydromart-digital.com:22`, from inside both containers. A connection is a breach and fails
  the AI web step; no answer, or a refusal, is closed; a name that does not resolve proves nothing
  and fails it too.
- **Check it**, on the box: `bash scripts/aiweb-deploy.sh --probe` prints one
  `host-ssh <address>:22 ... -> closed` line per address, from the app (`probe:`) and from n8n
  (`probe(n8n):`); `sudo iptables -S AIWEB-NO-SSH` lists one bridge per network
  (`docker network ls` shows each id) and `sudo iptables -S INPUT | head -2` the one jump, first.
- **Undo it**: revert the PR that brought `aiweb-firewall.sh` (its cron line, the deploy's call
  and the probe's verdict go with it) and deploy. The rules then stay until a reboot, or go at once
  with, on the box:

  ```bash
  sudo iptables -D INPUT -p tcp --dport 22 -j AIWEB-NO-SSH
  sudo iptables -F AIWEB-NO-SSH && sudo iptables -X AIWEB-NO-SSH
  ```

  Without the revert those two lines last 5 minutes at most: cron puts the rules back.

Not covered yet:

- **What the AI web may reach on the network is not all decided.** The probe prints whether it
  reaches the cloud metadata address (`169.254.169.254:80`) and never fails on it: the owner
  decides whether to block it. The host's ssh is decided, and closed (above).
- **The AI web's dumps are not encrypted**, exactly like hydromart's (D8 is still open): when D8
  lands it has to cover `aiweb-*.sql.gz` too.

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

### Registry mode — and what a rollback actually costs

`.github/workflows/images.yml` has always ended its header with _"The VPS opts in by
setting `IMAGE_PREFIX` + `IMAGE_TAG` in `.env` (see DEPLOY.md)"_. Until now this page
never mentioned `IMAGE_PREFIX`, so that sentence pointed at nothing.

**Two modes, and the difference only shows up on your worst day.**

|                  | `IMAGE_PREFIX` empty (until 2026-09-17)         | `IMAGE_PREFIX` set (**production, since 2026-09-17**) |
| ---------------- | ----------------------------------------------- | ----------------------------------------------------- |
| a deploy         | compiles 19 images **on this box**              | pulls 19 prebuilt images                              |
| a rollback       | recompiles them, **while the box is unhealthy** | pulls the target commit's images                      |
| what runs        | whatever this box built                         | the exact bytes CI tested                             |
| rollback targets | none — local images are tagged `:local`         | every SHA the registry still holds                    |

`scripts/rollback.sh` is the only way out of a bad release. With `IMAGE_PREFIX` empty it
falls through to `rebuild-stale.sh`, i.e. the remedy for a broken release is to recompile
every image on the machine that is already broken — over the parallel BuildKit path whose
daemon panic stopped all 25 containers on 2026-08-02. Every deploy now prints a
`rollback cost probe` line saying which mode is live and, using the image step it just
timed on this box, roughly what a rollback would cost in it.

**No credential is needed.** Measured 2026-08-29: `images.yml` publishes all 19 service
images to GHCR on every green CI, tagged with the commit SHA, and the packages are
**public** — an anonymous token pulled the manifest for every service at `main`'s HEAD
(HTTP 200; a package that does not exist returns 403). There is no `docker login`, no
personal access token and no repo secret to arrange first.

```bash
# 1. Prove this box can pull, BEFORE betting a release on it. Discovering a wrong
#    prefix mid-deploy is discovering it at the most expensive moment.
IMAGE_PREFIX=ghcr.io/m0gsy/hydromart-digital- IMAGE_TAG=$(git rev-parse HEAD) \
  bash scripts/check-registry-pull.sh

# 2. Only if that passed, make it the box's mode. The prefix is a PREFIX: it ends with
#    the dash, because docker-compose.prod.yml appends the service name to it
#    (`${IMAGE_PREFIX:-hydromart-}gateway`).
echo 'IMAGE_PREFIX=ghcr.io/m0gsy/hydromart-digital-' >> .env

# 3. Deploy as usual. Do NOT set IMAGE_TAG by hand — deploy.sh and rollback.sh each write
#    the commit they are shipping into .env, which is what keeps a bare
#    `docker compose up -d <svc>` resolving to the release that is actually running.
bash scripts/deploy.sh
```

Substitute your own owner/repo if this is a fork: the image name is
`ghcr.io/<owner>/<repo>-<service>`, lowercased, exactly as `images.yml` builds it.

To go back: delete the `IMAGE_PREFIX` line from `.env` and deploy. Nothing else changes —
compose falls back to `hydromart-<svc>:local` and the box builds its own images again.

**One caveat that is not optional.** `deploy.yml` and `images.yml` are both triggered by
_CI completed_, so they run in parallel: a deploy can arrive before its images exist.
`deploy.sh` already waits up to `IMAGE_WAIT_SECONDS` (default 600) and then aborts without
touching the running stack, so this is a slower deploy, never a broken one.

### Rolling back

```bash
# one step back — the previous good release, recorded by the last successful deploy
bash scripts/rollback.sh

# or to a specific commit (must be a commit this checkout has; in registry mode its
# images must still be in GHCR)
bash scripts/rollback.sh <sha>
```

`deploy.sh` writes `.deploy/prev-sha` (one step back) and `.deploy/last-good-sha` (what is
serving) after a **green** health check, and `.deploy/` is gitignored, so `git reset --hard`
during a deploy cannot erase them. Nothing else on the box records which release is live.

Code only. A migration that must also be undone is a separate step —
`scripts/restore-db.sh` against the dump `deploy.sh` takes immediately before migrating.

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
- **Alerts:** sixteen rules in `ops/alert-rules.yml` — availability (`ServiceDown`,
  `ServiceCrashLooping`), latency and errors (`HighErrorRate`, `HighLatencyP95`), runtime and host
  (`ExporterDown`, `EventLoopLagHigh`, `DiskSpaceLow`, `HostMemoryLow`, `ContainerOOMKilled`), datastores
  (`PostgresDown`, `PostgresConnectionsNearMax`, `PostgresDeadlocks`), and business
  (`NoOrdersCreated`, `CheckoutFailing`, `PaymentConfirmFailing`, `SchedulerSweepsSilent`). A firing
  critical inhibits same-service warnings so an incident pages once, not three times. What to do for
  each: [docs/RUNBOOK_INCIDENTS.md](docs/RUNBOOK_INCIDENTS.md); who is woken and how fast:
  [docs/RUNBOOK_ONCALL.md](docs/RUNBOOK_ONCALL.md). Everything above lives ON the box; the one check that
  does not is `.github/workflows/uptime.yml`, which asks production from GitHub every ten minutes.
- **View state:** Prometheus `Alerts` tab at `127.0.0.1:9090` (SSH-tunnel), or
  Alertmanager UI at `127.0.0.1:9093`. Both are loopback-only.
- **Validate after editing rules/config:**
  `docker run --rm --entrypoint promtool -v "$PWD/ops:/ops:ro" prom/prometheus:v2.54.1 check rules /ops/alert-rules.yml`
  and `... --entrypoint amtool ... prom/alertmanager:v0.27.0 check-config /ops/alertmanager.yml`.
