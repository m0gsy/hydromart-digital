import { createHash } from 'node:crypto';

import { ImageTooSmallError, NoFaceError, UnreadableImageError } from '../../src/domain/errors';
import { DET_INPUT } from '../../src/domain/pipeline';
import {
  DETECTOR_MODEL,
  RECOGNIZER_MODEL,
  createOnnxFaceEngine,
  loadNativeDeps,
  optionalRequire,
  readPinnedModel,
  type EngineDeps,
  type SessionLike,
} from '../../src/infrastructure/onnx-face.engine';

const DET_BYTES = Buffer.from('fake yunet');
const REC_BYTES = Buffer.from('fake sface');
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const PINS = { [DETECTOR_MODEL]: sha(DET_BYTES), [RECOGNIZER_MODEL]: sha(REC_BYTES) };

/** YuNet-shaped outputs: one face at stride 8 when `face`, nothing otherwise. */
function detectorOutputs(face: boolean) {
  const out: Record<string, { data: Float32Array }> = {};
  for (const s of [8, 16, 32]) {
    const n = (DET_INPUT / s) ** 2;
    out[`cls_${s}`] = { data: new Float32Array(n) };
    out[`obj_${s}`] = { data: new Float32Array(n) };
    out[`bbox_${s}`] = { data: new Float32Array(n * 4) };
    out[`kps_${s}`] = { data: new Float32Array(n * 10) };
  }
  if (face) {
    const i = 10 * 80 + 10; // stride 8: row 10, column 10
    out.cls_8.data[i] = 0.95;
    out.obj_8.data[i] = 0.95;
    out.bbox_8.data.set([0.5, 0.5, Math.log(4), Math.log(4)], i * 4);
    // Five distinct landmarks, roughly eyes / nose / mouth.
    out.kps_8.data.set([-1, -1, 1, -1, 0, 0, -1, 1, 1, 1], i * 10);
  }
  return out;
}

interface Fakes {
  face?: boolean;
  recognizerLength?: number;
  recognizerValue?: number;
  recognizerMissing?: boolean;
  decode?: () => Promise<{ data: Buffer; info: { width: number; height: number; channels: number } }>;
}

