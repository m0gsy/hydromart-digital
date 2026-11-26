import { VisitPhotoStoragePort } from '../../application/ports/visit-photo-storage.port';
import { DepotConfigService } from '../../config/depot-config.service';
import { VisitPhotoNotConfiguredError } from '../../domain/errors';
import { VisitLocalStorageAdapter } from './visit-local-storage.adapter';
import { VisitS3StorageAdapter } from './visit-s3-storage.adapter';

/** Storage that is not there: every call says so, with the 503 the upload route shows. */
export class VisitDisabledStorageAdapter implements VisitPhotoStoragePort {
  async put(): Promise<{ key: string }> {
    throw new VisitPhotoNotConfiguredError();
  }
  async signedUrl(): Promise<string> {
    throw new VisitPhotoNotConfiguredError();
  }
  async exists(): Promise<boolean> {
    throw new VisitPhotoNotConfiguredError();
  }
  async remove(): Promise<void> {
    throw new VisitPhotoNotConfiguredError();
  }
}

/**
 * Which store finding photos use:
 * - s3 driver with the visit bucket and key set: the private bucket;
 * - s3 driver without them: disabled (uploads answer 503, the rest of visits works);
 * - the local driver: the disk in development, disabled in production (a container's disk vanishes on
 *   redeploy, and a photo that may show a face must not live there). Not a boot failure, because the
 *   integration stack runs production mode with the local driver and never uploads a photo.
 */
export function visitPhotoStorageFor(config: DepotConfigService): VisitPhotoStoragePort {
  if (config.storageDriver === 's3') {
    const s3 = config.visitS3;
    return s3 ? new VisitS3StorageAdapter(s3) : new VisitDisabledStorageAdapter();
  }
  return config.isProduction ? new VisitDisabledStorageAdapter() : new VisitLocalStorageAdapter(config);
}
