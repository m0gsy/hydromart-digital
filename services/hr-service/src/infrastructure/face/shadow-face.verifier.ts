import { Logger } from '@nestjs/common';

import type {
  FaceEmbeddingResult,
  FaceIdentity,
  FaceVerifier,
  FaceVerifyResult,
} from '../../application/ports/face-verifier.port';
import { cosineSimilarity } from '../../domain/face-math';
import { type FaceServiceClient, LOCAL_TEMPLATE_DIM, LocalNoFaceError } from './face-service.client';

/**
 * Face plan §4.5, shadow (`FACE_FALLBACK=shadow`): NEO decides, exactly as without this. After
 * NEO answers, the local engine is asked the same question in the background — never awaited,
 * every error caught, one at a time — and the two answers are logged side by side. That log
 * is what sets the local threshold before the fallback is ever switched on: the plan's default
 * (0.70) would have refused two of three same-person pairs in the spike.
 *
 * The enrolled vectors handed to `verify` ARE the local templates: NEO rows carry none of their
 * own, and the template backfill writes the 128-d SFace one into the same row.
 */
export class ShadowFaceVerifier implements FaceVerifier {
  private busy = false;
  readonly remove?: (identity: FaceIdentity) => Promise<void>;

  constructor(
    private readonly primary: FaceVerifier,
    private readonly local: Pick<FaceServiceClient, 'embed'>,
    private readonly logger: Pick<Logger, 'log' | 'warn'> = new Logger('FaceShadow'),
  ) {
    if (primary.remove) this.remove = (identity) => primary.remove!(identity);
  }

  enroll(images: Buffer[], identity?: FaceIdentity): Promise<FaceEmbeddingResult> {
    return this.primary.enroll(images, identity);
  }

  async verify(
    image: Buffer,
    enrolled: number[][],
    identity?: FaceIdentity,
  ): Promise<FaceVerifyResult> {
    const result = await this.primary.verify(image, enrolled, identity);
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
        return;
      }
      const { vector } = await this.local.embed(image);
      const score = Math.max(...templates.map((t) => cosineSimilarity(vector, t)));
      this.logger.log(`face shadow user=${who} ${said} local=${score.toFixed(3)}`);
    } catch (err) {
      const why = err instanceof LocalNoFaceError ? 'no-face' : `failed (${String(err)})`;
      this.logger.warn(`face shadow user=${who} ${said} local=${why}`);
    }
  }
}
