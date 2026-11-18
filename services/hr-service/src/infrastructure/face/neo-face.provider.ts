import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { HrConfigService } from '../../config/hr-config.service';
import {
  FaceEmbeddingResult,
  FaceEngineUnavailableError,
  FaceIdentity,
  FaceVerifier,
  FaceVerifyResult,
} from '../../application/ports/face-verifier.port';

/**
 * NEO statuses a bad FRAME causes (documented list): 412 face not detected, 413 face too small,
 * 451 image is null, 490-495 image cannot be decoded / type not recognised. The employee
 * retakes the photo; it is not the engine being down, and it must not be able to look like it.
 */
const FRAME_STATUSES = new Set([412, 413, 451, 490, 491, 492, 493, 494, 495]);

/** How long NEO counts as down after it proved so, before one call probes it again. */
const NEO_RETRY_MS = 60_000;

interface NeoPayload {
  status?: string | number;
  status_message?: string;
  similarity?: string | number;
  verified?: boolean | string;
}
/** The liveness route's extra fields (RisetAI `verify-face-liveness`). */
interface NeoLivenessPayload extends NeoPayload {
  match_status?: { is_real?: boolean | string };
  results?: { is_spoof?: boolean | string };
}
// NEO wraps every response body under a `risetai` key.
interface NeoResponse {
  risetai?: NeoPayload;
}

/**
 * Production face engine via BiznetGio NEO Face Recognition (RisetAI), a managed cloud
 * gallery — no local model, no onnxruntime-node/sharp, no InsightFace license risk.
 *
 * Faces live in ONE global gallery (NEO_FR_GALLERY_ID) keyed by `user_id` = Employee.id.
 * Enroll uploads one aligned frame with `force_register` so re-enroll overwrites cleanly.
 * Check-in is 1:1 `verify-face` (the PWA already knows the logged-in employee) — cheaper
 * and safer than kiosk 1:N identify. NEO's own `verified`/`similarity` decide the match —
 * and are the only control: the client's liveness challenge is a capture-quality gate the
 * server no longer trusts (B-7).
 *
 * OPS: set FACE_VERIFIER_DRIVER=neo + NEO_FR_TOKEN (+ optional NEO_FR_ENDPOINT/GALLERY_ID).
 * Dev/CI stay on FACE_VERIFIER_DRIVER=stub and never touch the network.
 */
@Injectable()
export class NeoFaceProvider implements FaceVerifier {
  private readonly logger = new Logger(NeoFaceProvider.name);
  private galleryReady: Promise<void> | null = null;
  /**
   * Until when NEO counts as down. While it does, every call fails at once instead of each one
   * waiting out a dead provider (15 s) or spending a spent quota again; one call a minute probes.
   */
  private downUntil = 0;

  constructor(private readonly config: HrConfigService) {}

  async enroll(images: Buffer[], identity?: FaceIdentity): Promise<FaceEmbeddingResult> {
    if (images.length === 0) throw new Error('enroll: no frames');
    const id = this.requireIdentity(identity);
    await this.ensureGallery();
    // One representative frame is enough for robust 1:1 verify and saves quota.
    // ponytail: single-template enroll; add multi-frame if verify FAR proves too high.
    const body = {
      facegallery_id: this.gallery,
      user_id: id.userId,
      user_name: id.userName,
      force_register: true, // NEO wants a JSON bool, not a string
      image: toBase64(images[0]),
    };
    const first = await this.request('POST', 'enroll-face', body);
    if (!isDuplicateUser(first)) {
      this.ensureOk('enroll-face', first);
      return { vector: [], quality: 1 };
    }
    // Seen in production 2026-10-20: `force_register` does NOT replace an existing user —
    // NEO answers "Database Error - UserID Already Exists" and every re-enroll by an employee
    // who already had a face failed, for good. Replacing means deleting first. Once: if the
    // retry fails too, that is the answer, not another round.
    await this.remove(id);
    await this.call('POST', 'enroll-face', body);
    return { vector: [], quality: 1 };
  }

