# PoD File Storage Upload — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the driver app a way to upload Proof-of-Delivery photo + signature bytes and get back a URL, replacing the current "client must already hold a URL" gap.

**Architecture:** A thin `StoragePort` + one `LocalDiskStorageAdapter` live inside delivery-service (hexagonal, mirrors the OTP port/adapter pattern). A new `POST /driver/deliveries/uploads` endpoint takes a multipart file, validates it, writes it via the port, and returns `{ url }`. Uploaded files are served statically from the service so the URL renders in a plain `<img>`. `/complete` is untouched — it still takes `photoUrl` + `signatureUrl` strings, now populated with real uploaded URLs.

**Tech Stack:** NestJS 10, `@nestjs/platform-express` (multer, already a dep), Jest + ts-jest, Node `fs/promises`.

## Global Constraints

- Accepted MIME types: `image/jpeg`, `image/png`, `image/webp` — nothing else.
- Max file size: **5 MB** (`5 * 1024 * 1024` bytes).
- Storage key format: `pod/<uuid>.<ext>` (random UUID → POD photos not enumerable).
- Local-disk URL: `${STORAGE_PUBLIC_BASE_URL}/uploads/<key>`.
- `/complete` and `ProofOfDeliveryDto` are **NOT** modified.
- Cloud (Cloudflare R2 via `@aws-sdk/client-s3`) is a **documented stub only** — no code this plan.
- Port + adapter live in delivery-service (`src/application/ports/`, `src/infrastructure/storage/`). No shared package.
- Follow existing patterns: DI tokens in `src/application/tokens.ts`, config getters on `DeliveryConfigService`, Joi in `src/config/env.validation.ts`.
- **Prod-gateway routing of `/uploads` is out of scope** — prod will use R2 (public bucket URL, no gateway). Local-disk serving is verified against the service directly.

---

### Task 1: Storage port + local-disk adapter + config

**Files:**
- Create: `services/delivery-service/src/application/ports/storage.port.ts`
- Modify: `services/delivery-service/src/application/tokens.ts`
- Create: `services/delivery-service/src/infrastructure/storage/local-disk-storage.adapter.ts`
- Modify: `services/delivery-service/src/config/env.validation.ts`
- Modify: `services/delivery-service/src/config/delivery-config.service.ts`
- Test: `services/delivery-service/test/unit/local-disk-storage.adapter.spec.ts`

**Interfaces:**
- Produces: `StoragePort.put(input: StoragePutInput): Promise<StoragePutResult>` where
  `StoragePutInput = { body: Buffer; contentType: string; ext: string }` and
  `StoragePutResult = { url: string; key: string }`.
- Produces: `DELIVERY_TOKENS.Storage` (Symbol) — DI token for the port.
- Produces: `DeliveryConfigService.storageLocalDir: string`, `.storagePublicBaseUrl: string`.
- Consumes: existing `DeliveryConfigService` (already a provider).

- [ ] **Step 1: Write the port interface**

Create `services/delivery-service/src/application/ports/storage.port.ts`:

```ts
/** Input for a single blob write. `contentType` is used by cloud adapters to set
 *  the response Content-Type; the local-disk adapter only needs `ext`. */
export interface StoragePutInput {
  body: Buffer;
  contentType: string;
  ext: string;
}

export interface StoragePutResult {
  /** Publicly renderable URL (usable directly in <img src>). */
  url: string;
  /** Storage key, e.g. 'pod/<uuid>.jpg'. */
  key: string;
}

/**
 * Port for persisting uploaded blobs (PoD photos/signatures). The dev adapter
 * writes to local disk; a cloud adapter (Cloudflare R2 via @aws-sdk/client-s3)
 * swaps in behind the same interface. The application never knows which.
 */
export interface StoragePort {
  put(input: StoragePutInput): Promise<StoragePutResult>;
}
```

- [ ] **Step 2: Add the DI token**

Modify `services/delivery-service/src/application/tokens.ts` to:

