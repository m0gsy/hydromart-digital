import {
  CROP,
  DET_INPUT,
  TEMPLATE,
  areaTable,
  cosine,
  decodeYuNet,
  detectorSize,
  iou,
  l2normalize,
  packDetectorInput,
  packRecognizerInput,
  resizeArea,
  similarityTransform,
  toOriginal,
  warpAffine,
  type YuNetOutputs,
} from '../../src/domain/pipeline';

/** YuNet outputs with every anchor at score 0, plus the anchors given. */
function yunet(hits: { stride: 8 | 16 | 32; index: number; score?: number; box?: number[] }[] = []): YuNetOutputs {
  const out: Record<string, Float32Array> = {};
  for (const s of [8, 16, 32]) {
    const n = (DET_INPUT / s) ** 2;
    out[`cls_${s}`] = new Float32Array(n);
    out[`obj_${s}`] = new Float32Array(n);
    out[`bbox_${s}`] = new Float32Array(n * 4);
    out[`kps_${s}`] = new Float32Array(n * 10);
  }
  for (const h of hits) {
    out[`cls_${h.stride}`][h.index] = h.score ?? 1;
    out[`obj_${h.stride}`][h.index] = h.score ?? 1;
    out[`bbox_${h.stride}`].set(h.box ?? [0.5, 0.5, Math.log(4), Math.log(4)], h.index * 4);
  }
  return out;
}

describe('detectorSize', () => {
  it('scales the longest side to 320 and keeps the aspect', () => {
    expect(detectorSize(640, 480)).toEqual({ width: 320, height: 240 });
    expect(detectorSize(480, 640)).toEqual({ width: 240, height: 320 });
  });
  it('never gives a zero side', () => {
    expect(detectorSize(4000, 1)).toEqual({ width: 320, height: 1 });
  });
});