  /** Delete one employee's face from the shared gallery. Gone-already counts as deleted. */
  async remove(identity: FaceIdentity): Promise<void> {
    const id = this.requireIdentity(identity);
    // DELETE, not POST: checked against the live gateway 2026-10-20 — POST answers
    // `405 method not allowed`, DELETE answers `416 UserID Not Found` for an unknown user.
    const res = await this.request('DELETE', 'delete-face', {
      facegallery_id: this.gallery,
      user_id: id.userId,
    });
    if (String(res.status ?? '').startsWith('2') || isMissingUser(res)) return;
    throw this.unavailable(`delete-face: ${res.status_message ?? 'unknown error'}`);
  }

  async verify(
    image: Buffer,
    _enrolled: number[][],
    identity?: FaceIdentity,
  ): Promise<FaceVerifyResult> {
    const id = this.requireIdentity(identity);
    // A genuine non-match comes back with a non-2xx status ("411 Face Not Verified") plus
    // `verified:false` — a valid business result, NOT a transport error. Tolerate any
    // response that carries a `verified` verdict; only a missing verdict is a real failure.
    const res = await this.request('POST', 'verify-face', {
      facegallery_id: this.gallery,
      user_id: id.userId,
      image: toBase64(image),
    });
    if (res.verified === undefined) this.ensureOk('verify-face', res);
    const result: FaceVerifyResult = {
      score: normalizeSimilarity(res.similarity),
      matched: isTruthy(res.verified),
    };
    // Only worth a second call when the face already matched: a non-match is refused anyway.
    const mode = this.config.neoLiveness.mode;
    if (result.matched && mode === 'enforce') {
      // A liveness call that cannot be asked throws like any other engine-down call: attendance
      // then holds the punch for HR with no score — the owner's rule for NEO being down
      // (2026-11-18) — rather than accept it on the match alone.
      result.live = await this.checkLiveness(image, id.userId);
    } else if (result.matched && mode === 'shadow') {
      // Observe only: record what the provider says and never let it change the outcome.
      try {
        const live = await this.checkLiveness(image, id.userId);
        this.logger.log(`liveness shadow user=${id.userId} live=${live} score=${result.score}`);
      } catch (err) {
        this.logger.warn(`liveness shadow failed user=${id.userId}: ${String(err)}`);
      }
    }
    return result;
  }

