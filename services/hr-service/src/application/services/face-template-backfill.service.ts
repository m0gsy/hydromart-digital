import { Inject, Injectable, Logger, OnApplicationBootstrap, Optional } from '@nestjs/common';

import { HrConfigService } from '../../config/hr-config.service';
import { FaceServiceClient } from '../../infrastructure/face/face-service.client';
import {
  FACE_EMBEDDING_REPOSITORY,
  type FaceEmbeddingRepository,
} from '../ports/face-embedding.repository';
import { STORAGE_PORT, type StoragePort } from '../ports/storage.port';

export const FACE_SERVICE_CLIENT = Symbol('FACE_SERVICE_CLIENT');

/** Only the enrolment photos this service stored itself. A key from anywhere else is skipped. */
const PHOTO_PREFIX = 'hr/faces/';

function within<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} took over ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Face plan §4 (backfill): a local template for every face NEO already knows.
 *
 * NEO holds the gallery; our rows hold only the enrolment photo. The local engine cannot match
 * against a photo it has never embedded, so this embeds each one once — the source photo of an
 * ACTIVE employee who consented, one at a time — and stores the 128-d template, encrypted, in
 * the same row. At boot and every half hour after (new enrolments), never awaited, every
 * failure logged and skipped. Off unless `FACE_FALLBACK` is shadow (or, later, on).
 */
@Injectable()
export class FaceTemplateBackfill implements OnApplicationBootstrap {
  static readonly EVERY_MS = 30 * 60_000;
  static readonly BATCH = 50;
  static readonly PHOTO_TIMEOUT_MS = 10_000;
  private readonly logger = new Logger(FaceTemplateBackfill.name);
  private running = false;

  constructor(
    @Inject(FACE_EMBEDDING_REPOSITORY) private readonly faces: FaceEmbeddingRepository,
    private readonly config: HrConfigService,
    @Inject(FACE_SERVICE_CLIENT) private readonly local: Pick<FaceServiceClient, 'embed'>,
    @Optional() @Inject(STORAGE_PORT) private readonly storage?: StoragePort,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.faceFallback === 'off' || !this.config.faceServiceUrl || !this.storage) return;
    void this.run();
    setInterval(() => void this.run(), FaceTemplateBackfill.EVERY_MS).unref();
  }

  /** Templates built this run. One run at a time; a run never throws. */
  async run(): Promise<number> {
    if (this.running || !this.storage) return 0;
    this.running = true;
    let built = 0;
    try {
      for (const row of await this.faces.listActiveWithoutLocalTemplate(FaceTemplateBackfill.BATCH)) {
        if (!row.sourcePhotoUrl?.startsWith(PHOTO_PREFIX)) continue;
        try {
          const { body } = await within(
            this.storage.getObject(row.sourcePhotoUrl),
            FaceTemplateBackfill.PHOTO_TIMEOUT_MS,
            'reading the enrolment photo',
          );
          const { vector } = await this.local.embed(body);
          if (await this.faces.setVectorIfActive(row.id, vector)) built += 1;
        } catch (err) {
          this.logger.warn(`face template for employee ${row.employeeId} not built: ${String(err)}`);
        }
      }
    } catch (err) {
      this.logger.warn(`face template backfill could not list the faces: ${String(err)}`);
    } finally {
      this.running = false;
    }
    if (built > 0) this.logger.log(`face templates built: ${built}`);
    return built;
  }
}
