import { Inject, Injectable } from '@nestjs/common';

import { Subscription, SubscriptionCadence, SubscriptionStatus } from '../../domain/subscription';
import { DepotNotFoundError, SubscriptionNotFoundError } from '../../domain/errors';
import { DepotRepository } from '../ports/depot.repository';
import { SubscriptionRepository } from '../ports/subscription.repository';
import { DEPOT_TOKENS } from '../tokens';

export interface CreateSubscriptionInput {
  depotId: string;
  customerId?: string | null;
  customerName: string;
  productLabel: string;
  quantity: number;
  cadence: SubscriptionCadence;
  nextRunAt?: Date | null;
  note?: string | null;
}

export interface ListSubscriptionFilters {
  status?: SubscriptionStatus;
}

/**
 * Customer recurring subscriptions (design 16b). A depot-scoped standing order (N units on a
 * cadence) with an ACTIVE ⇄ PAUSED lifecycle the manager manages.
 */
@Injectable()
export class SubscriptionService {
  constructor(
    @Inject(DEPOT_TOKENS.SubscriptionRepository)
    private readonly subscriptions: SubscriptionRepository,
    @Inject(DEPOT_TOKENS.DepotRepository) private readonly depots: DepotRepository,
  ) {}

  private async requireDepot(depotId: string): Promise<void> {
    if (!(await this.depots.findById(depotId, false))) {
      throw new DepotNotFoundError();
    }
  }

  private async require(id: string): Promise<Subscription> {
    const found = await this.subscriptions.findById(id);
    if (!found) throw new SubscriptionNotFoundError();
    return found;
  }

  async create(input: CreateSubscriptionInput): Promise<Subscription> {
    await this.requireDepot(input.depotId);
    // ponytail: scheduler-driven order seeding deferred
    return this.subscriptions.create({
      depotId: input.depotId,
      customerId: input.customerId ?? null,
      customerName: input.customerName,
      productLabel: input.productLabel,
      quantity: input.quantity,
      cadence: input.cadence,
      nextRunAt: input.nextRunAt ?? null,
      note: input.note ?? null,
    });
  }

  async list(depotId: string, filters: ListSubscriptionFilters = {}): Promise<Subscription[]> {
    await this.requireDepot(depotId);
    return this.subscriptions.listForDepot(depotId, filters.status);
  }

  async pause(id: string): Promise<Subscription> {
    await this.require(id);
    return this.subscriptions.update(id, { status: SubscriptionStatus.PAUSED });
  }

  async resume(id: string): Promise<Subscription> {
    await this.require(id);
    return this.subscriptions.update(id, { status: SubscriptionStatus.ACTIVE });
  }
}
