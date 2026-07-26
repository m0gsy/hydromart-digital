import type { HrConfigService } from '../../src/config/hr-config.service';
import { StubFaceVerifier } from '../../src/infrastructure/face/stub-face.verifier';

// StubFaceVerifier is deterministic → tested directly. OnnxArcFaceVerifier does native I/O
// (onnxruntime-node + sharp) so its deps are mocked via jest.isolateModules/doMock: the happy
// path with fake session/decoder, plus every "engine unavailable" 503 branch.

const RGB_LEN = 112 * 112 * 3;

function cfg(over: Partial<Record<string, unknown>> = {}): HrConfigService {
  return {
    faceMatchThreshold: 0.62,
    faceModelPath: './models/arcface.onnx',
    ...over,
  } as unknown as HrConfigService;
}

describe('StubFaceVerifier', () => {
  const svc = new StubFaceVerifier(cfg());

  it('throws when enrolling with no frames', async () => {
    await expect(svc.enroll([])).rejects.toThrow(/no frames/);
  });

  it('enrolls and verifies identical frames to a high (matched) cosine score', async () => {
    const frame = Buffer.from('same-face-bytes-123');
    const { vector, quality } = await svc.enroll([frame, frame]);
    expect(quality).toBeCloseTo(0.99);
    const result = await svc.verify(frame, [vector], true);
    expect(result.score).toBeGreaterThan(0.99);
    expect(result.matched).toBe(true);
    expect(result.live).toBe(true);
  });

  it('keeps a different frame below the match threshold', async () => {
    const enrolled = (await svc.enroll([Buffer.from('face-A')])).vector;
    const result = await svc.verify(Buffer.from('totally-different-face-B'), [enrolled], false);
    expect(result.matched).toBe(false);
    expect(result.live).toBe(false);
  });
});

// --- OnnxArcFaceVerifier ---

function fakeSession(run: () => Promise<Record<string, { data: Float32Array | number[] }>>) {
  return { inputNames: ['input'], outputNames: ['output'], run };
}

function fakeOrt(createImpl: () => Promise<unknown>) {
  return {
    InferenceSession: { create: createImpl },
    Tensor: class {
      constructor(
        public type: string,
        public data: Float32Array,
        public dims: number[],
      ) {}
    },
  };
}

const fakeSharp = () => (_buf: Buffer) => ({
  resize: () => ({
    removeAlpha: () => ({
      raw: () => ({ toBuffer: async () => Buffer.alloc(RGB_LEN, 128) }),
    }),
  }),
});

function loadVerifier(setup: () => void) {
  let Verifier!: typeof import('../../src/infrastructure/face/onnx-arcface.verifier').OnnxArcFaceVerifier;
  jest.isolateModules(() => {
    setup();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Verifier = require('../../src/infrastructure/face/onnx-arcface.verifier').OnnxArcFaceVerifier;
  });
  return Verifier;
}

describe('OnnxArcFaceVerifier', () => {
  afterEach(() => jest.resetModules());

  it('enrolls + verifies through a mocked ONNX session and sharp decoder', async () => {
    const vec = new Float32Array(512).fill(0.1);
    const Verifier = loadVerifier(() => {
      jest.doMock('onnxruntime-node', () => fakeOrt(async () => fakeSession(async () => ({ output: { data: vec } }))), {
        virtual: true,
      });
      jest.doMock('sharp', () => fakeSharp(), { virtual: true });
    });
    const svc = new Verifier(cfg());

    const enrolled = await svc.enroll([Buffer.from('img1'), Buffer.from('img2')]);
    expect(enrolled.vector).toHaveLength(512);
    expect(enrolled.quality).toBe(1);

    // Second call reuses the cached session (exercises the `if (!this.session)` false branch).
    const result = await svc.verify(Buffer.from('probe'), [enrolled.vector], true);
    expect(result.matched).toBe(true); // identical mean vector → cosine ~1
    expect(result.live).toBe(true);
  });

  it('503s when the model returns no embedding', async () => {
    const Verifier = loadVerifier(() => {
      jest.doMock('onnxruntime-node', () => fakeOrt(async () => fakeSession(async () => ({}))), { virtual: true });
      jest.doMock('sharp', () => fakeSharp(), { virtual: true });
    });
    await expect(new Verifier(cfg()).verify(Buffer.from('x'), [[1]], true)).rejects.toThrow(/embedding/);
  });

  it('503s (and lets a later retry) when the ArcFace model fails to load', async () => {
    const Verifier = loadVerifier(() => {
      jest.doMock('onnxruntime-node', () => fakeOrt(async () => Promise.reject(new Error('model file missing'))), {
        virtual: true,
      });
      jest.doMock('sharp', () => fakeSharp(), { virtual: true });
    });
    await expect(new Verifier(cfg()).verify(Buffer.from('x'), [[1]], true)).rejects.toThrow(/model ArcFace/);
  });

  it('503s when onnxruntime-node is not installed', async () => {
    // Force require('onnxruntime-node') to throw → optionalRequire returns null → unavailable.
    const Verifier = loadVerifier(() => {
      jest.doMock(
        'onnxruntime-node',
        () => {
          throw new Error('Cannot find module onnxruntime-node');
        },
        { virtual: true },
      );
      jest.doMock('sharp', () => fakeSharp(), { virtual: true });
    });
    await expect(new Verifier(cfg()).verify(Buffer.from('x'), [[1]], true)).rejects.toThrow(/onnxruntime-node/);
  });

  it('503s when sharp (image decoder) is not installed', async () => {
    const Verifier = loadVerifier(() => {
      jest.doMock('onnxruntime-node', () => fakeOrt(async () => fakeSession(async () => ({ output: { data: new Float32Array(512) } }))), {
        virtual: true,
      });
      jest.doMock(
        'sharp',
        () => {
          throw new Error('Cannot find module sharp');
        },
        { virtual: true },
      );
    });
    await expect(new Verifier(cfg()).verify(Buffer.from('x'), [[1]], true)).rejects.toThrow(/sharp/);
  });

  it('rejects an empty enroll before any engine work', async () => {
    const Verifier = loadVerifier(() => {
      jest.doMock('onnxruntime-node', () => fakeOrt(async () => fakeSession(async () => ({}))), { virtual: true });
    });
    await expect(new Verifier(cfg()).enroll([])).rejects.toThrow(/no frames/);
  });
});
