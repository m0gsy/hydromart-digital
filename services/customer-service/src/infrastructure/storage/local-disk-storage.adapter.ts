import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { Injectable } from '@nestjs/common';

import { CustomerConfigService } from '../../config/customer-config.service';
import {
  StoragePort,
  StoragePutInput,
  StoragePutResult,
} from '../../application/ports/storage.port';

/**
 * Development storage: writes the agen photo to the local filesystem and returns a URL
 * served statically by the app (see main.ts useStaticAssets). Swap the provider binding
 * for the S3 adapter in production.
 */
// ponytail: local-disk adapter never deletes files (no GC/quota) — dev only;
// the prod upgrade path is the S3 adapter with a bucket lifecycle policy.
@Injectable()
export class LocalDiskStorageAdapter implements StoragePort {
  constructor(private readonly config: CustomerConfigService) {}

  async put({ body, ext }: StoragePutInput): Promise<StoragePutResult> {
    const key = `resellers/${randomUUID()}.${ext}`;
    const filePath = join(this.config.storageLocalDir, key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, body);
    return { url: `${this.config.storagePublicBaseUrl}/uploads/${key}`, key };
  }

  /** Dev has no presigner; the plain link is what the dev server serves (never in production). */
  async signedUrl(key: string, _ttlSeconds: number): Promise<string> {
    return `${this.config.storagePublicBaseUrl}/uploads/${key}`;
  }

  /** `force` makes a missing file a success, which is what idempotent removal means here. */
  async remove(key: string): Promise<void> {
    await rm(join(this.config.storageLocalDir, key), { force: true });
  }
}