describe('areaTable / resizeArea (OpenCV INTER_AREA)', () => {
  it('averages whole cells on an integer scale', () => {
    // 4×1 → 2×1: each output pixel is the mean of two inputs.
    const rgb = Uint8Array.from([10, 20, 30, 30, 40, 50, 100, 110, 120, 200, 210, 220]);
    expect(Array.from(resizeArea(rgb, 4, 1, 2, 1))).toEqual([20, 30, 40, 150, 160, 170]);
  });
  it('weights the partial cells of a fractional scale', () => {
    const t = areaTable(5, 2);
    // 2.5 source pixels per output: both edge fractions appear, the weights sum to 1.
    const sum0 = Array.from(t.w).filter((_, k) => t.d[k] === 0).reduce((a, b) => a + b, 0);
    const sum1 = Array.from(t.w).filter((_, k) => t.d[k] === 1).reduce((a, b) => a + b, 0);
    expect(sum0).toBeCloseTo(1);
    expect(sum1).toBeCloseTo(1);
    expect(Array.from(t.s)).toContain(2);
  });
  it('keeps an image already at size', () => {
    const rgb = Uint8Array.from([1, 2, 3, 4, 5, 6]);
    expect(Array.from(resizeArea(rgb, 2, 1, 2, 1))).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('packDetectorInput', () => {
  it('writes BGR planes top-left on the 640 canvas, zero elsewhere', () => {
    const t = packDetectorInput(Uint8Array.from([1, 2, 3]), 1, 1);
    const plane = DET_INPUT * DET_INPUT;
    expect([t[0], t[plane], t[2 * plane]]).toEqual([3, 2, 1]);
    expect(t[1]).toBe(0);
  });
});

describe('iou', () => {
  it('is 0 apart and 1 for the same box', () => {
    expect(iou([0, 0, 1, 1], [5, 5, 1, 1])).toBe(0);
    expect(iou([0, 0, 2, 2], [0, 0, 2, 2])).toBe(1);
  });
});

describe('decodeYuNet', () => {
  it('finds nothing when no anchor clears the score floor', () => {
    expect(decodeYuNet(yunet([{ stride: 8, index: 0, score: 0.5 }]))).toEqual([]);
  });
  it('decodes an anchor into a box and five landmarks, in canvas pixels', () => {
    const [f] = decodeYuNet(yunet([{ stride: 16, index: 41 }]));
    // index 41 at stride 16 (40 columns) = row 1, column 1.
    expect(f.score).toBeCloseTo(1);
    expect(f.box[2]).toBeCloseTo(64);
    expect(f.box[0]).toBeCloseTo((1 + 0.5) * 16 - 32);
    expect(f.landmarks).toHaveLength(5);
    expect(f.landmarks[0]).toEqual([16, 16]);
  });
  it('keeps the best of overlapping boxes and every box apart', () => {
    const faces = decodeYuNet(
      yunet([
        { stride: 8, index: 85, score: 0.95 },
        { stride: 8, index: 86, score: 0.99 }, // overlaps 85
        { stride: 32, index: 399, score: 0.92 }, // far corner
      ]),
    );
    expect(faces).toHaveLength(2);
    expect(faces[0].score).toBeCloseTo(0.99);
  });
  it.each([
    ['a missing output', (o: Record<string, Float32Array>) => delete o.kps_32],
    ['a short output', (o: Record<string, Float32Array>) => (o.cls_8 = new Float32Array(3))],
    ['a short obj output', (o: Record<string, Float32Array>) => (o.obj_16 = new Float32Array(3))],
    ['a short bbox output', (o: Record<string, Float32Array>) => (o.bbox_16 = new Float32Array(3))],
  ])('refuses %s', (_why, mangle) => {
    const out = yunet() as Record<string, Float32Array>;
    mangle(out);
    expect(() => decodeYuNet(out)).toThrow(/unexpected output shape/);
  });
});

describe('toOriginal', () => {
  it('maps detector pixels back with the pixel-centre convention', () => {
    const f = toOriginal({ score: 0.9, box: [0, 0, 10, 10], landmarks: [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]] }, 2, 2);
    expect(f.box).toEqual([0.5, 0.5, 20, 20]);
    expect(f.landmarks[1]).toEqual([2.5, 2.5]);
  });
});

describe('similarityTransform', () => {
  it('is the identity for the template itself', () => {
    const m = similarityTransform(TEMPLATE);
    [1, 0, 0, 0, 1, 0].forEach((want, i) => expect(m[i]).toBeCloseTo(want, 6));
  });
  it('undoes a scale and a shift', () => {
    const src = TEMPLATE.map(([x, y]) => [x * 2 + 10, y * 2 + 20] as const);
    const m = similarityTransform(src);
    const [x, y] = src[2];
    expect(m[0] * x + m[1] * y + m[2]).toBeCloseTo(TEMPLATE[2][0]);
    expect(m[3] * x + m[4] * y + m[5]).toBeCloseTo(TEMPLATE[2][1]);
  });
});

describe('warpAffine', () => {
  it('copies pixels under the identity, and reads black outside the image', () => {
    const rgb = Uint8Array.from([50, 60, 70]);
    const out = warpAffine(rgb, 1, 1, [1, 0, 0, 0, 1, 0], 2);
    expect(Array.from(out.slice(0, 3))).toEqual([50, 60, 70]);
    expect(Array.from(out.slice(3, 6))).toEqual([0, 0, 0]);
  });
  it('makes a CROP-sized crop by default', () => {
    expect(warpAffine(new Uint8Array(3), 1, 1, [1, 0, 0, 0, 1, 0])).toHaveLength(CROP * CROP * 3);
  });
});

describe('packRecognizerInput', () => {
  it('writes RGB planes', () => {
    const t = packRecognizerInput(Uint8Array.from([1, 2, 3, 4, 5, 6]), 1);
    expect(Array.from(t.slice(0, 3))).toEqual([1, 2, 3]);
  });
});

describe('l2normalize / cosine', () => {
  it('makes a unit vector, and leaves a zero vector at zero', () => {
    const v = l2normalize([3, 4]);
    expect(v).toEqual([0.6, 0.8]);
    expect(cosine(v, v)).toBeCloseTo(1);
    expect(l2normalize([0, 0])).toEqual([0, 0]);
  });
});
