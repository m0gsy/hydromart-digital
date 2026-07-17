import { Inject, Injectable, Logger } from '@nestjs/common';

import { BroadcastLevel } from '../../domain/broadcast-level';
import { BroadcastNotFoundError } from '../../domain/errors';
import {
  BroadcastForCourier,
  BroadcastRecord,
  BroadcastRepository,
} from '../ports/broadcast.repository';
import { CRM_TOKENS } from '../tokens';

/**
 * Depot broadcast use cases (design 8a): depot ops post an announcement scoped to a depot;
 * couriers at that depot read it in-app and their reads are tracked. No WhatsApp send here —
 * this is the in-app inbox, not a customer campaign.
 */
@Injectable()
export class BroadcastService {
  private static readonly LIST_LIMIT = 50;
  private readonly logger = new Logger(BroadcastService.name);

  constructor(
    @Inject(CRM_TOKENS.BroadcastRepository) private readonly repo: BroadcastRepository,
  ) {}

  async create(
    createdBy: string,
    depotId: string,
    title: string,
    body: string,
    level: BroadcastLevel = BroadcastLevel.INFO,
  ): Promise<BroadcastRecord> {
    const record = await this.repo.create({ depotId, title, body, level, createdBy });
    this.logger.log(`Broadcast ${record.id} posted to depot ${depotId} (${level})`);
    return record;
  }

  listForCourier(depotId: string, courierId: string): Promise<BroadcastForCourier[]> {
    return this.repo.listForCourier(depotId, courierId, BroadcastService.LIST_LIMIT);
  }

  async markRead(broadcastId: string, courierId: string): Promise<void> {
    const broadcast = await this.repo.findById(broadcastId);
    if (!broadcast) throw new BroadcastNotFoundError();
    await this.repo.markRead(broadcastId, courierId, new Date());
  }
}
