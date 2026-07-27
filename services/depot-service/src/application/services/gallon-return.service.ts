import { Inject, Injectable } from '@nestjs/common';

import { GallonCondition } from '../../domain/gallon-return';
import { DepotNotFoundError, GallonOverReturnError } from '../../domain/errors';
import { DepotConfigService } from '../../config/depot-config.service';
import { buildPage, Page } from '../pagination';
import { DepotRepository } from '../ports/depot.repository';
import { GallonIssueRepository } from '../ports/gallon-issue.repository';
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
    @Inject(DEPOT_TOKENS.GallonIssueRepository) private readonly issues: GallonIssueRepository,
    @Inject(DEPOT_TOKENS.DepotRepository) private readonly depots: DepotRepository,
    private readonly config: DepotConfigService,
  ) {}

  private async requireDepot(depotId: string): Promise<void> {
    if (!(await this.depots.findById(depotId, false))) {
      throw new DepotNotFoundError();
    }
  }

  /**
   * Reject a return that hands back more empties, or refunds more deposit, than the
   * depot has outstanding. Both write paths funnel through here so neither can leak.
   *
   * ponytail: the balance is DEPOT-wide, not per-customer — it reuses the two
   * `summaryForDepot` rollups that already exist. It stops the money leak and the
   * impossible network total; move to a per-customer balance (new repo queries on
   * both ledgers) when ops needs to block one customer over-returning while the
   * depot as a whole is still in credit.
   */
  private async assertWithinOutstanding(
    depotId: string,
    quantity: number,
    depositRefunded: number,
  ): Promise<void> {
    const [issued, returned] = await Promise.all([
      this.issues.summaryForDepot(depotId),
      this.returns.summaryForDepot(depotId),
    ]);
    const gallonsLeft = issued.gallons - returned.gallons;
    if (quantity > gallonsLeft) {
      throw new GallonOverReturnError('gallons', quantity, Math.max(0, gallonsLeft));
    }
    const depositLeft = issued.depositHeld - returned.depositRefunded;
    if (depositRefunded > depositLeft) {
      throw new GallonOverReturnError('deposit', depositRefunded, Math.max(0, depositLeft));
    }
  }

  async record(depotId: string, input: RecordReturnInput, actorId: string): Promise<GallonReturnRecord> {
    await this.requireDepot(depotId);
    const depositRefunded = input.depositRefunded ?? 0;
    await this.assertWithinOutstanding(depotId, input.quantity, depositRefunded);
    return this.returns.create({
      depotId,
      customerId: input.customerId ?? null,
      orderId: null,
      quantity: input.quantity,
      condition: input.condition ?? GallonCondition.GOOD,
      depositRefunded,
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
      condition === GallonCondition.GOOD
        ? this.config.gallonDepositIdr(depotId) * input.quantity
        : 0;
    await this.assertWithinOutstanding(depotId, input.quantity, depositRefunded);
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
