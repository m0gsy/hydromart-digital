# File Storage — Proof-of-Delivery Uploads

**Date:** 2026-07-14
**Status:** Approved (design)
**Scope:** Backend upload flow for Proof-of-Delivery photo + signature.

## Problem

Proof of Delivery is BR-mandatory (photo + GPS + timestamp + signature). Today the
API only stores URL **strings** (`ProofOfDeliveryDto.photoUrl`, `.signatureUrl`) —
there is no way to actually upload the bytes. The client is expected to already
hold a URL, which no flow produces. Same gap exists for product `imageUrl`, out of
scope here.

## Goals

- A storage abstraction usable across services, swappable dev ↔ cloud (mirrors the
  OTP delivery port/adapter pattern).
- A working local-disk adapter for development.
- An authenticated upload endpoint the driver app calls to turn captured
  photo/signature bytes into a URL.
- Leave `/complete` untouched — it keeps taking `photoUrl` + `signatureUrl`
  strings, now populated with real uploaded URLs.

## Non-Goals (flagged for follow-up)

- **Product-image upload** — later; reuses the same `StoragePort` via its own
  admin-guarded endpoint in product-service.
- **Cloud adapter** — documented stub only; no cloud creds to test against yet.
  Prod provider (GCS, matching the GCP stack) implemented when the bucket is
  provisioned.
- **Driver frontend capture UI** — verify whether it exists in `apps/web`; capture
  wiring (camera + signature canvas → upload call) may be a separate task.

## Architecture

### Shared: `StorageModule` in `@hydromart/platform`

Lives at `packages/platform/src/storage/`. Cross-service, unlike the auth-local OTP
port.

**Port**

```ts
export interface StoragePutInput {
  body: Buffer;
  contentType: string;
  prefix: string;   // logical bucket/folder, e.g. 'pod'
  ext: string;      // file extension without dot, e.g. 'jpg'
}
export interface StoragePutResult {
  url: string;      // publicly renderable in <img src>
  key: string;      // storage key, e.g. 'pod/<uuid>.jpg'
}
export interface StoragePort {
  put(input: StoragePutInput): Promise<StoragePutResult>;
}
```

**`LocalDiskStorageAdapter`** (dev)

- Key = `<prefix>/<uuid>.<ext>` — random UUID so POD photos are not enumerable.
- Writes to `STORAGE_LOCAL_DIR/<key>` (mkdir -p the prefix dir).
- Returns `url = ${STORAGE_PUBLIC_BASE_URL}/uploads/<key>`.

**Cloud** — `// TODO GCSStorageAdapter` documented stub. Same port; returns the
provider's public/signed URL.

**Selection** — `useFactory` switch on `STORAGE_DRIVER` env (`local` default),
identical shape to the OTP `OtpDeliveryPort` factory in `auth.module.ts`.

**Config (env)**

| Var | Default | Meaning |
|-----|---------|---------|
| `STORAGE_DRIVER` | `local` | `local` \| (future) `gcs` |
| `STORAGE_LOCAL_DIR` | `./var/uploads` | disk root for local adapter |
| `STORAGE_PUBLIC_BASE_URL` | service base URL | prefix for returned URLs |

Production env validation should reject `STORAGE_DRIVER=local` (same posture as the
OTP console channel), when the cloud adapter lands.

### delivery-service wiring

- `main.ts`: create app as `NestExpressApplication`. When driver is `local`,
  `app.useStaticAssets(STORAGE_LOCAL_DIR, { prefix: '/uploads' })` so stored URLs
  render in a plain `<img>`. (Auth-gated streaming is rejected: an `<img src>`
  cannot send a bearer token; cloud prod uses public/signed URLs the same way.)
- New `UploadController`:
  - `POST /driver/deliveries/uploads`, `@Roles(Role.DRIVER)`.
  - `FileInterceptor('file')` — multer ships with `@nestjs/platform-express`, no new
    dependency.
  - Validate: `contentType` in `{image/jpeg, image/png, image/webp}`; size ≤ 5 MB.
  - `StoragePort.put({ prefix: 'pod', ... })` → returns `{ url }`.
- `/complete` unchanged.

Driver-scoped, not a neutral `/uploads`: product images live in a **different
service**, so the shared unit is `StoragePort`, not the route. A neutral route here
would leak driver-auth onto something pretending to be generic.

## Data Flow

1. Driver app captures photo + signature-canvas PNG client-side.
2. `POST /driver/deliveries/uploads` (multipart `file`) → `{ url }`. Called twice
   (photo, then signature).
3. `POST /driver/deliveries/:id/complete` with the two URLs → existing PoD flow,
   untouched.

## Error Handling

| Case | Response |
|------|----------|
| Non-image `contentType` | 400 Bad Request |
| Size > 5 MB | 413 Payload Too Large |
| Missing file | 400 |
| Disk/provider write failure | 500 via existing `AllExceptionsFilter` |

## Testing

- Unit: `LocalDiskStorageAdapter.put` writes the file to `STORAGE_LOCAL_DIR/<key>`
  and returns `url === ${STORAGE_PUBLIC_BASE_URL}/uploads/<key>` with the right
  extension.
- Unit/e2e: upload endpoint rejects non-image mime (400) and oversize (413);
  accepts a valid PNG and returns a `{ url }` that resolves under `/uploads`.

## Open Question (resolved)

Endpoint naming → driver-scoped `POST /driver/deliveries/uploads` (see wiring).
