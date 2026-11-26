import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { localDayKey, localMinutesOfDay } from '@hydromart/platform';

import { OrderConfigService } from '../../config/order-config.service';
import { ORDER_TOKENS } from '../tokens';
import {
  CUSTOMER_OUTREACH_REPOSITORY,
  CustomerOutreachRepository,
  StatusOrderRow,
} from '../ports/customer-outreach.repository';
import { selectNearestDepot } from '../../domain/geo';
import { DepotDirectoryPort, DepotLocation } from '../ports/depot-directory.port';
import { AccountByPhonePort, PaymentsOfOrdersPort } from '../ports/outreach-lookups.port';

/** How many finished or cancelled orders the status answer adds to the running ones. */
export const FINISHED_ORDERS_SHOWN = 3;
const CANDIDATE_CAP = 200;
const SUBSCRIPTION_CAP = 1000;
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
  private readonly logger = new Logger(CustomerOutreachService.name);

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
    let customerId: string | null;
    let found: { running: StatusOrderRow[]; recent: StatusOrderRow[] };
    try {
      customerId = await this.accounts.customerIdByPhone(phone);
      if (!customerId) return { orders: [] };
      found = await this.repo.statusOrders(customerId, FINISHED_ORDERS_SHOWN);
    } catch (e) {
      // A fixed message and a log line without the number: neither the number nor the upstream
      // error text leaves this service.
      this.logger.warn(`order status lookup failed: ${(e as Error).name}`);
      throw new ServiceUnavailableException('Order status is temporarily unavailable; retry later');
    }
    const { running, recent } = found;
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

  /**
   * Active subscriptions delivering inside `[from, to)` (crm passes tomorrow's WIB day). HD-14: a
   * plan whose address routes to a depot on a quality hold is left out, because that delivery will
   * not happen tomorrow and a "see you tomorrow" reminder would be a promise the depot cannot keep.
   * THROWS (503) when the depots cannot be read: crm retries, nothing is guessed.
   */
  async subscriptionsDue(from: Date, to: Date) {
    const rows = await this.repo.subscriptionsDueBetween(from, to, SUBSCRIPTION_CAP + 1);
    const { held, depots } = await this.heldDepots();
    const kept = held.size === 0
      ? rows
      : rows.filter((r) => {
          if (r.latitude === null || r.longitude === null) return true;
          const depot = selectNearestDepot(r.latitude, r.longitude, depots);
          return !(depot && held.has(depot.id));
        });
    const { items, truncated } = this.capped('subscriptions due', kept, SUBSCRIPTION_CAP);
    return { items: items.map(({ latitude: _la, longitude: _lo, ...rest }) => rest), truncated };
  }

  /** HD-14: the active depots and the ids of those on a quality hold; throws 503 when the directory cannot be read. */
  private async heldDepots(): Promise<{ depots: DepotLocation[]; held: Set<string> }> {
    const depots = await this.depots.listActiveDepots();
    if (depots === null) throw new ServiceUnavailableException('The depots could not be read; retry later');
    return { depots, held: new Set(depots.filter((d) => d.onHold).map((d) => d.id)) };
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
      CANDIDATE_CAP + 1,
    );
    // Oldest first, so the orders closest to the auto-cancel are the ones kept; a truncated tick
    // says so and the next tick (10 minutes on) takes the rest.
    const { items: kept, truncated } = this.capped('unpaid orders', created, CANDIDATE_CAP);
    const payments = await this.payments.latestByOrder(kept.map((o) => o.id));
    // HD-14: nobody is reminded to pay for an order of a depot on a quality hold.
    const { held } = await this.heldDepots();
    return {
      truncated,
      items: kept
        .filter((o) => !(o.depotId && held.has(o.depotId)))
        .filter((o) => {
          const p = payments.get(o.id);
          return p?.status === 'PENDING' && (p.method === 'TRANSFER' || p.method === 'QRIS');
        })
        .map((o) => ({ orderId: o.id, customerId: o.customerId, orderNumber: o.orderNumber, total: o.total })),
    };
  }

  /** The first `cap` rows, and whether there were more (the caller fetched `cap + 1`). */
  private capped<T>(what: string, rows: T[], cap: number): { items: T[]; truncated: boolean } {
    const truncated = rows.length > cap;
    if (truncated) this.logger.warn(`${what}: more than ${cap} due, answer truncated`);
    return { items: rows.slice(0, cap), truncated };
  }
}
