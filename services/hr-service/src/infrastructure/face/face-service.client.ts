/** face-service could not give an answer: not configured, down, busy, too slow, or odd. */
export class LocalEngineUnavailableError extends Error {}

/** face-service looked and found no face (its 422 NO_FACE). */
export class LocalNoFaceError extends Error {}

export interface LocalEmbedding {
  /** Unit-length 128-d SFace embedding. */
  vector: number[];
  detScore: number;
}

/** The dimension of a local (SFace) template — what tells it apart from a legacy 512-d one. */
export const LOCAL_TEMPLATE_DIM = 128;

/**
 * hr-service's side of face-service: `POST /api/v1/internal/embed` with the raw JPEG and the
 * service key. Every failure is one of two errors, so a caller decides on two cases, not on
 * transport details: no face, or no answer. Face plan §4.4: hr's deadline is 3 s.
 */
export class FaceServiceClient {
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
    if (res.status === 422 && body?.code === 'NO_FACE') throw new LocalNoFaceError('no face');
    throw new LocalEngineUnavailableError(
      `face-service ${res.status}${typeof body?.code === 'string' ? ` ${body.code}` : ''}`,
    );
  }
}
