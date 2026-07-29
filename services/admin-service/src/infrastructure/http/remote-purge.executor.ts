import { Logger } from '@nestjs/common';

import { PurgeExecutor } from '../../application/ports/purge-executor.port';

/**
 * A dataset that lives in another service. admin-service holds the policy; the service
 * that owns the rows does the deleting, over the shared INTERNAL_SERVICE_KEY.
 *
 * Raises rather than returning 0 on failure: a purge that quietly reports "0 deleted"
 * when the call never landed is indistinguishable from "nothing was due", and that is
 * exactly the confusion this whole feature exists to remove.
 */
export class RemotePurgeExecutor implements PurgeExecutor {
  private static readonly TIMEOUT_MS = 30_000;
  private readonly logger = new Logger(RemotePurgeExecutor.name);

  constructor(
    readonly dataset: string,
    private readonly baseUrl: string,
    private readonly path: string,
    private readonly internalKey: string,
  ) {}

  /** False when this environment cannot reach the owner — registry drops it, and the
   * dataset is then reported as UNENFORCED rather than silently succeeding. */
  get configured(): boolean {
    return Boolean(this.baseUrl && this.internalKey);
  }

  async purge(cutoff: Date): Promise<number> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RemotePurgeExecutor.TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${this.path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': this.internalKey },
        body: JSON.stringify({ cutoff: cutoff.toISOString() }),
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
    const body = (await response.json()) as { deleted?: number };
    const deleted = typeof body.deleted === 'number' ? body.deleted : 0;
    this.logger.log(`Purged ${deleted} rows from ${this.dataset}`);
    return deleted;
  }
}
