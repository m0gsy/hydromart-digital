import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { HrConfigService } from '../../config/hr-config.service';
import {
  FaceEmbeddingResult,
  FaceVerifier,
  FaceVerifyResult,
} from '../../application/ports/face-verifier.port';
import { bestMatch, meanNormalize } from '../../domain/face-math';

/**
 * Production face engine: in-process ArcFace via onnxruntime-node (no cloud/GPU).
 *
 * DEFERRED I/O (see M2 notes): the embedding step needs two things that aren't vendored
 * in the repo — the `onnxruntime-node` native dep and a ~100 MB ArcFace `.onnx` at
 * HR_FACE_MODEL_PATH — neither installable/verifiable in this environment. Until they're
 * provisioned at deploy, `embed()` throws a clear 503 (never a fake vector). The MATCH
 * logic below (bestMatch/meanNormalize + faceMatchThreshold) is the real, shared,
 * unit-tested path; only the model call is pending. For dev/test, set
 * FACE_VERIFIER_DRIVER=stub to run the whole flow end-to-end.
 *
 * ponytail: swap `embed()` for the onnxruntime-node session (lazy `import('onnxruntime-node')`,
 * decode → 112×112 RGB tensor → run → 512-d output) once the model + dep are on the box;
 * nothing else in this class changes.
 */
@Injectable()
export class OnnxArcFaceVerifier implements FaceVerifier {
  constructor(private readonly config: HrConfigService) {}

  async enroll(images: Buffer[]): Promise<FaceEmbeddingResult> {
    if (images.length === 0) throw new Error('enroll: no frames');
    const vectors: number[][] = [];
    for (const img of images) vectors.push(await this.embed(img));
    return { vector: meanNormalize(vectors), quality: 1 };
  }

  async verify(image: Buffer, enrolled: number[][], live: boolean): Promise<FaceVerifyResult> {
    const { score } = bestMatch(await this.embed(image), enrolled);
    return { score, matched: score >= this.config.faceMatchThreshold, live };
  }

  private async embed(_image: Buffer): Promise<number[]> {
    throw new ServiceUnavailableException(
      `Face engine belum aktif: model ArcFace (${this.config.faceModelPath}) + onnxruntime-node ` +
        `belum tersedia di server ini. Set FACE_VERIFIER_DRIVER=stub untuk mode dev.`,
    );
  }
}
