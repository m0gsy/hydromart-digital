# Hydromart mobile (Capacitor / Android)

The native shell for the two Android binaries. The app itself is `apps/web` — this
directory contains no product code, only the wrapper that loads a bundled export of it.

| binary        | applicationId      | export                         | who signs in                |
| ------------- | ------------------ | ------------------------------ | --------------------------- |
| Hydromart     | `id.hydromart.app` | `apps/web/mobile-out-customer` | `CUSTOMER`                  |
| Hydromart Ops | `id.hydromart.ops` | `apps/web/mobile-out-ops`      | depot staff, kurir, manager |

## Why this is not `apps/mobile/`

`svc_of()` in `scripts/lib/deploy-common.sh` maps any path matching `apps/*/*` to a
Docker service name and deploys it. A Capacitor project under `apps/` would make every
commit here attempt to deploy a service that does not exist. Nothing matches `mobile/*`,
so this directory is invisible to deploys — which is correct: it ships through the Play
Store, not through the VPS.

For the same reason it is **outside the npm workspaces array** and keeps its own
`package-lock.json`. The Capacitor plugins are declared here and nowhere else; `apps/web`
reaches the bridge at runtime (`src/lib/capacitor.ts`) rather than importing
`@capacitor/*`, so there is only ever one version of each plugin and the browser bundle
is unchanged.

## Building

```bash
# 1. the web export for the binary you want (from the repo root)
npm run build:mobile customer --workspace @hydromart/web

# 2. copy it into the Android project
cd mobile && npm ci && npm run sync:customer

# 3. the AAB
cd android && ./gradlew bundleRelease \
  -PhydromartAppId=id.hydromart.app -PhydromartAppName=Hydromart \
  -PhydromartWebHost=<WEB_DOMAIN> -PhydromartLinkPrefix=/ \
  -PhydromartVersionCode=<n> -PhydromartVersionName=<x.y.z>
```

Swap `customer` for `ops`, the properties for `id.hydromart.ops` / `"Hydromart Ops"`, and
`-PhydromartLinkPrefix=/driver` — the two binaries must not claim the same URLs or a phone
with both installed asks which app to open on every link.

`.github/workflows/mobile.yml` does all of this on a `mobile-v*` tag and is the only thing
that produces a signed bundle; the release build is unsigned without `android/upload.jks`,
which CI writes from a secret and deletes afterwards.
`npm run sync:*` refuses to run against a missing or half-written export, because
`cap sync` will happily copy an empty one and produce an AAB that installs and opens to a
white screen.

Every Play upload needs a `versionCode` higher than any before it, across both tracks.

## Things that will break if changed

- **`server.androidScheme: 'https'`** in `capacitor.config.ts`. The app's origin is
  `https://localhost`, and that exact string is how the gateway decides to issue bearer
  tokens instead of cookies (`session-bff.ts`) and how the web code knows it is native
  (`platform.ts`). Change the scheme and the app stops being able to log in.
- **`MOBILE_API_URL`** at export time. Empty means `api.ts` falls back to
  `http://localhost:8080`, which Android blocks as cleartext — the symptom is an
  unreadable network error on every screen, not a clear failure.
- **New Capacitor plugins.** Anything with `READ_MEDIA_IMAGES` in its manifest drags the
  Play Photo & Video declaration in with it — and it arrives through an AAR, not through
  any file a person reads. `npm run audit:manifest` lists every permission our manifest
  and the installed plugins ask for; CI runs the same script against the real merged
  manifest after each bundle and fails on anything not justified in
  `docs/MOBILE_PLAY_STORE.md`.
- **The two `@aparajita/*` plugins (F3b).** `secure-vault.ts` calls their NATIVE method
  names (`internalGetItem`, `internalAuthenticate`), not the JS wrappers, because
  `apps/web` imports no plugin packages. A major-version rename would compile fine and
  fail on a phone, so both are pinned to an exact version rather than a range.

## Not in the repo

`android/app/google-services.json` (F4) and the signing keystore. Both are CI secrets;
`.gitignore` here refuses them.
