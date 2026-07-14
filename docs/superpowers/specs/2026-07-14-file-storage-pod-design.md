# File Storage — Proof-of-Delivery Uploads

**Date:** 2026-07-14
**Status:** Approved (design)
**Scope:** Backend upload flow for Proof-of-Delivery photo + signature. Kept simple.

## Problem

Proof of Delivery is BR-mandatory (photo + GPS + timestamp + signature). Today the
API only stores URL **strings** (`ProofOfDeliveryDto.photoUrl`, `.signatureUrl`) —
nothing uploads the bytes. The client is expected to already hold a URL that no
flow produces.

## Approach

One thin port + one local-disk adapter, **inside delivery-service**. No shared
package, no driver-switch factory, no dynamic module. Cloud later = swap one
provider line.

### Storage port + adapter

`services/delivery-service/src/infrastructure/storage/`

```ts
export interface StoragePort {
  // returns a publicly renderable URL for <img src>
  put(input: { body: Buffer; contentType: string; ext: string }): Promise<{ url: string }>;
}
```

`LocalDiskStorageAdapter`:
- key = `pod/<uuid>.<ext>` (random UUID → POD photos not enumerable)
- writes `STORAGE_LOCAL_DIR/<key>` (mkdir the `pod/` dir)
- returns `url = ${STORAGE_PUBLIC_BASE_URL}/uploads/<key>`

Bound in the module: `{ provide: STORAGE_PORT, useClass: LocalDiskStorageAdapter }`.
Cloud swap is that one line.

**Config** — two vars added to the existing `DeliveryConfigService`:

| Var | Default | Meaning |
|-----|---------|---------|
| `STORAGE_LOCAL_DIR` | `./var/uploads` | disk root |
| `STORAGE_PUBLIC_BASE_URL` | service base URL | prefix for returned URLs |

### Upload endpoint

- `main.ts`: create app as `NestExpressApplication`;
  `app.useStaticAssets(STORAGE_LOCAL_DIR, { prefix: '/uploads' })` so URLs render in
  a plain `<img>`. (No auth-gated streaming — `<img src>` can't send a bearer token;
  cloud prod serves public/signed URLs the same way.)
- New `UploadController`:
  - `POST /driver/deliveries/uploads`, `@Roles(Role.DRIVER)`
  - `FileInterceptor('file')` — multer ships with `@nestjs/platform-express`, no new dep
  - validate: contentType in `{image/jpeg, image/png, image/webp}`, size ≤ 5 MB
  - call `StoragePort.put(...)` → return `{ url }`
- `/complete` unchanged — still takes `photoUrl` + `signatureUrl` strings, now real
  uploaded URLs.

Driver-scoped route (not neutral `/uploads`): product images live in a different
service; the reusable unit is the port, not the route.

## Data Flow

1. Driver app captures photo + signature-canvas PNG client-side.
2. `POST /driver/deliveries/uploads` (multipart `file`) → `{ url }`. Twice (photo,
   signature).
3. `POST /driver/deliveries/:id/complete` with the two URLs → existing flow.

## Errors

| Case | Response |
|------|----------|
| Non-image contentType | 400 |
| Size > 5 MB | 413 |
| Missing file | 400 |
| Disk write failure | 500 via existing `AllExceptionsFilter` |

## Testing

- Unit: `LocalDiskStorageAdapter.put` writes the file and returns the expected
  `/uploads/pod/<uuid>.<ext>` URL.
- e2e: upload rejects non-image (400) and oversize (413); accepts a PNG and returns
  a `{ url }` resolving under `/uploads`.

## Out of scope (flagged)

- Product-image upload — later, same port pattern, own admin-guarded endpoint.
- Cloud adapter — swap the one provider line when a bucket is provisioned (GCS,
  matching the GCP stack).
- Driver frontend capture UI — verify it exists in `apps/web`; may be a separate task.
