import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { StoragePort, StoragePutResult } from '../../application/ports/storage.port';

/** No-op storage (dev/test / STORAGE_DRIVER unset): returns an empty url — callers skip
 *  persisting the photoUrl. The face match still runs on the in-memory frame. */
@Injectable()
export class DisabledStorageAdapter implements StoragePort {
  async put(): Promise<StoragePutResult> {
    return { url: '', key: '' };
  }

  /** Nothing was ever stored, so there is nothing to read back — say so, never answer empty. */
  async getObject(): Promise<{ body: Buffer; contentType: string | null }> {
    throw new ServiceUnavailableException('Penyimpanan dokumen belum dikonfigurasi');
  }

  async remove(): Promise<void> {
    // Nothing was ever stored, so nothing can be removed.
  }
}
