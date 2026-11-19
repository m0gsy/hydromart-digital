/**
 * JPEG pixels → YuNet 2023mar detection → 5-point similarity alignment → SFace 2021dec input.
 *
 * Pure functions, no I/O. They mirror OpenCV's FaceDetectorYN::postProcess and
 * FaceRecognizerSF::alignCrop/feature closely enough that the embedding this service
 * produces is ≥ 0.99 cosine of OpenCV's own (the face plan's Step 0 spike, 2026-11-19, and
 * the image build's self-test against `test/fixtures/reference.json`). Each place it had to
 * deviate from the obvious code to get there is marked; do not "simplify" them away.
 */

/** The YuNet 2023mar ONNX input is fixed at [1,3,640,640]. */
export const DET_INPUT = 640;
/** The image is scaled so its longest side is this, placed top-left on a zero canvas. */
export const DET_LONG_SIDE = 320;
export const STRIDES = [8, 16, 32] as const;
export const SCORE_MIN = 0.9;
export const NMS_IOU = 0.3;
export const CROP = 112;
/** SFace's 5-point template in the 112×112 crop. */
export const TEMPLATE: readonly (readonly [number, number])[] = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

export type Point = readonly [number, number];
export interface Face {
  score: number;
  box: [number, number, number, number];
  /** right eye, left eye, nose tip, right mouth corner, left mouth corner */
  landmarks: Point[];
}

/** Size of the detector image: longest side DET_LONG_SIDE, aspect kept (deviation 2). */
export function detectorSize(width: number, height: number): { width: number; height: number } {
  const k = DET_LONG_SIDE / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

interface AreaTable {
  d: Int32Array;
  s: Int32Array;
  w: Float64Array;
}

/** OpenCV computeResizeAreaTab: per destination index, the source indices and weights it averages. */
export function areaTable(src: number, dst: number): AreaTable {
  const scale = src / dst;
  const d: number[] = [];
  const s: number[] = [];
  const w: number[] = [];
  const add = (di: number, si: number, wi: number) => {
    d.push(di);
    s.push(si);
    w.push(wi);
  };
  for (let i = 0; i < dst; i++) {
    const f1 = i * scale;
    const f2 = f1 + scale;
    const cell = Math.min(scale, src - f1);
    const s2 = Math.min(Math.floor(f2), src - 1);
    const s1 = Math.min(Math.ceil(f1), s2);
    if (s1 - f1 > 1e-3) add(i, s1 - 1, (s1 - f1) / cell);
    for (let k = s1; k < s2; k++) add(i, k, 1 / cell);
    if (f2 - s2 > 1e-3) add(i, s2, Math.min(f2 - s2, 1, cell) / cell);
  }
  return { d: Int32Array.from(d), s: Int32Array.from(s), w: Float64Array.from(w) };
}

/**
 * cv2.resize(..., INTER_AREA) on RGB HWC uint8 — deviation 1. Not sharp's resize: its
 * lanczos3 moves YuNet's landmarks 0.1–0.3 px from OpenCV's, which cost up to 0.025 cosine
 * and put 3 of 6 spike faces under 0.99. Enlarging degrades to nearest-neighbour, which is
 * why the engine refuses images smaller than the detector size.
 */
export function resizeArea(
  rgb: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  w2: number,
  h2: number,
): Uint8ClampedArray {
  const xt = areaTable(width, w2);
  const yt = areaTable(height, h2);
  const line = width * 3;
  const line2 = w2 * 3;
  // Vertical pass first: whole source rows, contiguous, where the bulk of the work is. Float
  // accumulators, like OpenCV's (WT=float).
  const cols = new Float32Array(h2 * line);
  for (let k = 0; k < yt.d.length; k++) {
    const o = yt.d[k] * line;
    const p = yt.s[k] * line;
    const a = yt.w[k];
    for (let i = 0; i < line; i++) cols[o + i] += a * rgb[p + i];
  }
  const acc = new Float32Array(h2 * line2); // the horizontal pass, on the h2 rows only
  for (let y = 0; y < h2; y++) {
    const si = y * line;
    const di = y * line2;
    for (let k = 0; k < xt.d.length; k++) {
      const o = di + xt.d[k] * 3;
      const p = si + xt.s[k] * 3;
      const a = xt.w[k];
      acc[o] += a * cols[p];
      acc[o + 1] += a * cols[p + 1];
      acc[o + 2] += a * cols[p + 2];
    }
  }
  return new Uint8ClampedArray(acc); // rounds and clamps like saturate_cast<uchar>
}

/** RGB HWC uint8 (w × h, both ≤ 640) → NCHW float32 [1,3,640,640], BGR planes, 0..255, rest 0. */
export function packDetectorInput(
  rgb: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): Float32Array {
  const plane = DET_INPUT * DET_INPUT;
  const t = new Float32Array(3 * plane);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 3;
      const o = y * DET_INPUT + x;
      t[o] = rgb[p + 2];
      t[plane + o] = rgb[p + 1];
      t[2 * plane + o] = rgb[p];
    }
  }
  return t;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function iou(a: readonly number[], b: readonly number[]): number {
  const iw = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const ih = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  if (iw <= 0 || ih <= 0) return 0;
  const inter = iw * ih;
  return inter / (a[2] * a[3] + b[2] * b[3] - inter);
}

export type YuNetOutputs = Record<string, ArrayLike<number>>;

/**
 * YuNet outputs (cls_8 … kps_32) → faces in detector-canvas pixels, by score, after greedy
 * NMS. Deviation 5: IoU on float boxes, where OpenCV truncates to Rect2i first — that only
 * changes which runner-up boxes survive, never the top one, which is the one used.
 */
