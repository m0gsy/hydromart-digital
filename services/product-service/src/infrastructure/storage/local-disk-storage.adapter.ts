import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { Injectable } from '@nestjs/common';

import { ProductConfigService } from '../../config/product-config.service';
import { StoragePort, StoragePutInput, StoragePutResult } from '../../application/ports/storage.port';

/**
 * Development storage: writes product images to the local filesystem and returns a
 * URL served statically by the app (see main.ts useStaticAssets). Swap the provider
 * binding for a cloud adapter (R2) in production.
 */
// ponytail: local-disk adapter never deletes files (no GC/quota) — dev only;
// the prod upgrade path is a cloud adapter (R2) with a bucket lifecycle policy.
@Injectable()
export class LocalDiskStorageAdapter implements StoragePort {
  constructor(private readonly config: ProductConfigService) {}

  async put({ body, ext }: StoragePutInput): Promise<StoragePutResult> {
    const key = `products/${randomUUID()}.${ext}`;
    const filePath = join(this.config.storageLocalDir, key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, body);
    return { url: `${this.config.storagePublicBaseUrl}/uploads/${key}`, key };
  }
}
