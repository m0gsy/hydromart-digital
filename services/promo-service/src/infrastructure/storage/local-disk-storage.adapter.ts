import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { Injectable } from '@nestjs/common';

import { PromoConfigService } from '../../config/promo-config.service';
import { StoragePort, StoragePutInput, StoragePutResult } from '../../application/ports/storage.port';

/** Development storage: writes the promo banner to the local filesystem and returns a
 *  URL served statically by the app. Swap the provider binding for the S3 adapter in
 *  production — see customer-service's identical adapter for the precedent. */
@Injectable()
export class LocalDiskStorageAdapter implements StoragePort {
  constructor(private readonly config: PromoConfigService) {}

  async put({ body, ext }: StoragePutInput): Promise<StoragePutResult> {
    const key = `promotions/${randomUUID()}.${ext}`;
    const filePath = join(this.config.storageLocalDir, key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, body);
    return { url: `${this.config.storagePublicBaseUrl}/uploads/${key}`, key };
  }
}
