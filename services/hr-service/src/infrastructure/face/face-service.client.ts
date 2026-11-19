import {
  LOCAL_TEMPLATE_DIM,
  type LocalEmbedding,
  LocalBadImageError,
  LocalEngineUnavailableError,
  type LocalFaceEngine,
  LocalNoFaceError,
} from '../../application/ports/local-face-engine.port';

/**
 * hr-service's side of face-service: `POST /api/v1/internal/embed` with the raw JPEG and the
 * service key. Every failure is one of three errors (see the port): no face, a bad image, or
 * no answer. Face plan §4.4: hr's deadline is 3 s.
 */
export class FaceServiceClient implements LocalFaceEngine {
  constructor(
    private readonly target: { url: string; internalKey: string },
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 3000,
  ) {}

  async embed(jpeg: Buffer): Promise<LocalEmbedding> {
    if (!this.target.url) throw new LocalEngineUnavailableError('FACE_SERVICE_URL is not set');
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.target.url.replace(/\/+$/, '')}/api/v1/internal/embed`, {
        method: 'POST',
        headers: { 'content-type': 'image/jpeg', 'x-internal-key': this.target.internalKey },
        body: jpeg,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new LocalEngineUnavailableError(`face-service unreachable: ${String(err)}`);
    }
    const body = (await res.json().catch(() => null)) as {
      vector?: unknown;
      detScore?: unknown;
      code?: unknown;
    } | null;
    if (res.ok) {
      if (
        !Array.isArray(body?.vector) ||
        body.vector.length !== LOCAL_TEMPLATE_DIM ||
        !body.vector.every((x) => typeof x === 'number' && Number.isFinite(x)) ||
        typeof body.detScore !== 'number'
      ) {
        throw new LocalEngineUnavailableError('face-service answered an unexpected shape');
      }
      return { vector: body.vector as number[], detScore: body.detScore };
    }
    const code = typeof body?.code === 'string' ? body.code : '';
    if (res.status === 422 && code === 'NO_FACE') throw new LocalNoFaceError('no face');
    const said = `face-service ${res.status}${code ? ` ${code}` : ''}`;
    // 400 / 413 / 422: the bytes were the problem (unreadable, too small, too large) — not the
    // engine. 401 stays "no answer": a wrong service key is a misconfiguration, not a photo.
    if (res.status === 400 || res.status === 413 || res.status === 422) {
      throw new LocalBadImageError(said);
    }
    throw new LocalEngineUnavailableError(said);
  }
}
