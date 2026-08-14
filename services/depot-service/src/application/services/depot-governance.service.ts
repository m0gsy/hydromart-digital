import { Inject, Injectable } from '@nestjs/common';

import { ApprovalRepository } from '../ports/approval.repository';
import { DAILY_CLOSE_REPOSITORY, DailyCloseRepository } from '../ports/daily-close.repository';
import { InventoryRepository } from '../ports/inventory.repository';
import { DEPOT_TOKENS } from '../tokens';

/** The three governance figures the monthly review reads, all owned by depot-service. */
export interface DepotGovernance {
  /**
   * Approvals a PERSON decided in the window. An amount under the depot's auto-pass
   * threshold is stored APPROVED with no decider, and counting those would report a month
   * of automatic passes as a month of review.
   */
  approvalsReviewed: number;
  /**
   * NET rupiah value of the month's stock counts, signed: negative means the shelves held
   * less than the system claimed.
   *
   * Net, not the sum of the losses — an offsetting pair (one line counted short, another
   * long) is usually one mislabelled movement rather than two separate problems, and the
   * net is the number that reaches the P&L. Lines with no sell price value at 0, the same
   * rule the variance-approval emitter already uses.
   */
  opnameVarianceIdr: number;
  /**
   * Courier COD deposited minus COD expected, across every day the depot closed in the
   * window. Negative means less money arrived than the deliveries said should have.
   *
   * Only CLOSED days count: an open day has no agreed figure to differ from, so counting it
   * would read as a shortfall the moment a depot is late shutting its books.
   */
  settlementVarianceIdr: number;
  /** How many days of the window were actually closed — the denominator behind the variance. */
  daysClosed: number;
}

/**
 * "Governance" on the depot monthly review: was the paperwork done, and did the two
 * counts (stock, cash) agree with the system.
 *
 * Lives here rather than in order-service because all three numbers are depot-service's
 * own: approvals, stock movements and the daily close. order-service composes the screen
 * and owns revenue; it reads this over one internal route.
 */
@Injectable()
export class DepotGovernanceService {
  constructor(
    @Inject(DEPOT_TOKENS.ApprovalRepository) private readonly approvals: ApprovalRepository,
    @Inject(DEPOT_TOKENS.InventoryRepository) private readonly inventory: InventoryRepository,
    @Inject(DAILY_CLOSE_REPOSITORY) private readonly closes: DailyCloseRepository,
  ) {}

  async inRange(depotId: string, from: Date, to: Date): Promise<DepotGovernance> {
    const [approvalsReviewed, variances, closes] = await Promise.all([
      this.approvals.countReviewedInRange(depotId, from, to),
      this.inventory.opnameVariances(depotId, { from, to }),
      this.closes.listForDepotRange(depotId, from, to),
    ]);
    return {
      approvalsReviewed,
      opnameVarianceIdr: Math.round(
        variances.reduce((sum, v) => sum + v.delta * (v.sellPrice ?? 0), 0),
      ),
      settlementVarianceIdr: closes.reduce(
        (sum, c) => sum + (c.codDepositedIdr - c.codExpectedIdr),
        0,
      ),
      daysClosed: closes.length,
    };
  }
}
