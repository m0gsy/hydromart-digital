import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { HrConfigService } from '../../config/hr-config.service';
import {
  FaceEmbeddingResult,
  FaceVerifier,
  FaceVerifyResult,
} from '../../application/ports/face-verifier.port';
import { bestMatch, meanNormalize, rgbToNchw } from '../../domain/face-math';

const FACE_SIZE = 112;

// Minimal structural types for the two optional native deps, loaded at runtime so a box
// without them (dev/CI) still compiles and runs the stub driver.
interface OrtTensor {
  data: Float32Array | number[];
}
interface OrtSession {
  inputNames: string[];
  outputNames: string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensor>>;
}
interface OrtModule {
  InferenceSession: { create(path: string): Promise<OrtSession> };
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown;
}
interface SharpFactory {
  (buf: Buffer): {
    resize(w: number, h: number, opts?: { fit?: string }): {
      removeAlpha(): { raw(): { toBuffer(): Promise<Buffer> } };
    };
  };
}

/** Load an optional native module by name; null if it isn't installed on this box. */
function optionalRequire<T>(name: string): T | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(name) as T;
  } catch {
    return null;
  }
}

/**
 * Production face engine: in-process ArcFace via onnxruntime-node (no cloud/GPU).
 *
 * `embed()` runs the real pipeline: decode → 112×112 RGB (sharp) → NCHW tensor (InsightFace
 * normalization) → ArcFace ONNX session → 512-d embedding. The ONNX session is created once
 * and cached. The MATCH logic (bestMatch/meanNormalize + faceMatchThreshold) is the shared,
 * unit-tested path.
 *
 * OPS PREREQUISITE: `onnxruntime-node` + `sharp` must be installed and a ~100 MB ArcFace
 * `.onnx` present at HR_FACE_MODEL_PATH. Any missing piece → a clear 503 (never a fake
 * vector). For dev/CI, set FACE_VERIFIER_DRIVER=stub to run the whole flow end-to-end.
 */
@Injectable()
export class OnnxArcFaceVerifier implements FaceVerifier {
  private session: Promise<OrtSession> | null = null;
  private ort: OrtModule | null = null;

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

  private async embed(image: Buffer): Promise<number[]> {
    const session = await this.getSession();
    const ort = this.ort!;
    const input = await this.preprocess(image);
    const tensor = new ort.Tensor('float32', input, [1, 3, FACE_SIZE, FACE_SIZE]);
    const output = await session.run({ [session.inputNames[0]]: tensor });
    const vector = output[session.outputNames[0]]?.data;
    if (!vector) throw new ServiceUnavailableException('Face engine: model tidak mengembalikan embedding');
    return Array.from(vector);
  }

  /** Decode + resize the aligned frame to a planar NCHW ArcFace input tensor. */
  private async preprocess(image: Buffer): Promise<Float32Array> {
    const sharp = optionalRequire<SharpFactory>('sharp');
    if (!sharp) throw this.unavailable('sharp (image decoder)');
    const rgb = await sharp(image).resize(FACE_SIZE, FACE_SIZE, { fit: 'cover' }).removeAlpha().raw().toBuffer();
    return rgbToNchw(rgb, FACE_SIZE);
  }

  /** Lazily create + cache the ONNX session (single load per process). */
  private getSession(): Promise<OrtSession> {
    if (!this.session) {
      const ort = optionalRequire<OrtModule>('onnxruntime-node');
      if (!ort) throw this.unavailable('onnxruntime-node');
      this.ort = ort;
      this.session = ort.InferenceSession.create(this.config.faceModelPath).catch((err: unknown) => {
        this.session = null; // let a later request retry once the model is in place
        throw this.unavailable(`model ArcFace (${this.config.faceModelPath}): ${String(err)}`);
      });
    }
    return this.session;
  }

  private unavailable(missing: string): ServiceUnavailableException {
    return new ServiceUnavailableException(
      `Face engine belum aktif: ${missing} belum tersedia di server ini. ` +
        `Set FACE_VERIFIER_DRIVER=stub untuk mode dev.`,
    );
  }
}
