import { Inject, Injectable } from '@nestjs/common';

import { localDayKey, localMinutesOfDay } from '@hydromart/platform';

import { OrderConfigService } from '../../config/order-config.service';
import { ORDER_TOKENS } from '../tokens';
import {
  CUSTOMER_OUTREACH_REPOSITORY,
  CustomerOutreachRepository,
  StatusOrderRow,
} from '../ports/customer-outreach.repository';
import { DepotDirectoryPort } from '../ports/depot-directory.port';
import { AccountByPhonePort, PaymentsOfOrdersPort } from '../ports/outreach-lookups.port';

/** How many finished or cancelled orders the status answer adds to the running ones. */
export const FINISHED_ORDERS_SHOWN = 3;
const CANDIDATE_CAP = 200;
/**
 * HD-18: an unpaid order is reminded once it is two thirds of the way to the auto-cancel (40 of
 * 60 minutes by default). The abandoned sweep cancels a CREATED order older than `abandonMinutes`;
 * the reminder window is (now - abandon, now - 2/3 abandon], so a reminded order is always one the
 * sweep has not reached, whatever the sweep's tuning, and it still has a third of the window left.
 */
const REMIND_AT_FRACTION = 2 / 3;

const pad = (n: number): string => String(n).padStart(2, '0');
/** `YYYY-MM-DD HH:mm` in WIB. */
const wib = (d: Date): string => {
  const m = localMinutesOfDay(d);
  return `${localDayKey(d)} ${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
};

/**
 * HD-18: the reads behind n8n's machine routes. The order-status answer holds what a customer asks
 * their WhatsApp bot (what is running, what just finished) and never the address, the customer's
 * name or the courier: the repository does not select them.
 */
@Injectable()
export class CustomerOutreachService {
  constructor(
    @Inject(CUSTOMER_OUTREACH_REPOSITORY) private readonly repo: CustomerOutreachRepository,
    @Inject(ORDER_TOKENS.AccountByPhone) private readonly accounts: AccountByPhonePort,
    @Inject(ORDER_TOKENS.PaymentsOfOrders) private readonly payments: PaymentsOfOrdersPort,
    @Inject(ORDER_TOKENS.DepotDirectory) private readonly depots: DepotDirectoryPort,
    private readonly config: OrderConfigService,
  ) {}

  /**
   * That number's own orders. A number nobody holds answers an empty list, the same as a number
   * with no orders, so the route is no oracle for who has an account. THROWS when auth-service
   * cannot answer (503 upstream): "no orders" must not be said for "could not look".
   */
  async statusByPhone(phone: string) {
    const customerId = await this.accounts.customerIdByPhone(phone);
    if (!customerId) return { orders: [] };
    const { running, recent } = await this.repo.statusOrders(customerId, FINISHED_ORDERS_SHOWN);
    const rows = [...running, ...recent];
    if (rows.length === 0) return { orders: [] };
    // Both lookups are decoration: an order is still answered when they fail.
    const [payments, contacts] = await Promise.all([
      this.payments.latestByOrder(rows.map((r) => r.id)).catch(() => null),
      this.depots.listContacts().catch(() => null),
    ]);
    const depotName = new Map((contacts ?? []).map((d) => [d.id, d.name]));
    return {
      orders: rows.map((r: StatusOrderRow) => ({
        orderNumber: r.orderNumber,
        createdAt: wib(r.createdAt),
        items: r.items.map((i) => ({ name: i.productName, quantity: i.quantity })),
        total: r.total,
        paymentStatus: payments?.get(r.id)?.status ?? null,
        paymentMethod: payments?.get(r.id)?.method ?? null,
        status: r.status,
        depot: (r.depotId && depotName.get(r.depotId)) || null,
        deliveryWindow: r.deliveryWindow,
        scheduledFor: r.scheduledFor ? wib(r.scheduledFor) : null,
      })),
    };
  }

  /** Active subscriptions delivering inside `[from, to)` (crm passes tomorrow's WIB day). */
  async subscriptionsDue(from: Date, to: Date) {
    return { items: await this.repo.subscriptionsDueBetween(from, to, 1000) };
  }

  /**
   * Transfer and QR orders still waiting for their payment inside the reminder window. THROWS
   * when payment-service cannot answer: a reminder for a payment that may have landed is worse
   * than a late one, and crm retries.
   */
  async unpaidOrders(now: Date) {
    const abandon = this.config.abandonMinutes;
    const created = await this.repo.createdOrdersBetween(
      new Date(now.getTime() - abandon * 60_000),
      new Date(now.getTime() - Math.floor(abandon * REMIND_AT_FRACTION) * 60_000),
      CANDIDATE_CAP,
    );
    const payments = await this.payments.latestByOrder(created.map((o) => o.id));
    return {
      items: created
        .filter((o) => {
          const p = payments.get(o.id);
          return p?.status === 'PENDING' && (p.method === 'TRANSFER' || p.method === 'QRIS');
        })
        .map((o) => ({ orderId: o.id, customerId: o.customerId, orderNumber: o.orderNumber, total: o.total })),
    };
  }
}
