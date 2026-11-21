import { Logger } from '@nestjs/common';

import type {
  FaceEmbeddingResult,
  FaceIdentity,
  FaceVerifier,
  FaceVerifyResult,
} from '../../application/ports/face-verifier.port';
import {
  LOCAL_TEMPLATE_DIM,
  LocalBadImageError,
  type LocalFaceEngine,
  LocalNoFaceError,
} from '../../application/ports/local-face-engine.port';
import { cosineSimilarity } from '../../domain/face-math';
import type { FaceShadowSample } from '../../application/ports/face-maintenance.repository';

/**
 * Face plan §4.5, shadow (`FACE_FALLBACK=shadow`, NEO driver only): NEO decides, exactly as
 * without this. After NEO answers, the local engine is asked the same question in the
 * background — never awaited, every error caught, one at a time — and the two answers are
 * logged side by side. That log is what sets the local threshold before the fallback is ever
 * switched on: the plan's default (0.70) would have refused two of three same-person pairs in
 * the spike.
 *
 * The enrolled vectors handed to `verify` ARE the local templates: NEO rows carry none of their
 * own, and the template backfill writes the 128-d SFace one into the same row.
 */
export class ShadowFaceVerifier implements FaceVerifier {
  private busy = false;
  readonly remove?: (identity: FaceIdentity) => Promise<void>;
  readonly listEnrolled?: () => Promise<string[]>;

  constructor(
    private readonly neo: FaceVerifier,
    private readonly local: LocalFaceEngine,
    private readonly logger: Pick<Logger, 'log' | 'warn'> = new Logger('FaceShadow'),
    /**
     * Owner decision 2026-11-21: each comparison is kept (30 days), not only logged — container
     * logs died with every deploy, and the threshold waits for two weeks of them.
     */
    private readonly record?: (sample: FaceShadowSample) => Promise<void>,
  ) {
    if (neo.remove) this.remove = (identity) => neo.remove!(identity);
    if (neo.listEnrolled) this.listEnrolled = () => neo.listEnrolled!();
  }

  enroll(images: Buffer[], identity?: FaceIdentity): Promise<FaceEmbeddingResult> {
    return this.neo.enroll(images, identity);
  }

  async verify(
    image: Buffer,
    enrolled: number[][],
    identity?: FaceIdentity,
  ): Promise<FaceVerifyResult> {
    const result = await this.neo.verify(image, enrolled, identity);
    // One comparison at a time: a burst of check-ins must not become a burst on face-service,
    // and a shadow is a sample, not a census.
    if (!this.busy) {
      this.busy = true;
      void this.compare(image, enrolled, identity, result).finally(() => {
        this.busy = false;
      });
    }
    return result;
  }

  private async compare(
    image: Buffer,
    enrolled: number[][],
    identity: FaceIdentity | undefined,
    neo: FaceVerifyResult,
  ): Promise<void> {
    const who = identity?.userId ?? 'unknown';
    const said = `neo=${neo.score.toFixed(3)} matched=${neo.matched}`;
    try {
      const templates = enrolled.filter((v) => v.length === LOCAL_TEMPLATE_DIM);
      if (templates.length === 0) {
        this.logger.log(`face shadow user=${who} ${said} local=no-template`);
        await this.keep(identity, neo, null, 'no-template');
        return;
      }
      const { vector } = await this.local.embed(image);
      const score = Math.max(...templates.map((t) => cosineSimilarity(vector, t)));
      this.logger.log(`face shadow user=${who} ${said} local=${score.toFixed(3)}`);
      await this.keep(identity, neo, score, 'scored');
    } catch (err) {
      const outcome =
        err instanceof LocalNoFaceError ? 'no-face' : err instanceof LocalBadImageError ? 'bad-image' : 'failed';
      const why =
        outcome === 'no-face'
          ? 'no-face'
          : outcome === 'bad-image'
            ? `bad-image (${(err as Error).message})`
            : `failed (${String(err)})`;
      this.logger.warn(`face shadow user=${who} ${said} local=${why}`);
      await this.keep(identity, neo, null, outcome);
    }
  }

  /** The comparison, kept. Never throws: a shadow that cannot be written changes nothing. */
  private async keep(
    identity: FaceIdentity | undefined,
    neo: FaceVerifyResult,
    localScore: number | null,
    outcome: FaceShadowSample['outcome'],
  ): Promise<void> {
    if (!this.record || !identity?.userId) return;
    try {
      await this.record({
        employeeId: identity.userId,
        neoScore: neo.score,
        neoMatched: neo.matched,
        localScore,
        outcome,
      });
    } catch (err) {
      this.logger.warn(`face shadow sample not kept for ${identity.userId}: ${String(err)}`);
    }
  }
}
