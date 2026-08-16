import { Inject, Injectable } from '@nestjs/common';

import { CourierPayoutPort } from '../ports/courier-payout.port';
import { DeliveryRepository } from '../ports/delivery.repository';
import { SettlementRepository } from '../ports/settlement.repository';
import { DELIVERY_TOKENS } from '../tokens';

/** One courier's commission line for the period (design 11c). */
export interface CourierCommissionRow {
  /** The driver id. delivery-service holds no name store, so the caller resolves the label. */
  courierId: string;
  /** Deliveries THIS service recorded as completed in the window. */
  delivered: number;
  /**
   * Deliveries payout-service actually paid for. Normally equal to `delivered`; a gap means
   * an earning push was lost (that path fails open by design), and the gap is worth seeing
   * rather than worth hiding behind a multiplication.
   */
  paidDeliveries: number;
  /** What the courier was really credited: fares + incentive rungs, from the payer's ledger. */
  grossIdr: number;
  /** Charged COD shortfall deducted this period (0 when clean). */
  shortfallIdr: number;
  /** grossIdr − shortfallIdr. */
  netIdr: number;
}

export interface CommissionRun {
  depotId: string;
  from: string;
  to: string;
  /** Highest net first. Empty when `source` is 'unavailable'. */
  couriers: CourierCommissionRow[];
  /** Null when the pay could not be read — never a figure this service worked out itself. */
  totalIdr: number | null;
  /** Where the money came from. 'unavailable' = payout-service could not be read. */
  source: 'payout' | 'unavailable';
}

/**
 * Per-courier commission for one depot over a window (design 11c).
 *
 * Audit E-1: this used to answer `delivered × courierRatePerDeliveryIdr` — a flat rate
 * configured in THIS service, which pays nobody. What a courier is actually paid is
 * `baseFare + peakBonus + onTimeBonus` plus the monthly incentive ladder, computed and
 * posted by payout-service. So a manager's commission run and the courier's own ledger
 * stated two different amounts for the same deliveries, both live, and neither wrong by
 * any rule either service could check.
 *
 * The report now reads the payer's ledger. `delivered` and `shortfallIdr` stay local
 * because deliveries and COD settlements are this service's own facts; the money is not.
 *
 * There is deliberately NO fallback rate. If payout-service cannot be read the run reports
 * `source: 'unavailable'` and no figures — a second opinion computed locally is exactly how
 * the two numbers came to exist.
 */
@Injectable()
export class CommissionService {
  constructor(
    @Inject(DELIVERY_TOKENS.DeliveryRepository) private readonly deliveries: DeliveryRepository,
    @Inject(DELIVERY_TOKENS.SettlementRepository) private readonly settlements: SettlementRepository,
    @Inject(DELIVERY_TOKENS.CourierPayout) private readonly payout: CourierPayoutPort,
  ) {}

  async run(depotId: string, from: Date, to: Date): Promise<CommissionRun> {
    const [counts, shortfalls, earnings] = await Promise.all([
      this.deliveries.depotDeliveredCountsInWindow(depotId, from, to),
      this.settlements.chargedShortfallByDriver(depotId, from, to),
      this.payout.paidEarnings(depotId, from, to),
    ]);

    if (earnings === null) {
      return {
        depotId,
        from: from.toISOString(),
        to: to.toISOString(),
        couriers: [],
        totalIdr: null,
        source: 'unavailable',
      };
    }

    const shortfallByDriver = new Map(shortfalls.map((s) => [s.driverId, s.shortfallIdr]));
    const deliveredByDriver = new Map(counts.map((c) => [c.driverId, c.count]));
    const paidByCourier = new Map(earnings.map((e) => [e.courierId, e]));

    // The union: a courier paid at this depot but with no delivery recorded here still owes
    // an explanation, and so does the reverse. Dropping either side would hide exactly the
    // disagreement this report exists to surface.
    const courierIds = new Set([...deliveredByDriver.keys(), ...paidByCourier.keys()]);

    const couriers = [...courierIds]
      .map((courierId) => {
        const paid = paidByCourier.get(courierId);
        const grossIdr = paid?.earnedIdr ?? 0;
        const shortfallIdr = shortfallByDriver.get(courierId) ?? 0;
        return {
          courierId,
          delivered: deliveredByDriver.get(courierId) ?? 0,
          paidDeliveries: paid?.paidDeliveries ?? 0,
          grossIdr,
          shortfallIdr,
          netIdr: grossIdr - shortfallIdr,
        };
      })
      .sort((a, b) => b.netIdr - a.netIdr);

    return {
      depotId,
      from: from.toISOString(),
      to: to.toISOString(),
      couriers,
      totalIdr: couriers.reduce((s, c) => s + c.netIdr, 0),
      source: 'payout',
    };
  }
}
