import { Inject, Injectable } from '@nestjs/common';

import { GallonCondition } from '../../domain/gallon-return';
import { DepotNotFoundError } from '../../domain/errors';
import { DepotConfigService } from '../../config/depot-config.service';
import { buildPage, Page } from '../pagination';
import { DepotRepository } from '../ports/depot.repository';
import {
  GallonReturnRecord,
  GallonReturnRepository,
  GallonReturnSummary,
} from '../ports/gallon-return.repository';
import { DEPOT_TOKENS } from '../tokens';

export interface RecordReturnInput {
  customerId?: string | null;
  quantity: number;
  condition?: GallonCondition;
  depositRefunded?: number;
  note?: string | null;
}

/** Courier handover return (design 2e): linked to an order, deposit derived from config. */
export interface CourierReturnInput {
  orderId: string;
  customerId?: string | null;
  quantity: number;
  condition?: GallonCondition;
  note?: string | null;
}

/**
 * Empty-gallon returns / deposit refunds (PRD Module 11 retur galon). A depot-scoped
 * append-only ledger of empties handed back and the deposit refunded. Standalone —
 * it does not yet increment the depot's GALON stock line.
 *
 * ponytail: pure ledger. Wiring GOOD returns into GALON inventory (an ADJUSTMENT
 * movement per return) is the follow-up when ops wants reconciled empty-gallon stock.
 */
@Injectable()
export class GallonReturnService {
  constructor(
    @Inject(DEPOT_TOKENS.GallonReturnRepository) private readonly returns: GallonReturnRepository,
    @Inject(DEPOT_TOKENS.DepotRepository) private readonly depots: DepotRepository,
    private readonly config: DepotConfigService,
  ) {}

  private async requireDepot(depotId: string): Promise<void> {
    if (!(await this.depots.findById(depotId, false))) {
      throw new DepotNotFoundError();
    }
  }

  async record(depotId: string, input: RecordReturnInput, actorId: string): Promise<GallonReturnRecord> {
    await this.requireDepot(depotId);
    return this.returns.create({
      depotId,
      customerId: input.customerId ?? null,
      orderId: null,
      quantity: input.quantity,
      condition: input.condition ?? GallonCondition.GOOD,
      depositRefunded: input.depositRefunded ?? 0,
      note: input.note ?? null,
      actorId,
    });
  }

  /**
   * Courier records an empty-gallon return at delivery handover (design 2e). The refund is
   * derived server-side (GALLON_DEPOSIT_IDR × quantity) — the courier never supplies an
   * amount. DAMAGED empties still count for stock reconciliation but refund nothing.
   */
  async recordFromCourier(
    depotId: string,
    input: CourierReturnInput,
    courierId: string,
  ): Promise<GallonReturnRecord> {
    await this.requireDepot(depotId);
    const condition = input.condition ?? GallonCondition.GOOD;
    const depositRefunded =
      condition === GallonCondition.GOOD ? this.config.gallonDepositIdr * input.quantity : 0;
    return this.returns.create({
      depotId,
      customerId: input.customerId ?? null,
      orderId: input.orderId,
      quantity: input.quantity,
      condition,
      depositRefunded,
      note: input.note ?? null,
      actorId: courierId,
    });
  }

  async list(depotId: string, page: number, limit: number): Promise<Page<GallonReturnRecord>> {
    await this.requireDepot(depotId);
    const { items, total } = await this.returns.listForDepot(depotId, page, limit);
    return buildPage(items, total, page, limit);
  }

  async summary(depotId: string): Promise<GallonReturnSummary> {
    await this.requireDepot(depotId);
    return this.returns.summaryForDepot(depotId);
  }
}
