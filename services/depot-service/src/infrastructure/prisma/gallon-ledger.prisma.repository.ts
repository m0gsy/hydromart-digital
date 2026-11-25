import { Injectable } from '@nestjs/common';

import { GallonCondition } from '../../domain/gallon-return';
import { PrismaService } from './prisma.service';

/**
 * One depot's gallon ledger, from the issue and return books, for the AI read API (G-02, G-03,
 * G-04). `...Total` = every row created before `to`; `...InWindow` = rows created in `[from, to)`.
 * Reversal rows (a void at the counter) carry negative quantities, so plain sums are right.
 */
export interface GallonLedgerRow {
  depotId: string;
  issuedTotal: number;
  returnedTotal: number;
  depositHeldTotal: number;
  depositRefundedTotal: number;
  issuedInWindow: number;
  depositHeldInWindow: number;
  returnedGoodInWindow: number;
  returnedDamagedInWindow: number;
  depositRefundedInWindow: number;
}

const blank = (depotId: string): GallonLedgerRow => ({
  depotId,
  issuedTotal: 0,
  returnedTotal: 0,
  depositHeldTotal: 0,
  depositRefundedTotal: 0,
  issuedInWindow: 0,
  depositHeldInWindow: 0,
  returnedGoodInWindow: 0,
  returnedDamagedInWindow: 0,
  depositRefundedInWindow: 0,
});

@Injectable()
export class GallonLedgerPrismaRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** A depot with no rows at all is absent from the answer. Both books are read by (depotId, createdAt). */
  async ledger(depotIds: readonly string[], from: Date, to: Date): Promise<GallonLedgerRow[]> {
    const depotId = { in: [...depotIds] };
    const before = { depotId, createdAt: { lt: to } };
    const window = { depotId, createdAt: { gte: from, lt: to } };
    const [issuedTotal, returnedTotal, issuedWin, returnedWin] = await Promise.all([
      this.prisma.gallonIssue.groupBy({ by: ['depotId'], where: before, _sum: { quantity: true, depositHeld: true } }),
      this.prisma.gallonReturn.groupBy({ by: ['depotId'], where: before, _sum: { quantity: true, depositRefunded: true } }),
      this.prisma.gallonIssue.groupBy({ by: ['depotId'], where: window, _sum: { quantity: true, depositHeld: true } }),
      this.prisma.gallonReturn.groupBy({
        by: ['depotId', 'condition'],
        where: window,
        _sum: { quantity: true, depositRefunded: true },
      }),
    ]);
    const rows = new Map<string, GallonLedgerRow>();
    const row = (id: string): GallonLedgerRow => {
      let r = rows.get(id);
      if (!r) rows.set(id, (r = blank(id)));
      return r;
    };
    for (const g of issuedTotal) {
      row(g.depotId).issuedTotal = g._sum.quantity ?? 0;
      row(g.depotId).depositHeldTotal = Number(g._sum.depositHeld ?? 0);
    }
    for (const g of returnedTotal) {
      row(g.depotId).returnedTotal = g._sum.quantity ?? 0;
      row(g.depotId).depositRefundedTotal = Number(g._sum.depositRefunded ?? 0);
    }
    for (const g of issuedWin) {
      row(g.depotId).issuedInWindow = g._sum.quantity ?? 0;
      row(g.depotId).depositHeldInWindow = Number(g._sum.depositHeld ?? 0);
    }
    for (const g of returnedWin) {
      const r = row(g.depotId);
      if (g.condition === GallonCondition.DAMAGED) r.returnedDamagedInWindow += g._sum.quantity ?? 0;
      else r.returnedGoodInWindow += g._sum.quantity ?? 0;
      r.depositRefundedInWindow += Number(g._sum.depositRefunded ?? 0);
    }
    return [...rows.values()];
  }
}