  /**
   * Passive liveness from the SAME frame the match used. Real means the provider says
   * `is_real` and does not say `is_spoof`; anything it does not say is not real. A call that
   * cannot be made throws `FaceEngineUnavailableError`, never a verdict — see
   * `HrConfigService.neoLiveness`; attendance holds such a punch for HR.
   */
  private async checkLiveness(image: Buffer, userId: string): Promise<boolean> {
    // Its own API path: a liveness failure says nothing about the gallery the match uses, so it
    // neither trips nor clears the fail-fast minute (review #927).
    const payload = (await this.post(
      `${this.config.neoFr.endpoint}${this.config.neoLiveness.path}`,
      'POST',
      'liveness',
      {
        facegallery_id: this.gallery,
        user_id: userId,
        image: toBase64(image),
        face_parameters: { spoof_detection: true },
      },
      false,
    )) as NeoLivenessPayload;
    this.ensureOk('liveness', payload, false);
    if (isTruthy(payload.results?.is_spoof)) return false;
    return isTruthy(payload.match_status?.is_real);
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

  /** A NEO call that must succeed (create/enroll): unwraps the body and throws on a non-2xx status. */
  private async call(
    method: string,
    path: string,
    body: Record<string, unknown>,
  ): Promise<NeoPayload> {
    const payload = await this.request(method, path, body);
    this.ensureOk(path, payload);
    return payload;
  }

  /** Raw NEO gallery call: fetch + unwrap the `risetai` envelope. Does NOT throw on a business status. */
  private request(
    method: string,
    path: string,
    body: Record<string, unknown>,
  ): Promise<NeoPayload> {
    return this.post(
      `${this.config.neoFr.endpoint}/risetai/face-api/facegallery/${path}`,
      method,
      path,
      body,
    );
  }

  /** One authenticated NEO request. `label` names the call in errors (a path, or 'liveness'). */
  private async post(
    url: string,
    method: string,
    label: string,
    body: Record<string, unknown>,
    breaker = true,
  ): Promise<NeoPayload> {
    const { token } = this.config.neoFr;
    if (!token) throw this.unavailable('NEO_FR_TOKEN belum diset');
    if (breaker && this.downUntil !== 0) {
      if (Date.now() < this.downUntil) {
        throw this.engineDown(`${label}: NEO sedang tidak tersedia, dicoba lagi sebentar lagi`);
      }
      // The minute is up and THIS call is the probe: every other one keeps failing fast until
      // it answers (or fails, which starts the minute again) instead of all queueing on NEO.
      this.downUntil = Date.now() + NEO_RETRY_MS;
    }
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Accesstoken: token },
        body: JSON.stringify({ ...body, trx_id: randomUUID() }),
        // The provider is third-party and takes images: bounded, so a hang is `unavailable`.
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      // A host that does not exist is OUR configuration (a mistyped NEO_FR_ENDPOINT): it pages.
      // A timeout, a dropped connection or a certificate NEO let lapse is NEO being down.
      const code = String((err as { cause?: { code?: unknown } }).cause?.code ?? '');
      if (code === 'ENOTFOUND') {
        throw this.unavailable(`NEO tidak bisa dihubungi (${label}, ${code}): periksa NEO_FR_ENDPOINT`);
      }
      throw this.down(`tidak bisa menghubungi NEO (${label}): ${String(err)}`, breaker);
    }
    // NEO always answers HTTP 200 and wraps the real verdict under `risetai` ("200" = ok), so a
    // 5xx (or a 429 rate limit) at the HTTP level is its gateway refusing: the engine is down.
    if (res.status >= 500 || res.status === 429) {
      throw this.down(`${label}: HTTP ${res.status}`, breaker);
    }
    if (breaker) this.downUntil = 0; // it answered; what it said is for the caller to judge
    return ((await res.json().catch(() => ({}))) as NeoResponse).risetai ?? {};
  }

  private ensureOk(path: string, payload: NeoPayload, breaker = true): void {
    if (String(payload.status ?? '').startsWith('2')) return;
    const message = payload.status_message ?? 'unknown error';
    const code = Number(payload.status);
    // Seen in production 2026-11-08: "Procedural Error - Face Not Detected" (blurry/no-face
    // frame) was a 503, which paged Discord for what is the employee's retake, not an outage.
    // Every status a bad frame causes is the same retake.
    if (FRAME_STATUSES.has(code) || /face\s+not\s+detected|image\s+clarity/i.test(message)) {
      throw new BadRequestException(
        'Wajah tidak terdeteksi, pastikan wajah terlihat jelas dan pencahayaan cukup',
      );
    }
    // The spent quota (2026-11-18: "Not authorized: max api hit limit reached!") means the engine
    // cannot be asked. Anything else NEO says is a plain 503 that pages: a bad token or a request
    // of ours it refused is a misconfiguration, and its in-band "500" may be one frame it choked
    // on — letting that count as "down" would let one bad image hold everyone's punch for HR.
    if (/hit\s+limit|limit\s+reached|quota/i.test(message)) {
      throw this.down(`${path}: ${message}`, breaker);
    }
    throw this.unavailable(`${path}: ${message}`);
  }

  private unavailable(reason: string): ServiceUnavailableException {
    return new ServiceUnavailableException(`Face engine (NEO) gagal: ${reason}`);
  }

  private engineDown(reason: string): FaceEngineUnavailableError {
    return new FaceEngineUnavailableError(`Face engine (NEO) gagal: ${reason}`);
  }

  /**
   * The engine just proved down. A gallery call starts the fail-fast minute, after which one call
   * probes; a liveness call (`breaker` false) reports down without touching the minute.
   */
  private down(reason: string, breaker: boolean): FaceEngineUnavailableError {
    if (breaker) this.downUntil = Date.now() + NEO_RETRY_MS;
    return this.engineDown(reason);
  }
}

/** NEO's refusal when the `user_id` is already in the gallery. */
function isDuplicateUser(payload: NeoPayload): boolean {
  return (
    !String(payload.status ?? '').startsWith('2') &&
    /already\s+exist/i.test(payload.status_message ?? '')
  );
}

/** NEO's answer to deleting a `user_id` that is not in the gallery — which is the goal reached. */
function isMissingUser(payload: NeoPayload): boolean {
  return /(not\s+found|not\s+exist|does\s+not\s+exist|no\s+such)/i.test(
    payload.status_message ?? '',
  );
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
