import { Inject, Injectable } from '@nestjs/common';

import { Subscription, SubscriptionCadence, SubscriptionStatus } from '../../domain/subscription';
import {
  CadenceNotSupportedError,
  DepotNotFoundError,
  SubscriptionNotFoundError,
} from '../../domain/errors';
import { DepotRepository } from '../ports/depot.repository';
import { OrderSubscriptionPort } from '../ports/order-subscription.port';
import { SubscriptionRepository } from '../ports/subscription.repository';
import { DEPOT_TOKENS } from '../tokens';

export interface CreateSubscriptionInput {
  depotId: string;
  /** D10: required — the engine places orders for an account, not for a name. */
  customerId: string;
  customerName: string;
  productLabel: string;
  /** D10: what the operator PICKED. A label cannot be delivered. */
  productId: string;
  /** D10: the first delivery. The engine owns every date after it. */
  firstDeliveryAt: Date;
  quantity: number;
  cadence: SubscriptionCadence;
  note?: string | null;
}

export interface ListSubscriptionFilters {
  status?: SubscriptionStatus;
}

/**
 * D10: the depot's cadence vocabulary, in the engine's words.
 *
 * PARTIAL, and that is the finding. The depot console offers DAILY and EVERY_3_DAYS; the
 * engine has never had either. Until now that difference was invisible because nothing ran
 * these plans at all — an operator could pick "harian" and the system would simply never
 * deliver, silently, forever. Connecting the engine turns that into an honest refusal at
 * the moment of creation, which is the first time anyone could have been told.
 *
 * Adding the two cadences to the engine is a real option, and a bigger one: a new value in
 * a database enum plus its own migration. Refusing is the smaller true thing; the console
 * stops offering them in the same change.
 */
const CADENCE_TO_FREQUENCY: Partial<
  Record<SubscriptionCadence, 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY'>
> = {
  [SubscriptionCadence.WEEKLY]: 'WEEKLY',
  [SubscriptionCadence.BIWEEKLY]: 'BIWEEKLY',
  [SubscriptionCadence.MONTHLY]: 'MONTHLY',
};

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
    // D10: the plan runs on order-service's engine, not on a second one grown here.
    @Inject(DEPOT_TOKENS.OrderSubscriptionPort)
    private readonly engine: OrderSubscriptionPort,
  ) {}

  /** Ids of this depot's customers holding an ACTIVE subscription (S2, service-to-service). */
  activeCustomerIds(depotId: string): Promise<string[]> {
    return this.subscriptions.activeCustomerIdsForDepot(depotId);
  }

  /**
   * K1.11: the depot-created half of the subscription population, network-wide.
   *
   * No depot argument and no depot existence check: this is the whole network, which is
   * the only scope at which HQ's screen asks the question. It exists because that screen
   * was reading order-service's customer-created plans and calling the answer the total.
   */
  networkSummary(): Promise<{ activeSubscriptions: number; activeSubscribers: number }> {
    return this.subscriptions.networkActiveCounts();
  }

  private async requireDepot(depotId: string): Promise<void> {
    if (!(await this.depots.exists(depotId))) {
      throw new DepotNotFoundError();
    }
  }

  private async require(id: string): Promise<Subscription> {
    const found = await this.subscriptions.findById(id);
    if (!found) throw new SubscriptionNotFoundError();
    return found;
  }

  /**
   * D10: the plan is created on the ENGINE first, and only then written here.
   *
   * That order matters. A depot row saved before the engine call would survive an engine
   * refusal as exactly the thing D10 removes — a plan the console shows and nothing runs.
   * Engine first means a failure leaves no row at all, and the operator is told why while
   * they are still on the screen.
   *
   * `nextRunAt` is no longer taken from the form: the engine owns the schedule now, and a
   * second date living here is a second truth that starts drifting the moment it is
   * written. What the operator picks is the FIRST delivery; the engine keeps it moving.
   */
  async create(input: CreateSubscriptionInput): Promise<Subscription> {
    await this.requireDepot(input.depotId);
    const frequency = CADENCE_TO_FREQUENCY[input.cadence];
    if (!frequency) throw new CadenceNotSupportedError(input.cadence);
    const engineId = await this.engine.create({
      customerId: input.customerId,
      productId: input.productId,
      quantity: input.quantity,
      frequency,
      firstDeliveryAt: input.firstDeliveryAt,
    });
    return this.subscriptions.create({
      depotId: input.depotId,
      customerId: input.customerId,
      customerName: input.customerName,
      productLabel: input.productLabel,
      productId: input.productId,
      orderSubscriptionId: engineId,
      quantity: input.quantity,
      cadence: input.cadence,
      nextRunAt: input.firstDeliveryAt,
      note: input.note ?? null,
    });
  }

  async list(depotId: string, filters: ListSubscriptionFilters = {}): Promise<Subscription[]> {
    await this.requireDepot(depotId);
    return this.subscriptions.listForDepot(depotId, filters.status);
  }

  /** Load one subscription (for by-id depot-scope assertion in the controller). */
  get(id: string): Promise<Subscription> {
    return this.require(id);
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