export function decodeYuNet(out: YuNetOutputs, scoreMin = SCORE_MIN, nmsIou = NMS_IOU): Face[] {
  const faces: Face[] = [];
  for (const s of STRIDES) {
    const cols = DET_INPUT / s;
    const rows = DET_INPUT / s;
    const cls = out[`cls_${s}`];
    const obj = out[`obj_${s}`];
    const bbox = out[`bbox_${s}`];
    const kps = out[`kps_${s}`];
    if (
      !cls ||
      !obj ||
      !bbox ||
      !kps ||
      cls.length !== rows * cols ||
      obj.length !== rows * cols ||
      bbox.length !== rows * cols * 4 ||
      kps.length !== rows * cols * 10
    ) {
      throw new Error(`YuNet stride ${s}: unexpected output shape`);
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const score = Math.sqrt(clamp01(cls[i]) * clamp01(obj[i]));
        if (score < scoreMin) continue;
        const cx = (c + bbox[i * 4]) * s;
        const cy = (r + bbox[i * 4 + 1]) * s;
        const w = Math.exp(bbox[i * 4 + 2]) * s;
        const h = Math.exp(bbox[i * 4 + 3]) * s;
        const landmarks: Point[] = [];
        for (let n = 0; n < 5; n++)
          landmarks.push([(kps[i * 10 + 2 * n] + c) * s, (kps[i * 10 + 2 * n + 1] + r) * s]);
        faces.push({ score, box: [cx - w / 2, cy - h / 2, w, h], landmarks });
      }
    }
  }
  faces.sort((a, b) => b.score - a.score);
  const keep: Face[] = [];
  for (const f of faces) if (keep.every((k) => iou(k.box, f.box) <= nmsIou)) keep.push(f);
  return keep;
}

/** Detector-image coords → original coords, pixel-centre convention (deviation 3). */
export function toOriginal(face: Face, sx: number, sy: number): Face {
  const X = (x: number) => (x + 0.5) * sx - 0.5;
  const Y = (y: number) => (y + 0.5) * sy - 0.5;
  const [x, y, w, h] = face.box;
  return {
    score: face.score,
    box: [X(x), Y(y), w * sx, h * sy],
    landmarks: face.landmarks.map(([px, py]) => [X(px), Y(py)] as const),
  };
}

/**
 * Least-squares similarity (rotation, uniform scale, translation; no reflection) mapping the
 * 5 landmarks onto TEMPLATE — deviation 4. The 2-D closed form equals Umeyama with the
 * det-sign correction, which is what FaceRecognizerSF::getSimilarityTransformMatrix computes
 * through an SVD. Row-major 2×3: dst = [[m0,m1],[m3,m4]]·src + [m2,m5].
 */
export function similarityTransform(
  src: readonly Point[],
  dst: readonly Point[] = TEMPLATE,
): [number, number, number, number, number, number] {
  let sx = 0;
  let sy = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < 5; i++) {
    sx += src[i][0];
    sy += src[i][1];
    dx += dst[i][0];
    dy += dst[i][1];
  }
  sx /= 5;
  sy /= 5;
  dx /= 5;
  dy /= 5;
  let a = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < 5; i++) {
    const px = src[i][0] - sx;
    const py = src[i][1] - sy;
    const qx = dst[i][0] - dx;
    const qy = dst[i][1] - dy;
    a += px * qx + py * qy;
    b += px * qy - py * qx;
    n += px * px + py * py;
  }
  a /= n;
  b /= n;
  return [a, -b, dx - (a * sx - b * sy), b, a, dy - (b * sx + a * sy)];
}

/**
 * cv2.warpAffine(src, M, (size,size), INTER_LINEAR, BORDER_CONSTANT 0) on RGB HWC uint8. The
 * crop is uint8 like OpenCV's aligned Mat — rounded and clamped before packing (deviation 4).
 */
export function warpAffine(
  rgb: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  M: readonly number[],
  size = CROP,
): Uint8ClampedArray {
  const det = M[0] * M[4] - M[1] * M[3];
  const a = M[4] / det;
  const b = -M[1] / det;
  const d = -M[3] / det;
  const e = M[0] / det;
  const c = -(a * M[2] + b * M[5]);
  const f = -(d * M[2] + e * M[5]);
  const at = (x: number, y: number, ch: number) =>
    x >= 0 && y >= 0 && x < width && y < height ? rgb[(y * width + x) * 3 + ch] : 0;
  const out = new Uint8ClampedArray(size * size * 3);
  for (let v = 0, o = 0; v < size; v++) {
    for (let u = 0; u < size; u++, o += 3) {
      const x = a * u + b * v + c;
      const y = d * u + e * v + f;
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const fx = x - x0;
      const fy = y - y0;
      for (let ch = 0; ch < 3; ch++) {
        const top = at(x0, y0, ch) * (1 - fx) + at(x0 + 1, y0, ch) * fx;
        const bot = at(x0, y0 + 1, ch) * (1 - fx) + at(x0 + 1, y0 + 1, ch) * fx;
        out[o + ch] = top * (1 - fy) + bot * fy;
      }
    }
  }
  return out;
}

/** 112×112 RGB HWC uint8 → NCHW float32 [1,3,112,112], RGB planes, 0..255 (blobFromImage swapRB). */
export function packRecognizerInput(crop: Uint8Array | Uint8ClampedArray, size = CROP): Float32Array {
  const plane = size * size;
  const t = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    t[i] = crop[i * 3];
    t[plane + i] = crop[i * 3 + 1];
    t[2 * plane + i] = crop[i * 3 + 2];
  }
  return t;
}

export function l2normalize(v: ArrayLike<number>): number[] {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const n = Math.sqrt(s) || 1;
  return Array.from(v, (x) => x / n);
}

/** Cosine of two L2-normalised vectors. */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
