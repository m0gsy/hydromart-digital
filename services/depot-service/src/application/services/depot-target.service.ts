import { Inject, Injectable } from '@nestjs/common';
import { assertFresh } from '@hydromart/platform';

import { DepotTarget } from '../../domain/depot-target';
import { DepotNotFoundError } from '../../domain/errors';
import { DepotRepository } from '../ports/depot.repository';
import { DepotTargetRepository, UpsertDepotTargetData } from '../ports/depot-target.repository';
import { DEPOT_TOKENS } from '../tokens';

export type SetDepotTargetInput = Omit<UpsertDepotTargetData, 'updatedBy'>;

/**
 * Per-depot monthly performance targets (manager dashboard). One row per depot+month;
 * setting the same month again overwrites it.
 */
@Injectable()
export class DepotTargetService {
  constructor(
    @Inject(DEPOT_TOKENS.DepotTargetRepository) private readonly targets: DepotTargetRepository,
    @Inject(DEPOT_TOKENS.DepotRepository) private readonly depots: DepotRepository,
  ) {}

  private async requireDepot(depotId: string): Promise<void> {
    if (!(await this.depots.exists(depotId))) {
      throw new DepotNotFoundError();
    }
  }

  get(depotId: string, month: string): Promise<DepotTarget | null> {
    return this.targets.findByDepotMonth(depotId, month);
  }

  /**
   * CA-2-53: an upsert on [depotId, month], so a second manager setting the same month used
   * to replace the first one's numbers entirely. A caller editing an existing target must
   * say which version it read; a month with no target yet has nothing to lose.
   */
  async set(
    input: SetDepotTargetInput,
    updatedBy: string,
    seenUpdatedAt?: string,
  ): Promise<DepotTarget> {
    await this.requireDepot(input.depotId);
    const existing = await this.targets.findByDepotMonth(input.depotId, input.month);
    assertFresh(existing?.updatedAt ?? null, seenUpdatedAt);
    return this.targets.upsert({ ...input, updatedBy });
  }
}
