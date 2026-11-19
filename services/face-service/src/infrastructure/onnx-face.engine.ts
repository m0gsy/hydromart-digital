import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ImageTooSmallError, NoFaceError, UnreadableImageError } from '../domain/errors';
import {
  CROP,
  DET_INPUT,
  DET_LONG_SIDE,
  decodeYuNet,
  detectorSize,
  l2normalize,
  packDetectorInput,
  packRecognizerInput,
  resizeArea,
  similarityTransform,
  toOriginal,
  warpAffine,
} from '../domain/pipeline';

/** What hr-service gets back: a unit-length 128-d SFace embedding and the detector's score. */
export interface EmbedResult {
  vector: number[];
  detScore: number;
}

export interface FaceEngine {
  /** JPEG bytes → embedding of the highest-scoring face; NoFaceError when there is none. */
  embed(jpeg: Buffer): Promise<EmbedResult>;
  /** Both sessions actually run (not just load): a detector pass and a recognizer pass. */
  selfCheck(): Promise<void>;
}

export const FACE_ENGINE = Symbol('FACE_ENGINE');

/** The two models, pinned to opencv_zoo's files — anything else is refused at boot. */
export const MODEL_SHA256: Record<string, string> = {
  'face_detection_yunet_2023mar.onnx':
    '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4',
  'face_recognition_sface_2021dec.onnx':
    '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79',
};
export const DETECTOR_MODEL = 'face_detection_yunet_2023mar.onnx';
export const RECOGNIZER_MODEL = 'face_recognition_sface_2021dec.onnx';
const EMBEDDING_SIZE = 128;

// ---- the two native modules, as little of each as is used ----

interface RawImage {
  data: Buffer;
  info: { width: number; height: number; channels: number };
}
interface SharpChain {
  rotate(): SharpChain;
  toColourspace(space: string): SharpChain;
  removeAlpha(): SharpChain;
  raw(): SharpChain;
  toBuffer(opts: { resolveWithObject: true }): Promise<RawImage>;
}
export interface SharpLike {
  (input: Buffer): SharpChain;
  cache(on: boolean): unknown;
}
interface TensorLike {
  data: ArrayLike<number>;
}
export interface SessionLike {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, TensorLike>>;
}
export interface OrtLike {
  InferenceSession: { create(model: Uint8Array, opts: object): Promise<SessionLike> };
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown;
}
export interface EngineDeps {
  sharp: SharpLike;
  ort: OrtLike;
  readFile: (path: string) => Buffer;
  /** The model pins; tests substitute their own, production never does. */
  pins?: Record<string, string>;
}

/** Load an optional native module by name; null if it is not installed on this box. */
export function optionalRequire<T>(name: string): T | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(name) as T;
  } catch {
    return null;
  }
}

/** sharp + onnxruntime-node, or a clear refusal: there is no fake embedding to fall back on. */
export function loadNativeDeps(load: <T>(name: string) => T | null): EngineDeps {
  const sharp = load<SharpLike>('sharp');
  const ort = load<OrtLike>('onnxruntime-node');
  if (!sharp || !ort) {
    throw new Error('face-service needs sharp and onnxruntime-node installed (optionalDependencies)');
  }
  return { sharp, ort, readFile: (p) => readFileSync(p) };
}

