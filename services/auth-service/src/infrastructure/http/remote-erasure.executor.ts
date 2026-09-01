import { Logger } from '@nestjs/common';

import {
  ErasureExecutor,
  ErasureSubject,
} from '../../application/ports/erasure-executor.port';

/**
 * A person's data that lives in another service. auth-service owns the request; the
 * service that owns the rows does the scrubbing, over the shared INTERNAL_SERVICE_KEY.
 *
 * Mirrors `RemotePurgeExecutor` in admin-service on purpose, down to raising rather than
 * returning 0: an erasure that quietly reports "nothing changed" when the call never
 * landed is indistinguishable from "there was nothing to change", and that confusion is
 * the whole reason this registry exists.
 */
export class RemoteErasureExecutor implements ErasureExecutor {
  /**
   * Thirty seconds. Shorter than the retention sweep's five minutes because this runs
   * inside a staff member's click on the PDP queue, not a nightly job — and every owner
   * here scrubs one person's rows, not a year of a table.
   */
  private static readonly TIMEOUT_MS = 30_000;
  private readonly logger = new Logger(RemoteErasureExecutor.name);

  constructor(
    readonly dataset: string,
    private readonly baseUrl: string,
    private readonly path: string,
    private readonly internalKey: string,
  ) {}

  get configured(): boolean {
    return Boolean(this.baseUrl && this.internalKey);
  }

  async erase(subject: ErasureSubject): Promise<number | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RemoteErasureExecutor.TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${this.path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': this.internalKey },
        body: JSON.stringify(subject),
        signal: controller.signal,
      });
    } catch (error) {
      throw new Error(`${this.dataset}: owner unreachable (${(error as Error).message})`);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`${this.dataset}: owner responded ${response.status}`);
    }
    const body = (await response.json().catch(() => ({}))) as { erased?: number };
    const rows = typeof body.erased === 'number' ? body.erased : null;
    this.logger.log(`${this.dataset}: erased ${rows ?? '?'} row(s)`);
    return rows;
  }
}
