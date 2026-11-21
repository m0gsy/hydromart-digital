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
/** An enrolment younger than this may still be between the engine and HR's row: left alone. */
const SETTLE_MS = 30 * 60_000;
/**
 * More than this in one night is not people losing faces or leaving: it is the engine listing
 * short (a page, an outage, the wrong gallery). Nothing is retired or deleted then.
 */
const MAX_RETIRE_PER_RUN = 10;
const MAX_REMOVE_PER_RUN = 20;

export interface FaceMaintenanceResult {
  /** HR enrolments the engine no longer holds, retired so the app asks for a new one. */
  retired: number;
  /** Faces the engine held for nobody HR has enrolled (leavers, withdrawals), deleted there. */
  removed: number;
  purgedSamples: number;
  ok: boolean;
  /** Why the round did nothing, when it stopped itself. */
  reason?: string;
}

/**
 * The daily face upkeep (owner decision 2026-11-21).
 *
 * 1. HR says enrolled, the engine's gallery does not hold the face: every punch of that person
 *    met "UserID Not Found" (2026-11-21, 32 refused check-ins). Retired here, before the morning,
 *    so the app asks them to enrol again instead of holding each punch for HR.
 * 2. The engine holds a face HR has no enrolment for: a leaver whose rows the 03:30 retention purge
 *    deleted, or a withdrawal whose remote delete failed. Deleted there — biometrics kept by a
 *    third party after the reason for them ended (two RESIGNED employees on 2026-11-21).
 * 3. Shadow samples past their keep date are deleted.
 *
 * A list that disagrees with HR wholesale is the engine listing short (a page, an outage, the
 * wrong gallery), not people losing faces overnight: then nothing is retired or deleted and the
 * round reports itself failed (the scheduler tells ops, once). An enrolment made in the last half
 * hour is left alone either way: it may be between the engine and HR's row. Runs at 04:00, after
 * the retention purge and before anyone enrols.
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
      const reason = `the engine's gallery could not be listed: ${String(err)}`;
      this.logger.warn(`Face upkeep: ${reason}`);
      return { retired: 0, removed: 0, purgedSamples, ok: false, reason };
    }
    // HR is read AFTER the gallery, so an enrolment finishing in between counts as recent below.
    const enrolled = new Map(
      (await this.upkeep.activeEnrolments()).map((e) => [e.employeeId.toLowerCase(), e.createdAt]),
    );
    const since = new Date(now.getTime() - SETTLE_MS);
    const settling = new Set((await this.upkeep.consentedSince(since)).map((id) => id.toLowerCase()));
    const recent = (id: string) =>
      settling.has(id) || (enrolled.get(id)?.getTime() ?? 0) >= since.getTime();
    const missing = [...enrolled.keys()].filter((id) => !held.has(id) && !recent(id));
    const leftovers = [...held].filter((id) => !enrolled.has(id) && !recent(id));

    if (
      (held.size === 0 && enrolled.size > 0) ||
      missing.length > MAX_RETIRE_PER_RUN ||
      leftovers.length > MAX_REMOVE_PER_RUN
    ) {
      const reason =
        `the engine holds ${held.size} faces, HR has ${enrolled.size} enrolled (${missing.length} missing, ` +
        `${leftovers.length} extra): nothing retired or deleted - check NEO_FR_GALLERY_ID and the NEO account`;
      this.logger.warn(`Face upkeep stopped: ${reason}`);
      return { retired: 0, removed: 0, purgedSamples, ok: false, reason };
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
      // The round worked, so the scheduler stays quiet: this is the one message about it.
      const message =
        `NEO lost the face of ${missing.length} enrolled employee(s) (${missing.join(', ')}). ` +
        'Their enrolment was retired; the app asks them to enrol again.';
      this.logger.warn(message);
      alertServerError({
        method: 'POST',
        path: '/api/v1/employees/internal/faces/maintain (face upkeep)',
        status: 404,
        exception: new Error(message),
      });
    }
    this.logger.log(
      `Face upkeep: ${missing.length} retired, ${removed}/${leftovers.length} leftover face(s) deleted, ` +
        `${purgedSamples} shadow sample(s) purged`,
    );
    // Failed only when it had deletions to make, made none and did nothing else: a partial round
    // stays ok, as the scheduler's rule asks.
    const ok = leftovers.length === 0 || removed > 0 || missing.length > 0;
    return { retired: missing.length, removed, purgedSamples, ok };
  }
}