```ts
export const DELIVERY_TOKENS = {
  DeliveryRepository: Symbol('DeliveryRepository'),
  OrderCoordination: Symbol('OrderCoordination'),
  Storage: Symbol('Storage'),
} as const;
```

- [ ] **Step 3: Add config env vars**

Modify `services/delivery-service/src/config/env.validation.ts` — add these two keys inside the `Joi.object({ ... })` (next to the other config keys, before `CORS_ALLOWED_ORIGINS`):

```ts
  // Root dir the local-disk storage adapter writes uploads under (dev). Ignored
  // once a cloud storage adapter is wired.
  STORAGE_LOCAL_DIR: Joi.string().default('./var/uploads'),
  // Public base URL uploaded files are reachable at; returned URLs are
  // `${STORAGE_PUBLIC_BASE_URL}/uploads/<key>`. Dev default = this service direct.
  // Prod (behind the gateway) or R2 sets this to the real public origin.
  STORAGE_PUBLIC_BASE_URL: Joi.string().uri().default('http://localhost:3006'),
```

- [ ] **Step 4: Add config getters**

Modify `services/delivery-service/src/config/delivery-config.service.ts` — add these getters to the class:

```ts
  get storageLocalDir(): string {
    return this.config.get<string>('STORAGE_LOCAL_DIR', './var/uploads');
  }
  get storagePublicBaseUrl(): string {
    return this.config
      .get<string>('STORAGE_PUBLIC_BASE_URL', 'http://localhost:3006')
      .replace(/\/+$/, '');
  }
```

- [ ] **Step 5: Write the failing adapter test**

Create `services/delivery-service/test/unit/local-disk-storage.adapter.spec.ts`:

```ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalDiskStorageAdapter } from '../../src/infrastructure/storage/local-disk-storage.adapter';

function makeConfig(dir: string) {
  return {
    storageLocalDir: dir,
    storagePublicBaseUrl: 'http://localhost:3006',
  } as unknown as import('../../src/config/delivery-config.service').DeliveryConfigService;
}

describe('LocalDiskStorageAdapter', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hm-storage-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes the file under pod/ and returns a matching url + key', async () => {
    const adapter = new LocalDiskStorageAdapter(makeConfig(dir));
    const body = Buffer.from('fake-png-bytes');

    const { url, key } = await adapter.put({ body, contentType: 'image/png', ext: 'png' });

    expect(key).toMatch(/^pod\/[0-9a-f-]{36}\.png$/);
    expect(url).toBe(`http://localhost:3006/uploads/${key}`);
    expect(readFileSync(join(dir, key))).toEqual(body);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd services/delivery-service && npx jest test/unit/local-disk-storage.adapter.spec.ts`
Expected: FAIL — cannot find module `local-disk-storage.adapter`.

- [ ] **Step 7: Implement the adapter**

Create `services/delivery-service/src/infrastructure/storage/local-disk-storage.adapter.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { Injectable } from '@nestjs/common';

import { DeliveryConfigService } from '../../config/delivery-config.service';
import { StoragePort, StoragePutInput, StoragePutResult } from '../../application/ports/storage.port';

/**
 * Development storage: writes blobs to the local filesystem and returns a URL
 * served statically by the app (see main.ts useStaticAssets). Swap the provider
 * binding for a cloud adapter (R2) in production.
 */
@Injectable()
export class LocalDiskStorageAdapter implements StoragePort {
  constructor(private readonly config: DeliveryConfigService) {}

