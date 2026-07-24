import { Inject, Injectable } from '@nestjs/common';

import { DeliveryConfigService } from '../../config/delivery-config.service';
import { DeliveryRepository } from '../ports/delivery.repository';
import { SettlementRepository } from '../ports/settlement.repository';
import { DELIVERY_TOKENS } from '../tokens';

/** One courier's commission line for the period (design 11c). */
export interface CourierCommissionRow {
  /** The driver id. delivery-service holds no name store, so the caller resolves the label. */
  courierId: string;
  delivered: number;
  ratePerDeliveryIdr: number;
  /** delivered × rate. */
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
  ratePerDeliveryIdr: number;
  /** Highest net first. */
  couriers: CourierCommissionRow[];
  totalIdr: number;
}

/**
 * Per-courier commission for one depot over a window (design 11c). `delivered` is real
 * (local delivered counts) and `shortfallIdr` is real (this service's own settlement
 * ledger); the flat `ratePerDeliveryIdr` is a config default. Courier display names are
 * resolved by the caller — delivery-service keeps only driver ids.
 */
@Injectable()
export class CommissionService {
  constructor(
    @Inject(DELIVERY_TOKENS.DeliveryRepository) private readonly deliveries: DeliveryRepository,
    @Inject(DELIVERY_TOKENS.SettlementRepository) private readonly settlements: SettlementRepository,
    private readonly config: DeliveryConfigService,
  ) {}

  async run(depotId: string, from: Date, to: Date): Promise<CommissionRun> {
    const rate = this.config.courierRatePerDeliveryIdr(depotId);
    const [counts, shortfalls] = await Promise.all([
      this.deliveries.depotDeliveredCountsInWindow(depotId, from, to),
      this.settlements.chargedShortfallByDriver(depotId, from, to),
    ]);
    const shortfallByDriver = new Map(shortfalls.map((s) => [s.driverId, s.shortfallIdr]));

    const couriers = counts
      .map((c) => {
        const grossIdr = c.count * rate;
        const shortfallIdr = shortfallByDriver.get(c.driverId) ?? 0;
        return {
          courierId: c.driverId,
          delivered: c.count,
          ratePerDeliveryIdr: rate,
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
      ratePerDeliveryIdr: rate,
      couriers,
      totalIdr: couriers.reduce((s, c) => s + c.netIdr, 0),
    };
  }
}
