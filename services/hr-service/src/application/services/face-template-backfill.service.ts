import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';

import { HrConfigService } from '../../config/hr-config.service';
import {
  FACE_EMBEDDING_REPOSITORY,
  type FaceEmbeddingRepository,
} from '../ports/face-embedding.repository';
import {
  LOCAL_FACE_ENGINE,
  LocalBadImageError,
  LocalEngineUnavailableError,
  type LocalFaceEngine,
  LocalNoFaceError,
} from '../ports/local-face-engine.port';
import { STORAGE_PORT, type StoragePort } from '../ports/storage.port';

/**
 * Only the enrolment frames this service stored itself (`storeFrame` → S3 adapter: a random
 * uuid under hr/faces/). Not a prefix check: `hr/faces/../…` or a key an admin typed would
 * pass a prefix, and a template must be built from the face the employee enrolled with.
 */
export const OWN_FACE_PHOTO = /^hr\/faces\/[0-9a-f-]{36}\.jpg$/i;

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
 * failure logged. Off unless `FACE_FALLBACK` is shadow (or, later, on).
 *
 * A row that can never succeed (no face in the photo, a bad image, a photo that is gone) is set
 * aside for the life of the process instead of coming back first on every run — oldest first
 * and 50 at a time, fifty of those would otherwise starve every newer enrolment. An engine that
 * is down ends the run: the rest of the batch would only fail the same way.
 */
@Injectable()
export class FaceTemplateBackfill implements OnApplicationBootstrap, OnModuleDestroy {
  static readonly EVERY_MS = 30 * 60_000;
  static readonly BATCH = 50;
  static readonly PHOTO_TIMEOUT_MS = 10_000;
  private readonly logger = new Logger(FaceTemplateBackfill.name);
  private readonly setAside = new Set<string>();
  private running = false;
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(FACE_EMBEDDING_REPOSITORY) private readonly faces: FaceEmbeddingRepository,
    private readonly config: HrConfigService,
    @Inject(LOCAL_FACE_ENGINE) private readonly local: LocalFaceEngine,
    @Optional() @Inject(STORAGE_PORT) private readonly storage?: StoragePort,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.faceFallback === 'off' || !this.config.faceServiceUrl || !this.storage) return;
    void this.run();
    this.timer = setInterval(() => void this.run(), FaceTemplateBackfill.EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Templates built this run. One run at a time; a run never throws. */
  async run(): Promise<number> {
    if (this.running || !this.storage) return 0;
    this.running = true;
    let built = 0;
    try {
      const rows = await this.faces.listActiveWithoutLocalTemplate(FaceTemplateBackfill.BATCH, [
        ...this.setAside,
      ]);
      for (const row of rows) {
        if (!row.sourcePhotoUrl || !OWN_FACE_PHOTO.test(row.sourcePhotoUrl)) {
          this.setAside.add(row.id);
          continue;
        }
        try {
          const { body } = await within(
            this.storage.getObject(row.sourcePhotoUrl),
            FaceTemplateBackfill.PHOTO_TIMEOUT_MS,
            'reading the enrolment photo',
          );
          const { vector } = await this.local.embed(body);
          if (await this.faces.setVectorIfActive(row.id, vector)) built += 1;
        } catch (err) {
          const gone = (err as { name?: string } | null)?.name === 'NoSuchKey';
          if (err instanceof LocalNoFaceError || err instanceof LocalBadImageError || gone) {
            this.setAside.add(row.id);
          }
          this.logger.warn(`face template for employee ${row.employeeId} not built: ${String(err)}`);
          if (err instanceof LocalEngineUnavailableError) break;
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