function deps(f: Fakes = {}): EngineDeps & { cache: jest.Mock; created: unknown[] } {
  const created: unknown[] = [];
  const cache = jest.fn();
  const session = (bytes: Uint8Array): SessionLike => {
    const isDetector = Buffer.from(bytes).equals(DET_BYTES);
    return {
      inputNames: [isDetector ? 'input' : 'data'],
      outputNames: [isDetector ? 'cls_8' : 'fc1'],
      run: async () =>
        isDetector
          ? detectorOutputs(f.face ?? true)
          : f.recognizerMissing
            ? {}
            : { fc1: { data: new Float32Array(f.recognizerLength ?? 128).fill(f.recognizerValue ?? 2) } },
    };
  };
  const decode =
    f.decode ??
    (async () => ({ data: Buffer.alloc(400 * 300 * 3, 120), info: { width: 400, height: 300, channels: 3 } }));
  const chain = {
    rotate: () => chain,
    toColourspace: () => chain,
    removeAlpha: () => chain,
    raw: () => chain,
    toBuffer: decode,
  };
  const sharp = Object.assign(() => chain, { cache });
  return {
    cache,
    created,
    pins: PINS,
    readFile: (p: string) => (p.endsWith(DETECTOR_MODEL) ? DET_BYTES : REC_BYTES),
    sharp,
    ort: {
      InferenceSession: {
        create: async (model: Uint8Array, opts: object) => {
          created.push(opts);
          return session(model);
        },
      },
      Tensor: class {
        constructor(
          readonly type: string,
          readonly data: Float32Array,
          readonly dims: number[],
        ) {}
      },
    },
  };
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

describe('readPinnedModel', () => {
  it('returns the bytes of a model that matches its pin', () => {
    expect(readPinnedModel(`/m/${DETECTOR_MODEL}`, () => DET_BYTES, PINS)).toBe(DET_BYTES);
  });
  it('refuses a model whose hash is not the pinned one', () => {
    expect(() => readPinnedModel(`/m/${DETECTOR_MODEL}`, () => REC_BYTES, PINS)).toThrow(/refusing model/);
  });
  it('refuses a file with no pin at all, with the real pins by default', () => {
    expect(() => readPinnedModel('/m/other.onnx', () => DET_BYTES)).toThrow(/\(none\)/);
    expect(() => readPinnedModel(`/m/${DETECTOR_MODEL}`, () => DET_BYTES)).toThrow(/refusing model/);
  });
  it('reads a bare file name too', () => {
    expect(() => readPinnedModel('x.onnx', () => DET_BYTES, PINS)).toThrow(/refusing model x\.onnx/);
  });
});

describe('createOnnxFaceEngine', () => {
  it('turns off the image cache and runs both sessions single-threaded and quiet', async () => {
    const d = deps();
    await createOnnxFaceEngine('/models', d);
    expect(d.cache).toHaveBeenCalledWith(false);
    expect(d.created).toEqual([
      { intraOpNumThreads: 1, logSeverityLevel: 3 },
      { intraOpNumThreads: 1, logSeverityLevel: 3 },
    ]);
  });

  it('refuses to start on files that are not the pinned models, with the real pins', async () => {
    const withoutPins = deps();
    delete withoutPins.pins;
    await expect(createOnnxFaceEngine('/models', withoutPins)).rejects.toThrow(/refusing model/);
  });

  it('refuses to start on its own when the models are not where it was told', async () => {
    // The real native modules where installed, or a refusal to load them: either way, no engine.
    await expect(createOnnxFaceEngine('/no/such/model/dir')).rejects.toThrow();
  });

  it('embeds the face as a unit 128-d vector with the detector score', async () => {
    const engine = await createOnnxFaceEngine('/models', deps());
    const { vector, detScore } = await engine.embed(JPEG);
    expect(vector).toHaveLength(128);
    expect(vector.reduce((s, x) => s + x * x, 0)).toBeCloseTo(1);
    expect(detScore).toBeCloseTo(0.95);
  });

  it('says NO_FACE when the detector finds nothing', async () => {
    const engine = await createOnnxFaceEngine('/models', deps({ face: false }));
    await expect(engine.embed(JPEG)).rejects.toBeInstanceOf(NoFaceError);
  });

  it('says UNREADABLE when the bytes do not decode, or decode to something not RGB', async () => {
    const broken = await createOnnxFaceEngine(
      '/models',
      deps({ decode: () => Promise.reject(new Error('Input buffer contains unsupported image format')) }),
    );
    await expect(broken.embed(JPEG)).rejects.toBeInstanceOf(UnreadableImageError);
    const rgba = await createOnnxFaceEngine(
      '/models',
      deps({ decode: async () => ({ data: Buffer.alloc(10), info: { width: 400, height: 300, channels: 4 } }) }),
    );
    await expect(rgba.embed(JPEG)).rejects.toBeInstanceOf(UnreadableImageError);
    const short = await createOnnxFaceEngine(
      '/models',
      deps({ decode: async () => ({ data: Buffer.alloc(10), info: { width: 400, height: 300, channels: 3 } }) }),
    );
    await expect(short.embed(JPEG)).rejects.toBeInstanceOf(UnreadableImageError);
  });

  it('refuses an image smaller than the detector input', async () => {
    const engine = await createOnnxFaceEngine(
      '/models',
      deps({ decode: async () => ({ data: Buffer.alloc(200 * 100 * 3), info: { width: 200, height: 100, channels: 3 } }) }),
    );
    await expect(engine.embed(JPEG)).rejects.toBeInstanceOf(ImageTooSmallError);
  });

  it('refuses a recogniser answer that is not 128-d, or missing', async () => {
    const wrong = await createOnnxFaceEngine('/models', deps({ recognizerLength: 64 }));
    await expect(wrong.embed(JPEG)).rejects.toThrow(/128-d output, got 64/);
    const missing = await createOnnxFaceEngine('/models', deps({ recognizerMissing: true }));
    await expect(missing.embed(JPEG)).rejects.toThrow(/got none/);
  });

  describe('selfCheck', () => {
    it('passes when the detector finds nothing in an empty frame and the recogniser runs', async () => {
      const engine = await createOnnxFaceEngine('/models', deps({ face: false }));
      await expect(engine.selfCheck()).resolves.toBeUndefined();
    });
    it('fails when the detector sees a face in an empty frame', async () => {
      const engine = await createOnnxFaceEngine('/models', deps({ face: true }));
      await expect(engine.selfCheck()).rejects.toThrow(/empty frame/);
    });
    it('fails on a non-finite embedding', async () => {
      const engine = await createOnnxFaceEngine('/models', deps({ face: false, recognizerValue: NaN }));
      await expect(engine.selfCheck()).rejects.toThrow(/non-finite/);
    });
  });
});

describe('loadNativeDeps / optionalRequire', () => {
  it('returns null for a module that is not installed, and the module when it is', () => {
    expect(optionalRequire('definitely-not-installed-face-module')).toBeNull();
    expect(optionalRequire<typeof import('node:path')>('node:path')?.join('a', 'b')).toMatch(/a.b/);
  });
  it('refuses to start without either native module', () => {
    expect(() => loadNativeDeps(() => null)).toThrow(/needs sharp and onnxruntime-node/);
    expect(() => loadNativeDeps(<T>(name: string) => (name === 'sharp' ? ({} as T) : null))).toThrow();
  });
  it('hands back both, with a file reader', () => {
    const d = loadNativeDeps(<T>() => ({}) as T);
    expect(d.readFile(__filename).length).toBeGreaterThan(0);
  });
});