  async put({ body, ext }: StoragePutInput): Promise<StoragePutResult> {
    const key = `pod/${randomUUID()}.${ext}`;
    const filePath = join(this.config.storageLocalDir, key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, body);
    return { url: `${this.config.storagePublicBaseUrl}/uploads/${key}`, key };
  }
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd services/delivery-service && npx jest test/unit/local-disk-storage.adapter.spec.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add services/delivery-service/src/application/ports/storage.port.ts \
        services/delivery-service/src/application/tokens.ts \
        services/delivery-service/src/infrastructure/storage/local-disk-storage.adapter.ts \
        services/delivery-service/src/config/env.validation.ts \
        services/delivery-service/src/config/delivery-config.service.ts \
        services/delivery-service/test/unit/local-disk-storage.adapter.spec.ts
git commit -m "feat(delivery): storage port + local-disk adapter for uploads"
```

---

### Task 2: Upload endpoint + static serving

**Files:**
- Create: `services/delivery-service/src/modules/upload.controller.ts`
- Modify: `services/delivery-service/src/modules/delivery.module.ts`
- Modify: `services/delivery-service/src/main.ts`
- Modify: `services/delivery-service/package.json` (add `@types/multer` devDep)
- Test: `services/delivery-service/test/unit/upload.controller.spec.ts`

**Interfaces:**
- Consumes: `StoragePort` via `DELIVERY_TOKENS.Storage`; `DeliveryConfigService.storageLocalDir`.
- Produces: `POST /driver/deliveries/uploads` returning `{ url: string }`.

- [ ] **Step 1: Add the multer types devDependency**

Modify `services/delivery-service/package.json` — add to `devDependencies` (keep alphabetical-ish, near `@types/jest`):

```json
    "@types/multer": "^1.4.12",
```

Then install: `npm install` (from repo root). `Express.Multer.File` needs this type; multer itself already ships with `@nestjs/platform-express`.

- [ ] **Step 2: Write the failing controller test**

Create `services/delivery-service/test/unit/upload.controller.spec.ts`:

```ts
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';

import { UploadController } from '../../src/modules/upload.controller';
import { StoragePort } from '../../src/application/ports/storage.port';

function fakeFile(over: Partial<Express.Multer.File>): Express.Multer.File {
  return {
    mimetype: 'image/png',
    size: 1024,
    buffer: Buffer.from('bytes'),
    ...over,
  } as Express.Multer.File;
}

describe('UploadController', () => {
  const storage: StoragePort = {
    put: jest.fn().mockResolvedValue({ url: 'http://x/uploads/pod/abc.png', key: 'pod/abc.png' }),
  };
  const controller = new UploadController(storage);

  afterEach(() => jest.clearAllMocks());

  it('rejects a missing file with 400', async () => {
    await expect(controller.upload(undefined)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a non-image mime with 400', async () => {
    await expect(controller.upload(fakeFile({ mimetype: 'application/pdf' }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a file over 5MB with 413', async () => {
    await expect(
      controller.upload(fakeFile({ size: 5 * 1024 * 1024 + 1 })),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('accepts a png and returns the storage url', async () => {
    const result = await controller.upload(fakeFile({ mimetype: 'image/png' }));
    expect(result).toEqual({ url: 'http://x/uploads/pod/abc.png' });
    expect(storage.put).toHaveBeenCalledWith({
      body: expect.any(Buffer),
      contentType: 'image/png',
      ext: 'png',
    });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd services/delivery-service && npx jest test/unit/upload.controller.spec.ts`
Expected: FAIL — cannot find module `upload.controller`.

- [ ] **Step 4: Implement the controller**

Create `services/delivery-service/src/modules/upload.controller.ts`:

```ts
import {
  BadRequestException,
  Controller,
  Inject,
  PayloadTooLargeException,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Role, Roles } from '@hydromart/platform';

import { DELIVERY_TOKENS } from '../application/tokens';
import { StoragePort } from '../application/ports/storage.port';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Driver uploads a PoD photo/signature and gets back a URL to submit to /complete. */
@ApiTags('Driver Deliveries')
@ApiBearerAuth()
@Roles(Role.DRIVER)
@Controller({ path: 'driver/deliveries', version: '1' })
export class UploadController {
  constructor(@Inject(DELIVERY_TOKENS.Storage) private readonly storage: StoragePort) {}

  @Post('uploads')
  @ApiOperation({ summary: 'Upload a PoD photo or signature; returns its URL' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async upload(@UploadedFile() file?: Express.Multer.File): Promise<{ url: string }> {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    const ext = ALLOWED[file.mimetype];
    if (!ext) {
      throw new BadRequestException('unsupported file type (allowed: jpeg, png, webp)');
    }
    if (file.size > MAX_BYTES) {
      throw new PayloadTooLargeException('file exceeds 5MB');
    }
    const { url } = await this.storage.put({ body: file.buffer, contentType: file.mimetype, ext });
    return { url };
  }
}
```

- [ ] **Step 5: Wire the provider + controller in the module**

Modify `services/delivery-service/src/modules/delivery.module.ts`:

1. Add imports near the other infrastructure imports:
```ts
import { LocalDiskStorageAdapter } from '../infrastructure/storage/local-disk-storage.adapter';
import { UploadController } from './upload.controller';
```

2. Add to the `providers` array:
```ts
  LocalDiskStorageAdapter,
  { provide: DELIVERY_TOKENS.Storage, useClass: LocalDiskStorageAdapter },
```

3. Add `UploadController` to the `controllers` array:
```ts
  controllers: [DeliveryController, DriverDeliveryController, ReportController, UploadController],
```

- [ ] **Step 6: Run the controller test to verify it passes**

Run: `cd services/delivery-service && npx jest test/unit/upload.controller.spec.ts`
Expected: PASS (all 4 cases).

- [ ] **Step 7: Serve uploaded files statically**

Modify `services/delivery-service/src/main.ts`:

1. Add imports:
```ts
import { isAbsolute, join } from 'node:path';
import { NestExpressApplication } from '@nestjs/platform-express';
```

2. Change the app creation to the Express-typed factory:
```ts
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
```

3. After `const config = app.get(DeliveryConfigService);` and before `app.setGlobalPrefix('api')`, mount the uploads dir (resolve relative dirs against cwd):
```ts
  const uploadsRoot = isAbsolute(config.storageLocalDir)
    ? config.storageLocalDir
    : join(process.cwd(), config.storageLocalDir);
  app.useStaticAssets(uploadsRoot, { prefix: '/uploads' });
```

- [ ] **Step 8: Typecheck the service**

Run: `cd services/delivery-service && npm run typecheck`
Expected: no errors (confirms `@types/multer`, `NestExpressApplication`, and all wiring compile).

- [ ] **Step 9: Run the full service test suite**

Run: `cd services/delivery-service && npm test`
Expected: PASS — new adapter + controller specs green, existing delivery specs unaffected.

- [ ] **Step 10: Manual verification of the upload + static serve**

Start the service (needs its env / DB per DEPLOY, or run against the local stack). Then:

```bash
# get a DRIVER bearer token (see hydromart-deploy-progress: register -> OTP from
# logs -> verify), then:
curl -s -X POST http://localhost:3006/api/v1/driver/deliveries/uploads \
  -H "Authorization: Bearer $DRIVER_TOKEN" \
  -F "file=@some-photo.png"
# -> {"url":"http://localhost:3006/uploads/pod/<uuid>.png"}

curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3006/uploads/pod/<uuid>.png
# -> 200
```

Expected: JSON `{ url }` returned, and the returned URL resolves 200. Confirm a non-image (`-F "file=@x.pdf"`) returns 400.

- [ ] **Step 11: Commit**

```bash
git add services/delivery-service/src/modules/upload.controller.ts \
        services/delivery-service/src/modules/delivery.module.ts \
        services/delivery-service/src/main.ts \
        services/delivery-service/package.json \
        services/delivery-service/test/unit/upload.controller.spec.ts \
        package-lock.json
git commit -m "feat(delivery): PoD upload endpoint + static serving of local uploads"
```

---

## Notes / Follow-ups (not this plan)

- **Cloud adapter (R2):** add `S3StorageAdapter` using `@aws-sdk/client-s3` (endpoint + creds via env), swap the `{ provide: DELIVERY_TOKENS.Storage, useClass: ... }` line. Same `StoragePort`. Also covers BiznetGio NEO Object Storage / MinIO by endpoint alone.
- **Product images:** product-service gets its own admin-guarded upload endpoint reusing this same port pattern.
- **Driver frontend capture UI** (camera + signature canvas → these two upload calls) — verify/build separately in `apps/web`.
