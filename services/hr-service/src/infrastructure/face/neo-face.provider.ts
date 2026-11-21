import { randomUUID } from 'node:crypto';
import * as http from 'node:http';
import * as https from 'node:https';

import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { alertServerError } from '@hydromart/platform';

import { HrConfigService } from '../../config/hr-config.service';
import {
  FaceEmbeddingResult,
  FaceEngineUnavailableError,
  FaceIdentity,
  FaceNotEnrolledError,
  FaceReplaceFailedError,
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
/**
 * Unanswered calls in a row before NEO counts as down. One slow or oversized frame times out on
 * its own; it must not hold every other punch for a minute. The spent quota (or a refused token)
 * is account-wide and no frame can cause it, so that counts at once.
 */
const NEO_DOWN_AFTER = 3;
/**
 * How often ops hear that NEO holds no face for someone it should. Each one is an employee who
 * has to enrol again and a punch HR has to rule on; many at once means NEO lost its gallery.
 */
const UNKNOWN_NOTICE_MS = 60 * 60_000;

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
   * The one place that knows NEO's state, so it is also the one that tells ops: once when it goes
   * down, a log line when it answers again.
   */
  private downUntil = 0;
  /** Gallery calls in a row that got no answer (see NEO_DOWN_AFTER). */
  private unanswered = 0;
  /** When ops were last told NEO holds no face for someone, and how many since. */
  private unknownNoticeAt = 0;
  private unknownSince = 0;

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
    try {
      await this.call('POST', 'enroll-face', body);
    } catch (err) {
      // The old face is gone and the new one did not take: NEO holds none for them now, and an
      // enrolment HR kept would fail every punch with "UserID Not Found" (2026-11-21).
      throw new FaceReplaceFailedError(err);
    }
    return { vector: [], quality: 1 };
  }

  /**
   * Every user_id the shared gallery holds (owner decision 2026-11-21: the daily upkeep checks it
   * against HR's enrolments). `list-faces` is a GET carrying a JSON body, which fetch refuses to
   * send, so it goes over node's own client. Not breaker-counted: one call a day, by a sweep.
   */
  async listEnrolled(): Promise<string[]> {
    const { token, endpoint } = this.config.neoFr;
    if (!token) throw this.unavailable('NEO_FR_TOKEN belum diset');
    let reply: { status: number; body: string };
    try {
      reply = await getWithJsonBody(
        `${endpoint}/risetai/face-api/facegallery/list-faces`,
        { Accesstoken: token },
        { facegallery_id: this.gallery, trx_id: randomUUID() },
      );
    } catch (err) {
      throw this.engineDown(`list-faces: tidak bisa menghubungi NEO: ${String(err)}`);
    }
    const parsed = parseJson(reply.body) as {
      risetai?: NeoPayload & { faces?: { user_id?: unknown }[] };
    } | null;
    if (!parsed?.risetai) {
      throw this.engineDown(`list-faces: jawaban NEO tidak terbaca (HTTP ${reply.status})`);
    }
    this.ensureOk('list-faces', parsed.risetai);
    return (parsed.risetai.faces ?? [])
      .map((f) => f.user_id)
      .filter((id): id is string => typeof id === 'string' && id !== '');
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
    // Its gallery has no such user: an answer about the enrolment, not the engine (2026-11-21).
    if (isUnknownUser(res)) throw this.unknownUser(id.userId);
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
    this.ensureOk('liveness', payload);
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
      // No answer at all — a timeout, a dropped connection, a host that does not resolve, a
      // certificate that does not verify — is NEO unreachable. The alert names the cause, so a
      // mistyped NEO_FR_ENDPOINT still reaches ops, without losing anyone's day meanwhile.
      const code = String((err as { cause?: { code?: unknown } }).cause?.code ?? '');
      throw this.down(`tidak bisa menghubungi NEO (${label}${code ? `, ${code}` : ''}): ${String(err)}`, breaker);
    }
    // NEO always answers HTTP 200 and wraps the real verdict under `risetai` ("200" = ok), so a
    // 5xx (or a 429 rate limit) at the HTTP level is its gateway refusing: the engine is down.
    if (res.status >= 500 || res.status === 429) {
      throw this.down(`${label}: HTTP ${res.status}`, breaker);
    }
    // The gateway refusing the token outright is an account refusal like the in-band one below.
    if (res.status === 401 || res.status === 403) {
      throw this.down(`${label}: HTTP ${res.status}`, breaker, true);
    }
    // No `risetai` envelope at all (an HTML maintenance page, a body that is not JSON) is not an
    // answer either: counting it as one would end a real outage and refuse the punch with a 503.
    const parsed = (await res.json().catch(() => undefined)) as NeoResponse | null | undefined;
    if (!parsed?.risetai) {
      // What it did say, cut short: 2026-11-20 it answered HTTP 400 to create-facegallery and
      // enroll-face, and with nothing of the body in the alert there was no telling why.
      const said = parsed === undefined ? 'bukan JSON' : JSON.stringify(parsed).slice(0, 120);
      throw this.down(`${label}: jawaban NEO tidak terbaca (HTTP ${res.status}, ${said})`, breaker);
    }
    const payload = parsed.risetai;
    // NEO refusing the ACCOUNT arrives as HTTP 200 with an in-band 401/403 — the spent quota
    // (2026-11-18: "Not authorized: max api hit limit reached!") or a token it no longer takes.
    // That is NEO saying it will not be asked, not an answer: read it BEFORE counting the call as
    // answered, or each probe of a spent quota would log a recovery and alert all over again.
    // No frame can cause it, so it counts at once, whatever the wording.
    if (isAccountRefusal(payload)) {
      throw this.down(`${label}: ${payload.status_message ?? `status ${String(payload.status)}`}`, breaker, true);
    }
    if (breaker) this.answered();
    return payload;
  }

  private ensureOk(path: string, payload: NeoPayload): void {
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
    // (An account refusal never gets here: `post` already threw it as NEO being down.) Anything
    // else is a plain 503 that pages: a request of ours it refused, or an in-band "500" that may
    // be one frame it choked on — letting that count as down would let one image hold everyone.
    throw this.unavailable(`${path}: ${message}`);
  }

  /**
   * NEO answered that it holds no face for this employee. Not an outage, so no fail-fast minute;
   * but ops hear of it, at most once an hour with the count since: each is an employee who must
   * enrol again, and many at once is NEO having lost its gallery.
   */
  private unknownUser(userId: string): FaceNotEnrolledError {
    this.unknownSince += 1;
    if (Date.now() - this.unknownNoticeAt >= UNKNOWN_NOTICE_MS) {
      alertServerError({
        method: 'POST',
        path: '/api/v1/attendance (face engine NEO: wajah hilang)',
        status: 404,
        exception: new Error(
          `NEO holds no face for ${this.unknownSince} punch(es) since the last notice (latest: employee ${userId}). ` +
            'Held PENDING for HR; a live punch retires the enrolment so the employee enrols again. ' +
            'Many at once means NEO lost its gallery.',
        ),
      });
      this.unknownNoticeAt = Date.now();
      this.unknownSince = 0;
    }
    return new FaceNotEnrolledError();
  }

  private unavailable(reason: string): ServiceUnavailableException {
    return new ServiceUnavailableException(`Face engine (NEO) gagal: ${reason}`);
  }

  private engineDown(reason: string): FaceEngineUnavailableError {
    return new FaceEngineUnavailableError(`Face engine (NEO) gagal: ${reason}`);
  }

  /**
   * A gallery call got no usable answer. NEO counts as down after NEO_DOWN_AFTER of them in a row,
   * or at once for an account refusal (`now`): the fail-fast minute starts, and the first time it
   * does ops get ONE message. A liveness call (`breaker` false) only reports it.
   */
  private down(reason: string, breaker: boolean, now = false): FaceEngineUnavailableError {
    if (!breaker) return this.engineDown(reason);
    this.unanswered += 1;
    if (now || this.unanswered >= NEO_DOWN_AFTER) {
      const wasUp = this.downUntil === 0;
      this.downUntil = Date.now() + NEO_RETRY_MS;
      if (wasUp) {
        alertServerError({
          method: 'POST',
          path: '/api/v1/attendance (face engine NEO)',
          status: 503,
          exception: new Error(
            `NEO unavailable: punches are held PENDING for HR and enroll is refused until it answers. ${reason}`,
          ),
        });
      }
    }
    return this.engineDown(reason);
  }

  /** NEO answered (whatever it said): the outage, if any, is over. */
  private answered(): void {
    this.unanswered = 0;
    if (this.downUntil === 0) return;
    this.downUntil = 0;
    this.logger.log('NEO answering again; punches are verified as usual');
  }
}

