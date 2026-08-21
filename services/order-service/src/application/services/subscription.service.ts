import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  ProductUnavailableError,
  SubscriptionAddressNotRoutableError,
  SubscriptionCustomerAddressMissingError,
  SubscriptionNotActionableError,
  SubscriptionNotFoundError,
} from '../../domain/errors';
import { nextDeliveryOnOrAfter } from '../../domain/subscription';
import { OrderConfigService } from '../../config/order-config.service';
import { DeliveryAddressSnapshot } from '../ports/order.repository';
import { NotificationPort } from '../ports/notification.port';
import { CustomerDirectoryPort } from '../ports/customer-directory.port';
import { ProductCatalogPort } from '../ports/product-catalog.port';
import {
  CreateSubscriptionData,
  SubscriptionFrequency,
  SubscriptionNetworkSummary,
  SubscriptionRecord,
  SubscriptionRepository,
} from '../ports/subscription.repository';
import { ORDER_TOKENS } from '../tokens';
import { OrderService } from './order.service';

export interface CreateSubscriptionInput {
  productId: string;
  quantity: number;
  frequency: SubscriptionFrequency;
  firstDeliveryAt: Date;
  address: DeliveryAddressSnapshot;
}

/**
 * D2: consecutive failed cycles before the sweep stops asking and pauses the plan.
 *
 * Three, not one: a single failure is usually a blip — crm down, a depot unreachable for a
 * minute — and pausing a customer's water over one of those is worse than retrying. Three
 * consecutive ticks is a condition, not a blip.
 */
const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * D2: the same `instanceof Error` dance was about to appear in three places along one
 * failure path. One helper, one branch — three copies would be three branches nobody would
 * ever exercise separately, and a rejection that is not an Error is the same fact wherever
 * it surfaces.
 */
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : 'unknown');

/** Deliveries a single subscription generates per 30-day month, by cadence. */
const MONTHLY_DELIVERY_RATE: Record<SubscriptionFrequency, number> = {
  WEEKLY: 30 / 7,
  BIWEEKLY: 30 / 14,
  MONTHLY: 1,
};

/** Network aggregate (18c). estMonthlyDeliveries is an ESTIMATE — a rupiah MRR
 * can't be derived here (subscriptions snapshot no price), so we report the
 * expected monthly delivery volume instead. */
