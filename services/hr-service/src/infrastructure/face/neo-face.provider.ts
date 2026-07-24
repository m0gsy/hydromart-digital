import { randomUUID } from 'node:crypto';

import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { HrConfigService } from '../../config/hr-config.service';
import {
  FaceEmbeddingResult,
  FaceIdentity,
  FaceVerifier,
  FaceVerifyResult,
} from '../../application/ports/face-verifier.port';

interface NeoResponse {
  status?: string | number;
  status_message?: string;
  similarity?: string | number;
  verified?: boolean | string;
}

/**
 * Production face engine via BiznetGio NEO Face Recognition (RisetAI), a managed cloud
 * gallery — no local model, no onnxruntime-node/sharp, no InsightFace license risk.
 *
 * Faces live in ONE global gallery (NEO_FR_GALLERY_ID) keyed by `user_id` = Employee.id.
 * Enroll uploads one aligned frame with `force_register` so re-enroll overwrites cleanly.
 * Check-in is 1:1 `verify-face` (the PWA already knows the logged-in employee) — cheaper
 * and safer than kiosk 1:N identify. Passive liveness stays a CLIENT gate (assertFace);
 * NEO's own `verified`/`similarity` decide the match.
 *
 * OPS: set FACE_VERIFIER_DRIVER=neo + NEO_FR_TOKEN (+ optional NEO_FR_ENDPOINT/GALLERY_ID).
 * Dev/CI stay on FACE_VERIFIER_DRIVER=stub and never touch the network.
 */
@Injectable()
export class NeoFaceProvider implements FaceVerifier {
  private galleryReady: Promise<void> | null = null;

  constructor(private readonly config: HrConfigService) {}

  async enroll(images: Buffer[], identity?: FaceIdentity): Promise<FaceEmbeddingResult> {
    if (images.length === 0) throw new Error('enroll: no frames');
    const id = this.requireIdentity(identity);
    await this.ensureGallery();
    // One representative frame is enough for robust 1:1 verify and saves quota.
    // ponytail: single-template enroll; add multi-frame if verify FAR proves too high.
    await this.call('POST', 'enroll-face', {
      facegallery_id: this.gallery,
      user_id: id.userId,
      user_name: id.userName,
      force_register: 'true',
      image: toBase64(images[0]),
    });
    return { vector: [], quality: 1 };
  }

  async verify(
    image: Buffer,
    _enrolled: number[][],
    live: boolean,
    identity?: FaceIdentity,
  ): Promise<FaceVerifyResult> {
    const id = this.requireIdentity(identity);
    const res = await this.call('POST', 'verify-face', {
      facegallery_id: this.gallery,
      user_id: id.userId,
      image: toBase64(image),
    });
    return { score: normalizeSimilarity(res.similarity), matched: isTruthy(res.verified), live };
  }

  private get gallery(): string {
    return this.config.neoFr.galleryId;
  }

  private requireIdentity(identity?: FaceIdentity): FaceIdentity {
    if (!identity?.userId) {
      throw new ServiceUnavailableException('NEO face: identitas karyawan tidak tersedia');
    }
    return identity;
  }

  /** Create the shared gallery once per process; a pre-existing gallery is not an error. */
  private ensureGallery(): Promise<void> {
    if (!this.galleryReady) {
      this.galleryReady = this.call('POST', 'create-facegallery', { facegallery_id: this.gallery })
        .then(() => undefined)
        .catch((err: unknown) => {
          // Already-exists is fine; anything else should retry on the next enroll.
          if (!String(err).toLowerCase().includes('exist')) this.galleryReady = null;
        });
    }
    return this.galleryReady;
  }

  private async call(method: string, path: string, body: Record<string, unknown>): Promise<NeoResponse> {
    const { endpoint, token } = this.config.neoFr;
    if (!token) throw this.unavailable('NEO_FR_TOKEN belum diset');
    let res: Response;
    try {
      res = await fetch(`${endpoint}/risetai/face-api/facegallery/${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Accesstoken: token },
        body: JSON.stringify({ ...body, trx_id: randomUUID() }),
      });
    } catch (err) {
      throw this.unavailable(`tidak bisa menghubungi NEO (${path}): ${String(err)}`);
    }
    const json = (await res.json().catch(() => ({}))) as NeoResponse;
    // NEO returns HTTP 200 with a status field; enroll/verify failures use a non-"200" status.
    const ok = res.ok && String(json.status ?? '200').startsWith('2');
    if (!ok) throw this.unavailable(`${path}: ${json.status_message ?? `HTTP ${res.status}`}`);
    return json;
  }

  private unavailable(reason: string): ServiceUnavailableException {
    return new ServiceUnavailableException(`Face engine (NEO) gagal: ${reason}`);
  }
}

/** NEO wants a bare base64 JPEG/PNG — strip any data-URL prefix. */
function toBase64(buf: Buffer): string {
  return buf.toString('base64');
}

/** NEO `similarity` is a percentage (0..100); expose it as a 0..1 score like the local drivers. */
function normalizeSimilarity(value: string | number | undefined): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return n > 1 ? n / 100 : n;
}

function isTruthy(v: boolean | string | undefined): boolean {
  return v === true || v === 'true';
}