/**
 * NEO refusing the ACCOUNT rather than this request: an in-band 401/403 (status list: "Accestoken
 * not authorized", "Requested resource denied") or the quota wording, whatever the status.
 */
function isAccountRefusal(payload: NeoPayload): boolean {
  const code = Number(payload.status);
  return (
    code === 401 || code === 403 || /hit\s+limit|limit\s+reached|quota/i.test(payload.status_message ?? '')
  );
}

/** NEO's refusal when the `user_id` is already in the gallery. */
function isDuplicateUser(payload: NeoPayload): boolean {
  return (
    !String(payload.status ?? '').startsWith('2') &&
    /already\s+exist/i.test(payload.status_message ?? '')
  );
}

/** NEO's answer when its gallery holds no such `user_id` ("Database Error - UserID Not Found"). */
function isUnknownUser(payload: NeoPayload): boolean {
  return (
    Number(payload.status) === 416 ||
    /user\s*_?id\s+(not\s+found|does\s+not\s+exist)/i.test(payload.status_message ?? '')
  );
}

/** NEO's answer to deleting a `user_id` that is not in the gallery — which is the goal reached. */
function isMissingUser(payload: NeoPayload): boolean {
  return /(not\s+found|not\s+exist|does\s+not\s+exist|no\s+such)/i.test(
    payload.status_message ?? '',
  );
}

/** JSON, or null for a body that is not (an HTML error page, a truncated reply). */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** A GET with a JSON body (NEO's list routes), over node's own client; 20 s like a slow NEO. */
function getWithJsonBody(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<{ status: number; body: string }> {
  const target = new URL(url);
  const data = JSON.stringify(body);
  const client = target.protocol === 'http:' ? http : https;
  return new Promise((resolve, reject) => {
    const req = client.request(
      target,
      {
        method: 'GET',
        headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        timeout: 20_000,
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (text += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(data);
  });
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