export interface SubscriptionNetworkSummaryView extends SubscriptionNetworkSummary {
  estMonthlyDeliveries: number;
}

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    @Inject(ORDER_TOKENS.SubscriptionRepository)
    private readonly subs: SubscriptionRepository,
    @Inject(ORDER_TOKENS.ProductCatalog)
    private readonly catalog: ProductCatalogPort,
    private readonly orders: OrderService,
    private readonly config: OrderConfigService,
    // D2: a plan the sweep gives up on has to TELL the customer. A standing order that
    // stops arriving with no message is the bug this closes.
    @Inject(ORDER_TOKENS.Notification)
    private readonly notification: NotificationPort,
    // D10: a depot-created subscription delivers to the CUSTOMER's own primary address,
    // read here rather than typed by whoever filled the form.
    @Inject(ORDER_TOKENS.CustomerDirectory)
    private readonly customers: CustomerDirectoryPort,
  ) {}

  /**
   * The subscription discount in force at `depotId` (null = global default), as a
   * fraction. The shop quotes this so its "hemat N%" line matches what the sweep
   * actually charges at that depot instead of a copy-pasted 5%.
   */
  discountRate(depotId: string | null): number {
    return this.config.subscriptionDiscountRate(depotId);
  }

  async create(customerId: string, input: CreateSubscriptionInput): Promise<SubscriptionRecord> {
    // D3: refuse a plan nobody could ever fulfil, while somebody is still on the screen to
    // fix it. The sweep resolves a depot from this snapshot and has nothing to fall back on
    // — no customer to ask, no depot picker, no session — so an address with no map pin
    // becomes a subscription that is ACTIVE forever and delivers nothing.
    if (input.address.latitude === null || input.address.longitude === null) {
      throw new SubscriptionAddressNotRoutableError();
    }
    const product = await this.catalog.getProduct(input.productId);
    if (!product || !product.active) {
      throw new ProductUnavailableError(input.productId);
    }
    const data: CreateSubscriptionData = {
      customerId,
      productId: product.id,
      productName: product.name,
      unit: product.unit,
      quantity: input.quantity,
      frequency: input.frequency,
      nextDeliveryAt: input.firstDeliveryAt,
      ...input.address,
    };
    return this.subs.create(data);
  }

  /**
   * D10: a subscription depot staff set up FOR a customer, on the same engine.
   *
   * The depot console used to keep its own table of "plans" that produced nothing — no
   * sweep, nothing writing a next run, and a screen showing a date that froze where the
   * operator typed it and drifted further into the past every day. This connects that table
   * to the engine D1, D2, D4, D6, D8 and D9 repaired, rather than growing a second engine
   * that would inherit none of it.
   *
   * The address is the customer's OWN primary one, read here rather than taken from the
   * caller: a depot operator typing an address on somebody else's behalf is how the
   * unroutable plans D3 refuses got created in the first place. No address, no
   * subscription — and the error says which, so the operator can act on it.
   */
  async createForCustomer(
    customerId: string,
    input: Omit<CreateSubscriptionInput, 'address'>,
  ): Promise<SubscriptionRecord> {
    const address = await this.customers.primaryAddress(customerId);
    if (!address) throw new SubscriptionCustomerAddressMissingError();
    return this.create(customerId, { ...input, address });
  }

  async list(customerId: string): Promise<SubscriptionRecord[]> {
    return this.subs.listByCustomer(customerId);
  }

  /** HQ network summary (18c): active counts, per-plan breakdown + delivery estimate. */
  async networkSummary(): Promise<SubscriptionNetworkSummaryView> {
    const summary = await this.subs.networkSummary();
    const estMonthlyDeliveries = Math.round(
      summary.plans.reduce((n, p) => n + p.subscribers * MONTHLY_DELIVERY_RATE[p.frequency], 0),
    );
    return { ...summary, estMonthlyDeliveries };
  }

  private async owned(customerId: string, id: string): Promise<SubscriptionRecord> {
    const sub = await this.subs.findById(id);
    if (!sub || sub.customerId !== customerId) throw new SubscriptionNotFoundError();
    return sub;
  }

  async pause(customerId: string, id: string): Promise<SubscriptionRecord> {
    const sub = await this.owned(customerId, id);
    if (sub.status === 'CANCELLED') throw new SubscriptionNotActionableError();
    return this.subs.setStatus(id, 'PAUSED');
  }

  /**
   * D4: resuming moves the schedule forward, it does not just flip the status back.
   *
   * Pausing never touched `nextDeliveryAt`, so a plan slept holding a due date in the past
   * and the first sweep after resuming placed a delivery immediately — the customer paused
   * their water and got a gallon on the doorstep the moment they came back.
   *
   * The new date steps the plan's OWN cadence from its old due date, so a Tuesday plan
   * stays on Tuesdays. Resuming a plan that is not actually overdue leaves its date alone.
   */
  async resume(customerId: string, id: string, now: Date): Promise<SubscriptionRecord> {
    const sub = await this.owned(customerId, id);
    if (sub.status === 'CANCELLED') throw new SubscriptionNotActionableError();
    return this.subs.resume(id, nextDeliveryOnOrAfter(sub.nextDeliveryAt, sub.frequency, now));
  }

  async cancel(customerId: string, id: string): Promise<SubscriptionRecord> {
    await this.owned(customerId, id);
    return this.subs.setStatus(id, 'CANCELLED');
  }

  /**
   * Fulfilment sweep (spec 7b): place an order for every ACTIVE subscription whose
   * next delivery is due, then advance its schedule. Admin/internal-triggered, mirroring
   * expireAbandoned — this repo has no cron daemon, so an ops scheduler calls this.
   * Each subscription is isolated: a placement failure logs and skips (never blocks
   * the rest), and the schedule only advances when the order was actually placed.
   */
  async processDue(now: Date): Promise<{ placed: number }> {
    const due = await this.subs.findDue(now);
    let placed = 0;
    for (const sub of due) {
      const address: DeliveryAddressSnapshot = {
        recipientName: sub.recipientName,
        phone: sub.phone,
        addressLine: sub.addressLine,
        city: sub.city,
        province: sub.province,
        postalCode: sub.postalCode,
        latitude: sub.latitude,
        longitude: sub.longitude,
        notes: sub.notes,
      };
      try {
        await this.orders.placeScheduled(
          sub.customerId,
          [{ productId: sub.productId, quantity: sub.quantity }],
          address,
          // H-3: one key per due delivery, so two sweeps running over the same window
          // place one order between them instead of one each. The due date is part of it
          // — the next delivery is a different order, not a replay of this one.
          `sub:${sub.id}:${sub.nextDeliveryAt.toISOString()}`,
          // D6: the same fact, recorded as data instead of only as a naming convention.
          sub.id,
        );
        // D2: the schedule steps from the date this cycle was DUE, never from `now`.
        //
        // Advancing from `now` moved the delivery day permanently every time a cycle ran
        // late: a plan due Tuesday that the sweep only reached on Friday became a Friday
        // plan, at whatever hour the sweep happened to run, and never came back.
        // `nextDeliveryOnOrAfter` also skips whole cadences that were missed, so a plan
        // rescued after a long outage owes one delivery, not the backlog.
        //
        // Counted only when this sweep is the one that moved the schedule on.
        const next = nextDeliveryOnOrAfter(sub.nextDeliveryAt, sub.frequency, now);
        if (await this.subs.advance(sub.id, sub.nextDeliveryAt, next)) {
          placed += 1;
        }
      } catch (err) {
        await this.recordCycleFailure(sub, err, now);
      }
    }
    return { placed };
  }

  /**
   * D2: a cycle that failed is counted, explained, and eventually stopped.
   *
   * Before this the sweep wrote one warning and moved on — so a plan whose product had been
   * pulled from the catalogue was retried on every tick, for as long as the plan existed,
   * and the customer was never told their standing order had stopped arriving. The only
   * trace was a line in a container log nobody reads.
   *
   * Pausing rather than cancelling: the plan is the customer's, and the cause may be
   * temporary. PAUSED is the state they can resume from once it is fixed — and D4 already
   * makes resuming move the schedule forward instead of delivering on the spot.
   *
   * Every step is fail-open. This runs inside the sweep's own catch, and a failure to
   * RECORD a failure must not take the rest of the batch down with it.
   */
  private async recordCycleFailure(
    sub: SubscriptionRecord,
    err: unknown,
    now: Date,
  ): Promise<void> {
    const reason = messageOf(err);
    this.logger.warn(`Subscription ${sub.id} delivery skipped: ${reason}`);
    let failures: number;
    try {
      failures = await this.subs.recordFailure(sub.id, reason, now);
    } catch (recordErr) {
      this.logger.warn(
        `Subscription ${sub.id} failure not recorded: ${messageOf(recordErr)}`,
      );
      return;
    }
    if (failures < MAX_CONSECUTIVE_FAILURES) return;

    try {
      await this.subs.setStatus(sub.id, 'PAUSED');
    } catch (pauseErr) {
      this.logger.warn(
        `Subscription ${sub.id} not paused after ${failures} failures: ${messageOf(pauseErr)}`,
      );
      return;
    }
    // Telling the customer is the whole point — a standing order that stops arriving with
    // no message is the bug. Fail-open: the pause already happened and is the durable part.
    await this.notification
      .notify(
        'SUBSCRIPTION_PAUSED',
        sub.phone,
        { name: sub.recipientName, product: sub.productName, reason },
        sub.customerId,
        '',
      )
      .catch(() => false);
  }
}