/** Reads a model and refuses it unless its sha256 matches the pin. */
export function readPinnedModel(
  file: string,
  readFile: (path: string) => Buffer,
  pins: Record<string, string> = MODEL_SHA256,
): Buffer {
  const name = file.slice(Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')) + 1);
  const want = pins[name];
  const bytes = readFile(file);
  const got = createHash('sha256').update(bytes).digest('hex');
  if (!want || got !== want) {
    throw new Error(`refusing model ${name}: sha256 ${got} is not the pinned ${want ?? '(none)'}`);
  }
  return bytes;
}

/**
 * The face engine: decode (sharp) → YuNet → align → SFace, one image at a time.
 *
 * ORT runs single-threaded (inference is serialised by EmbedService anyway, and one thread
 * keeps the container's CPU predictable) at log level 3 — deviation 6: SFace prints ~170
 * initializer warnings otherwise. sharp's cache is off — deviation 7: every request is a
 * new image, a cache only holds memory. Deviation 8, untested: sharp converts an embedded
 * ICC profile (Display-P3 phone photos) to sRGB, where OpenCV ignores profiles.
 */
export async function createOnnxFaceEngine(
  modelDir: string,
  deps: EngineDeps = loadNativeDeps(optionalRequire),
): Promise<FaceEngine> {
  const { sharp, ort, readFile, pins = MODEL_SHA256 } = deps;
  sharp.cache(false);
  const opts = { intraOpNumThreads: 1, logSeverityLevel: 3 };
  const det = await ort.InferenceSession.create(
    readPinnedModel(join(modelDir, DETECTOR_MODEL), readFile, pins),
    opts,
  );
  const rec = await ort.InferenceSession.create(
    readPinnedModel(join(modelDir, RECOGNIZER_MODEL), readFile, pins),
    opts,
  );

  const detect = async (rgb: Uint8Array | Uint8ClampedArray, width: number, height: number) => {
    const size = detectorSize(width, height);
    const small = resizeArea(rgb, width, height, size.width, size.height);
    const input = new ort.Tensor('float32', packDetectorInput(small, size.width, size.height), [
      1,
      3,
      DET_INPUT,
      DET_INPUT,
    ]);
    const out = await det.run({ [det.inputNames[0]]: input });
    const faces = decodeYuNet(
      Object.fromEntries(Object.entries(out).map(([k, t]) => [k, t.data])),
    );
    return faces.length
      ? toOriginal(faces[0], width / size.width, height / size.height)
      : null;
  };

  const recognise = async (crop: Uint8ClampedArray) => {
    const out = await rec.run({
      [rec.inputNames[0]]: new ort.Tensor('float32', packRecognizerInput(crop), [1, 3, CROP, CROP]),
    });
    const raw = out[rec.outputNames[0]]?.data;
    if (!raw || raw.length !== EMBEDDING_SIZE) {
      throw new Error(`SFace: expected a ${EMBEDDING_SIZE}-d output, got ${raw?.length ?? 'none'}`);
    }
    return raw;
  };

  return {
    async embed(jpeg) {
      let decoded: RawImage;
      try {
        decoded = await sharp(jpeg).rotate().toColourspace('srgb').removeAlpha().raw().toBuffer({
          resolveWithObject: true,
        });
      } catch {
        throw new UnreadableImageError();
      }
      const { data, info } = decoded;
      if (info.channels !== 3 || data.length !== info.width * info.height * 3) {
        throw new UnreadableImageError();
      }
      if (Math.max(info.width, info.height) < DET_LONG_SIDE) {
        throw new ImageTooSmallError(DET_LONG_SIDE);
      }
      const face = await detect(data, info.width, info.height);
      if (!face) throw new NoFaceError();
      const crop = warpAffine(data, info.width, info.height, similarityTransform(face.landmarks));
      return { vector: l2normalize(await recognise(crop)), detScore: face.score };
    },

    async selfCheck() {
      // An empty frame: the detector must run and find nothing; the recogniser must run and
      // give 128 finite numbers. Loading is not running — a session can load and still fail.
      const blank = new Uint8Array(DET_LONG_SIDE * DET_LONG_SIDE * 3);
      if (await detect(blank, DET_LONG_SIDE, DET_LONG_SIDE)) {
        throw new Error('self-check: the detector found a face in an empty frame');
      }
      const raw = await recognise(new Uint8ClampedArray(CROP * CROP * 3));
      if (!Array.from(raw).every(Number.isFinite)) {
        throw new Error('self-check: the recogniser returned a non-finite embedding');
      }
    },
  };
}
