import { Injectable } from '@nestjs/common';

import { StoragePort, StoragePutResult } from '../../application/ports/storage.port';

/** No-op storage (dev/test / STORAGE_DRIVER unset): returns an empty url — callers skip
 *  persisting the photoUrl. The face match still runs on the in-memory frame. */
@Injectable()
export class DisabledStorageAdapter implements StoragePort {
  async put(): Promise<StoragePutResult> {
    return { url: '', key: '' };
  }
}
