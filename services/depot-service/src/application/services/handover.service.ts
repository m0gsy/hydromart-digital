import { Inject, Injectable } from '@nestjs/common';

import { HandoverItem, ShiftHandover } from '../../domain/handover';
import { DepotNotFoundError, HandoverNotFoundError } from '../../domain/errors';
import { DepotRepository } from '../ports/depot.repository';
import { HandoverRepository } from '../ports/handover.repository';
import { DEPOT_TOKENS } from '../tokens';

export interface RecordHandoverInput {
  depotId: string;
  fromShift: string;
  toShift: string;
  fromStaff: string;
  toStaff: string;
  items: HandoverItem[];
  note?: string | null;
}

/**
 * Shift handover checklist (design 14d). A handover is created unsigned (signedAt null) and
 * later signed once both operators confirm the checklist.
 */
@Injectable()
export class HandoverService {
  constructor(
    @Inject(DEPOT_TOKENS.HandoverRepository) private readonly handovers: HandoverRepository,
    @Inject(DEPOT_TOKENS.DepotRepository) private readonly depots: DepotRepository,
  ) {}

  private async requireDepot(depotId: string): Promise<void> {
    if (!(await this.depots.findById(depotId, false))) {
      throw new DepotNotFoundError();
    }
  }

  private async require(id: string): Promise<ShiftHandover> {
    const found = await this.handovers.findById(id);
    if (!found) throw new HandoverNotFoundError();
    return found;
  }

  async record(input: RecordHandoverInput, recordedBy: string): Promise<ShiftHandover> {
    await this.requireDepot(input.depotId);
    return this.handovers.create({
      depotId: input.depotId,
      fromShift: input.fromShift,
      toShift: input.toShift,
      fromStaff: input.fromStaff,
      toStaff: input.toStaff,
      items: input.items,
      note: input.note ?? null,
      recordedBy,
    });
  }

  async list(depotId: string): Promise<ShiftHandover[]> {
    await this.requireDepot(depotId);
    return this.handovers.listForDepot(depotId);
  }

  get(id: string): Promise<ShiftHandover> {
    return this.require(id);
  }

  /** Stamp signedAt=now (idempotent-ish; a re-sign just refreshes the timestamp). */
  async sign(id: string): Promise<ShiftHandover> {
    await this.require(id);
    return this.handovers.sign(id, new Date());
  }
}
