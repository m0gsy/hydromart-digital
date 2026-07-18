import { Inject, Injectable } from '@nestjs/common';

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
    if (!(await this.depots.findById(depotId, false))) {
      throw new DepotNotFoundError();
    }
  }

  get(depotId: string, month: string): Promise<DepotTarget | null> {
    return this.targets.findByDepotMonth(depotId, month);
  }

  async set(input: SetDepotTargetInput, updatedBy: string): Promise<DepotTarget> {
    await this.requireDepot(input.depotId);
    return this.targets.upsert({ ...input, updatedBy });
  }
}
