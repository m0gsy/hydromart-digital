import { randomUUID } from 'node:crypto';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { Injectable } from '@nestjs/common';

import { DepotConfigService } from '../../config/depot-config.service';
import {
  VisitPhotoPutInput,
  VisitPhotoStoragePort,
} from '../../application/ports/visit-photo-storage.port';

/** Development storage for finding photos: the local disk, served statically by the dev server. */
@Injectable()
export class VisitLocalStorageAdapter implements VisitPhotoStoragePort {
  constructor(private readonly config: DepotConfigService) {}

  async put({ visitId, body, ext }: VisitPhotoPutInput): Promise<{ key: string }> {
    const key = `visits/${visitId}/${randomUUID()}.${ext}`;
    const filePath = join(this.config.storageLocalDir, key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, body);
    return { key };
  }

  /** Dev has no presigner, so the "signed" link is the plain one the dev server already serves. */
  async signedUrl(key: string, _ttlSeconds: number): Promise<string> {
    return `${this.config.storagePublicBaseUrl}/uploads/${key}`;
  }

  async exists(key: string): Promise<boolean> {
    return stat(join(this.config.storageLocalDir, key)).then(
      () => true,
      () => false,
    );
  }

  async remove(key: string): Promise<void> {
    await rm(join(this.config.storageLocalDir, key), { force: true });
  }
}
