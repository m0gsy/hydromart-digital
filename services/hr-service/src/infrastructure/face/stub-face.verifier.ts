import { Injectable } from '@nestjs/common';

import { HrConfigService } from '../../config/hr-config.service';
import {
  FaceEmbeddingResult,
  FaceVerifier,
  FaceVerifyResult,
} from '../../application/ports/face-verifier.port';
import { bestMatch, l2normalize, meanNormalize } from '../../domain/face-math';

const DIM = 512;

/**
 * Deterministic dev/test verifier (FACE_VERIFIER_DRIVER=stub). NOT production face
 * recognition — it derives a stable pseudo-embedding from the image bytes so identical
 * frames enroll & verify to cosine ~1.0 and different frames stay near-orthogonal. This
 * lets the enroll→dup-check→check-in flow run end-to-end without the vendored ONNX model.
 * The real match/threshold logic (face-math) is shared with the production driver.
 */
@Injectable()
export class StubFaceVerifier implements FaceVerifier {
  constructor(private readonly config: HrConfigService) {}

  async enroll(images: Buffer[]): Promise<FaceEmbeddingResult> {
    if (images.length === 0) throw new Error('enroll: no frames');
    return { vector: meanNormalize(images.map((b) => this.embed(b))), quality: 0.99 };
  }

  async verify(image: Buffer, enrolled: number[][], live: boolean): Promise<FaceVerifyResult> {
    const { score } = bestMatch(this.embed(image), enrolled);
    return { score, matched: score >= this.config.faceMatchThreshold, live };
  }

  /** FNV-1a seed over the bytes → mulberry32 PRNG → normalized 512-d vector. */
  private embed(buf: Buffer): number[] {
    let seed = 0x811c9dc5;
    for (const byte of buf) {
      seed ^= byte;
      seed = Math.imul(seed, 0x01000193);
    }
    let s = seed >>> 0;
    const v = new Array<number>(DIM);
    for (let i = 0; i < DIM; i++) {
      s |= 0;
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      v[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
    }
    return l2normalize(v);
  }
}
