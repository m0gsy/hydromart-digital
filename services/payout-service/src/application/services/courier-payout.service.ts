import { Inject, Injectable, Logger } from '@nestjs/common';

import { computeEarning } from '../../domain/courier-earning';
import {
  CourierLedgerEntryRecord,
  CourierLedgerRepository,
} from '../ports/courier-ledger.repository';
import { PAYOUT_TOKENS } from '../tokens';
import { Page, buildPage } from '../pagination';

/** Raw delivery-completion event pushed by delivery-service (design 6b earning). */
export interface DeliveryCompletedEvent {
  courierId: string;
  depotId: string | null;
  deliveryId: string;
  /** ISO timestamp the delivery completed. */
  deliveredAt: string;
  /** Whether the delivery beat its SLA (decided by delivery-service). */
  onTime: boolean;
}

export interface CourierEarningsSummary {
  availableBalance: number;
  monthEarnings: number;
  recentEntries: CourierLedgerEntryRecord[];
}

// Indonesia runs one business timezone; peak hours are WIB (UTC+7). ponytail: fixed
// offset, swap for a per-depot tz only if depots ever span timezones.
const WIB_OFFSET_HOURS = 7;

@Injectable()
export class CourierPayoutService {
  private readonly logger = new Logger(CourierPayoutService.name);

  constructor(
    @Inject(PAYOUT_TOKENS.CourierLedgerRepository)
    private readonly ledger: CourierLedgerRepository,
  ) {}

  /**
   * Records a courier's pay for one completed delivery. Idempotent: the delivery id
   * is the source ref, so an at-least-once push re-posts nothing. Returns null when no
   * earning rule is configured (the delivery still happened — never throw upstream).
   */
  async recordDeliveryEarning(
    event: DeliveryCompletedEvent,
  ): Promise<CourierLedgerEntryRecord | null> {
    const sourceRef = `earning:${event.deliveryId}`;
    const existing = await this.ledger.findBySourceRef(sourceRef);
    if (existing) {
      return existing;
    }

    const rule = await this.ledger.currentRule(event.depotId);
    if (!rule) {
      this.logger.warn(`No courier earning rule for depot ${event.depotId}; skipped ${sourceRef}`);
      return null;
    }

    const deliveredAt = new Date(event.deliveredAt);
    const hour = (deliveredAt.getUTCHours() + WIB_OFFSET_HOURS) % 24;
    const amount = computeEarning(rule, { hour, onTime: event.onTime });

    const entry = await this.ledger.create({
      courierId: event.courierId,
      depotId: event.depotId,
      type: 'EARNING',
      amount,
      description: event.onTime ? 'Ongkos antar (tepat waktu)' : 'Ongkos antar',
      sourceRef,
      occurredAt: deliveredAt,
    });
    this.logger.log(`Courier ${event.courierId} earned ${amount} for delivery ${event.deliveryId}`);
    return entry;
  }

  async summary(courierId: string): Promise<CourierEarningsSummary> {
    const monthStart = startOfMonth(new Date());
    const [availableBalance, monthEarnings, recent] = await Promise.all([
      this.ledger.balanceFor(courierId),
      this.ledger.sumByType(courierId, 'EARNING', monthStart),
      this.ledger.listForCourier(courierId, 1, 8),
    ]);
    return { availableBalance, monthEarnings, recentEntries: recent.items };
  }

  async ledgerPage(
    courierId: string,
    page: number,
    limit: number,
  ): Promise<Page<CourierLedgerEntryRecord>> {
    const { items, total } = await this.ledger.listForCourier(courierId, page, limit);
    return buildPage(items, total, page, limit);
  }
}

function startOfMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}
