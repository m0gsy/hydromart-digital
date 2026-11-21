import { Inject, Injectable, Logger } from '@nestjs/common';
import { alertServerError } from '@hydromart/platform';

import {
  FACE_EMBEDDING_REPOSITORY,
  FaceEmbeddingRepository,
} from '../ports/face-embedding.repository';
import {
  FACE_MAINTENANCE_REPOSITORY,
  FaceMaintenanceRepository,
} from '../ports/face-maintenance.repository';
import { FACE_VERIFIER, FaceVerifier } from '../ports/face-verifier.port';

/** How long shadow samples are kept: enough for the two weeks the local threshold is set from. */
const SHADOW_KEEP_DAYS = 30;

export interface FaceMaintenanceResult {
  /** HR enrolments the engine no longer holds, retired so the app asks for a new one. */
  retired: number;
  /** Faces the engine held for nobody HR has enrolled (leavers, withdrawals), deleted there. */
  removed: number;
  purgedSamples: number;
  ok: boolean;
}

/**
 * The daily face upkeep (owner decision 2026-11-21).
 *
 * 1. HR says enrolled, the engine's gallery does not hold the face: every punch of that person
 *    met "UserID Not Found" (2026-11-21, 32 refused check-ins). Retired here, before the morning,
 *    so the app asks them to enrol again instead of holding each punch for HR.
 * 2. The engine holds a face HR has no enrolment for: a leaver whose rows the retention purge
 *    deleted, or a withdrawal whose remote delete failed. Deleted there — biometrics kept by a
 *    third party after the reason for them ended (two RESIGNED employees on 2026-11-21).
 * 3. Shadow samples past their keep date are deleted.
 *
 * A list that disagrees with HR wholesale is the engine failing to list (or the wrong gallery),
 * not half the staff losing their faces overnight: then nothing is retired or deleted, and ops
 * are told. Runs at 04:00, after the retention purge and before anyone enrols.
 */
@Injectable()
export class FaceMaintenanceService {
  private readonly logger = new Logger(FaceMaintenanceService.name);

  constructor(
    @Inject(FACE_VERIFIER) private readonly verifier: FaceVerifier,
    @Inject(FACE_EMBEDDING_REPOSITORY) private readonly faces: FaceEmbeddingRepository,
    @Inject(FACE_MAINTENANCE_REPOSITORY) private readonly upkeep: FaceMaintenanceRepository,
  ) {}

  async run(now: Date = new Date()): Promise<FaceMaintenanceResult> {
    const purgedSamples = await this.upkeep.purgeShadowSamples(
      new Date(now.getTime() - SHADOW_KEEP_DAYS * 24 * 60 * 60 * 1000),
    );
    const listEnrolled = this.verifier.listEnrolled?.bind(this.verifier);
    const remove = this.verifier.remove?.bind(this.verifier);
    // An engine with no gallery of its own (the local drivers) has nothing to reconcile.
    if (!listEnrolled || !remove) return { retired: 0, removed: 0, purgedSamples, ok: true };

    let held: Set<string>;
    try {
      held = new Set((await listEnrolled()).map((id) => id.toLowerCase()));
    } catch (err) {
      this.logger.warn(`Face upkeep could not list the engine's gallery: ${String(err)}`);
      return { retired: 0, removed: 0, purgedSamples, ok: false };
    }
    const enrolled = new Set((await this.upkeep.activeEnrolledEmployeeIds()).map((id) => id.toLowerCase()));
    const missing = [...enrolled].filter((id) => !held.has(id));
    const leftovers = [...held].filter((id) => !enrolled.has(id));

    if (
      enrolled.size === 0 ||
      missing.length > Math.max(5, Math.floor(enrolled.size / 2)) ||
      leftovers.length > Math.max(5, Math.floor(held.size / 2))
    ) {
      this.notify(
        `Face upkeep stopped: the engine holds ${held.size} faces, HR has ${enrolled.size} enrolled ` +
          `(${missing.length} missing, ${leftovers.length} extra). Nothing retired or deleted — check ` +
          'NEO_FR_GALLERY_ID and the NEO account before the morning check-ins.',
        503,
      );
      return { retired: 0, removed: 0, purgedSamples, ok: false };
    }

    for (const employeeId of missing) await this.faces.deactivateForEmployee(employeeId);
    let removed = 0;
    for (const userId of leftovers) {
      try {
        await remove({ userId, userName: '' });
        removed += 1;
      } catch (err) {
        this.logger.warn(`Face upkeep could not delete ${userId} from the engine: ${String(err)}`);
      }
    }
    if (missing.length > 0) {
      this.notify(
        `NEO lost the face of ${missing.length} enrolled employee(s) (${missing.join(', ')}). ` +
          'Their enrolment was retired; the app asks them to enrol again.',
        404,
      );
    }
    this.logger.log(
      `Face upkeep: ${missing.length} retired, ${removed}/${leftovers.length} leftover face(s) deleted, ` +
        `${purgedSamples} shadow sample(s) purged`,
    );
    return { retired: missing.length, removed, purgedSamples, ok: removed === leftovers.length };
  }

  private notify(message: string, status: number): void {
    this.logger.warn(message);
    alertServerError({
      method: 'POST',
      path: '/api/v1/employees/internal/faces/maintain (face upkeep)',
      status,
      exception: new Error(message),
    });
  }
}
