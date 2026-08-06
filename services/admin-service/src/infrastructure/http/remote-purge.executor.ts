import { Logger } from '@nestjs/common';

import { PurgeExecutor, PurgeMode } from '../../application/ports/purge-executor.port';

/**
 * A dataset that lives in another service. admin-service holds the policy; the service
 * that owns the rows does the deleting, over the shared INTERNAL_SERVICE_KEY.
 *
 * Raises rather than returning 0 on failure: a purge that quietly reports "0 deleted"
 * when the call never landed is indistinguishable from "nothing was due", and that is
 * exactly the confusion this whole feature exists to remove.
 */
export class RemotePurgeExecutor implements PurgeExecutor {
  /**
   * Five minutes, not thirty seconds (audit S-25). A retention sweep deletes a year of a
   * dataset the first time it runs; the old bound aborted the request while the owning
   * service was still deleting, so the rows went and admin-service recorded a failure —
   * the one outcome this feature exists to prevent. It stays bounded: an owner that never
   * answers must not hold the scheduler open forever.
   */
  private static readonly TIMEOUT_MS = 300_000;
  private readonly logger = new Logger(RemotePurgeExecutor.name);

  constructor(
    readonly dataset: string,
    private readonly baseUrl: string,
    private readonly path: string,
    private readonly internalKey: string,
    readonly mode: PurgeMode = 'DELETE',
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
    // DELETE endpoints answer with `deleted`, REPORT endpoints with `eligible`. Reading
    // the wrong one would silently report 0 and look like "nothing was due".
    const body = (await response.json()) as { deleted?: number; eligible?: number };
    const key = this.mode === 'REPORT' ? body.eligible : body.deleted;
    const affected = typeof key === 'number' ? key : 0;
    this.logger.log(
      this.mode === 'REPORT'
        ? `${affected} rows in ${this.dataset} are past their window (report only)`
        : `Purged ${affected} rows from ${this.dataset}`,
    );
    return affected;
  }
}
