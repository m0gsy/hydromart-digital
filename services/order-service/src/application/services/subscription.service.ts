import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  ProductUnavailableError,
  SubscriptionNotActionableError,
  SubscriptionNotFoundError,
} from '../../domain/errors';
import { SUBSCRIPTION_DISCOUNT_RATE, advanceDelivery } from '../../domain/subscription';
import { DeliveryAddressSnapshot } from '../ports/order.repository';
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
  ) {}

  async create(customerId: string, input: CreateSubscriptionInput): Promise<SubscriptionRecord> {
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

  async resume(customerId: string, id: string): Promise<SubscriptionRecord> {
    const sub = await this.owned(customerId, id);
    if (sub.status === 'CANCELLED') throw new SubscriptionNotActionableError();
    return this.subs.setStatus(id, 'ACTIVE');
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
          SUBSCRIPTION_DISCOUNT_RATE,
        );
        await this.subs.advance(sub.id, advanceDelivery(now, sub.frequency));
        placed += 1;
      } catch (err) {
        this.logger.warn(
          `Subscription ${sub.id} delivery skipped: ${err instanceof Error ? err.message : 'unknown'}`,
        );
      }
    }
    return { placed };
  }
}
