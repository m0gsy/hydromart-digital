import { Inject, Injectable } from '@nestjs/common';

import { CashDirection } from '../../domain/cashbook';
import { CashbookRepository } from '../ports/cashbook.repository';
import { PurchaseOrderRepository } from '../ports/purchase-order.repository';
import { DEPOT_TOKENS } from '../tokens';

/** What one depot spent over a window, split so the caller can see where it came from. */
export interface DepotCosts {
  /** Goods: total of the POs received in the window. */
  cogsIdr: number;
  /** Everything else that left the till in the window, excluding goods (see EXCLUDED). */
  opexIdr: number;
}

/**
 * Cashbook categories that describe buying stock, and are therefore ALREADY in `cogsIdr`.
 *
 * Two sources for one cost is how a P&L quietly counts the same rupiah twice: a depot that
 * raises a PO in the system and also writes "PO — bayar supplier" in its cash book would
 * otherwise be charged for its water once as goods and once as an expense. Matched
 * case-insensitively on the whole category, so a genuine "PORTAL" or "POS" line is not
 * swallowed by a prefix test.
 *
 * ponytail: a category string, not a foreign key — the cash book is free-text by design.
 * If ops ever type a fourth spelling, the P&L overstates cost, which is the safe direction;
 * the breakdown the caller returns is what makes that visible instead of silent.
 */
const EXCLUDED_FROM_OPEX = new Set(['po', 'pembelian', 'purchase', 'stok']);

/**
 * The cost side of a depot's month, for order-service's monthly review (S2).
 *
 * order-service owns revenue and nothing else; the goods and the till live here. It reads
 * the two separately rather than one "expenses" figure so the screen can show which is
 * which — a net-profit number nobody can decompose is a number nobody can dispute.
 */
@Injectable()
export class DepotCostsService {
  constructor(
    @Inject(DEPOT_TOKENS.PurchaseOrderRepository)
    private readonly purchaseOrders: PurchaseOrderRepository,
    @Inject(DEPOT_TOKENS.CashbookRepository) private readonly cashbook: CashbookRepository,
  ) {}

  async costsInRange(depotId: string, from: Date, to: Date): Promise<DepotCosts> {
    const [cogsIdr, entries] = await Promise.all([
      this.purchaseOrders.receivedTotalInRange(depotId, from, to),
      // The cash book already has a bounded range read; one depot's month is dozens of
      // rows, so the category filter is cheaper here than a second aggregate in SQL that
      // would have to encode the exclusion list twice.
      this.cashbook.listForDepot(depotId, { from, to }),
    ]);
    const opexIdr = entries
      .filter((e) => e.direction === CashDirection.OUT)
      .filter((e) => !EXCLUDED_FROM_OPEX.has(e.category.trim().toLowerCase()))
      .reduce((sum, e) => sum + e.amountIdr, 0);
    return { cogsIdr, opexIdr };
  }
}
