import { Inject, Injectable } from '@nestjs/common';

import {
  InsufficientBalanceError,
  InvalidRevenueAmountError,
  InvalidWithdrawalAmountError,
} from '../../domain/errors';
import { LedgerEntryRecord, WithdrawalRecord } from '../../domain/ledger';
import { CommissionSchemeRepository } from '../ports/commission-scheme.repository';
import { LedgerRepository } from '../ports/ledger.repository';
import { WithdrawalRepository } from '../ports/withdrawal.repository';
import { PAYOUT_TOKENS } from '../tokens';
import { Page, buildPage } from '../pagination';

export interface PayoutSummary {
  availableBalance: number;
  monthRevenue: number;
  monthCommission: number;
  nextPayoutDate: string;
  recentEntries: LedgerEntryRecord[];
  recentWithdrawals: WithdrawalRecord[];
}

/** One owner's pending payout in the HQ release queue (design 6a, right panel). */
export interface PendingPayout {
  franchiseOwnerId: string;
  availableBalance: number;
  nextPayoutDate: string;
}

/** A completed order pushed by order-service (design 6a franchise revenue). */
export interface OrderRevenueInput {
  orderId: string;
  franchiseOwnerId: string;
  depotId: string | null;
  /** Order total in whole IDR; must be positive. */
  amountIdr: number;
  occurredAt?: Date;
  orderNumber?: string | null;
}

export interface OrderRevenueResult {
  recorded: boolean;
  revenue: number;
  commission: number;
  commissionPct: number;
}

@Injectable()
export class PayoutService {
  constructor(
    @Inject(PAYOUT_TOKENS.LedgerRepository) private readonly ledger: LedgerRepository,
    @Inject(PAYOUT_TOKENS.WithdrawalRepository) private readonly withdrawals: WithdrawalRepository,
    @Inject(PAYOUT_TOKENS.CommissionSchemeRepository)
    private readonly schemes: CommissionSchemeRepository,
  ) {}

  /**
   * Records one completed order as franchise revenue: a SALE_SETTLEMENT credit for the
   * full order total, and — when the depot has a commission scheme — a matching
   * COMMISSION debit at the scheme's current percentage. Both entries carry a sourceRef
   * derived from the order id, so a retried push is a no-op rather than a double credit.
   *
   * Until this existed nothing wrote the owner ledger at all: every franchise balance,
   * the depot payout card and the HQ release queue read a table only manual SQL filled.
   */
  async recordOrderRevenue(input: OrderRevenueInput): Promise<OrderRevenueResult> {
    const saleRef = `order:${input.orderId}:SALE`;
    const pct = await this.commissionPctFor(input.depotId);
    const commission = Math.round((input.amountIdr * pct) / 100);

    if (!(input.amountIdr > 0)) throw new InvalidRevenueAmountError();
    if (await this.ledger.findBySourceRef(saleRef)) {
      return { recorded: false, revenue: input.amountIdr, commission, commissionPct: pct };
    }

    const label = input.orderNumber ?? input.orderId;
    const occurredAt = input.occurredAt ?? new Date();
    await this.ledger.create({
      franchiseOwnerId: input.franchiseOwnerId,
      depotId: input.depotId,
      type: 'SALE_SETTLEMENT',
      amount: input.amountIdr,
      description: `Penjualan pesanan ${label}`,
      sourceRef: saleRef,
      occurredAt,
    });
    // Commission is stored as a debit (negative), matching how the summary reports it.
    if (commission > 0) {
      await this.ledger.create({
        franchiseOwnerId: input.franchiseOwnerId,
        depotId: input.depotId,
        type: 'COMMISSION',
        amount: -commission,
        description: `Komisi HQ ${pct}% pesanan ${label}`,
        sourceRef: `order:${input.orderId}:COMMISSION`,
        occurredAt,
      });
    }
    return { recorded: true, revenue: input.amountIdr, commission, commissionPct: pct };
  }

  /**
   * Backs out an order's revenue and commission when the sale is reversed at the counter.
   *
   * Compensating rows rather than deletions: the ledger is append-only, and a franchise
   * owner questioning their balance has to be able to see that a sale landed and was undone,
   * not find a gap where it used to be. Both rows mirror the originals exactly — including
   * the commission percentage that applied then, which is read back off the ledger rather
   * than recomputed, so a scheme change since the sale cannot alter what is reversed.
   *
   * Idempotent by sourceRef, and a no-op for an order that never posted.
   */
  async reverseOrderRevenue(orderId: string, reason: string): Promise<{ reversed: boolean }> {
    const sale = await this.ledger.findBySourceRef(`order:${orderId}:SALE`);
    if (!sale) return { reversed: false };
    if (await this.ledger.findBySourceRef(`order:${orderId}:VOID_SALE`)) {
      return { reversed: false };
    }

    const occurredAt = new Date();
    await this.ledger.create({
      franchiseOwnerId: sale.franchiseOwnerId,
      depotId: sale.depotId,
      type: 'SALE_SETTLEMENT',
      amount: -sale.amount,
      description: `Pembatalan: ${sale.description} (${reason})`,
      sourceRef: `order:${orderId}:VOID_SALE`,
      occurredAt,
    });
    const commission = await this.ledger.findBySourceRef(`order:${orderId}:COMMISSION`);
    if (commission) {
      await this.ledger.create({
        franchiseOwnerId: commission.franchiseOwnerId,
        depotId: commission.depotId,
        type: 'COMMISSION',
        // The original is a debit (negative), so giving it back is a credit.
        amount: -commission.amount,
        description: `Pembatalan: ${commission.description}`,
        sourceRef: `order:${orderId}:VOID_COMMISSION`,
        occurredAt,
      });
    }
    return { reversed: true };
  }

  /** Current scheme percentage for a depot; 0 when the depot has no scheme yet. */
  private async commissionPctFor(depotId: string | null): Promise<number> {
    if (!depotId) return 0;
    const current = await this.schemes.listCurrent();
    return current.find((s) => s.depotId === depotId)?.pct ?? 0;
  }

  async summary(ownerId: string): Promise<PayoutSummary> {
    const monthStart = startOfMonth(new Date());
    const [availableBalance, monthRevenue, monthCommission, recent, recentWithdrawals] =
      await Promise.all([
        this.ledger.balanceFor(ownerId),
        this.ledger.sumByType(ownerId, 'SALE_SETTLEMENT', monthStart),
        this.ledger.sumByType(ownerId, 'COMMISSION', monthStart),
        this.ledger.listForOwner(ownerId, 1, 8),
        this.withdrawals.listForOwner(ownerId, 5),
      ]);
    return {
      availableBalance,
      monthRevenue,
      // COMMISSION entries are stored as debits (negative); report the magnitude.
      monthCommission: Math.abs(monthCommission),
      nextPayoutDate: nextPayoutDate(new Date()).toISOString(),
      recentEntries: recent.items,
      recentWithdrawals,
    };
  }

  /**
   * HQ payout-release queue (design 6a): every owner across the network with a
   * positive available balance, highest first. Same balance math as the owner
   * summary (signed ledger sum), just network-wide instead of self-scoped.
   */
  async pendingPayouts(): Promise<PendingPayout[]> {
    const owners = await this.ledger.ownersWithBalance();
    const due = nextPayoutDate(new Date()).toISOString();
    return owners.map((o) => ({
      franchiseOwnerId: o.franchiseOwnerId,
      availableBalance: o.availableBalance,
      nextPayoutDate: due,
    }));
  }

  /**
   * One owner's available balance + next release date (HQ depot-detail payout card).
   * Same signed-ledger math as the owner summary, but readable by HQ for any owner id.
   */
  async availableForOwner(ownerId: string): Promise<PendingPayout> {
    const availableBalance = await this.ledger.balanceFor(ownerId);
    return {
      franchiseOwnerId: ownerId,
      availableBalance,
      nextPayoutDate: nextPayoutDate(new Date()).toISOString(),
    };
  }

  /**
   * HQ releases an owner's full available balance to their bank (design 6a "Rilis ke
   * bank"). Reuses the exact withdrawal path (withdrawal record + matching debit), so
   * the released amount leaves the balance the same way an owner-initiated cash-out does.
   */
  async releaseForOwner(ownerId: string): Promise<WithdrawalRecord> {
    const balance = await this.ledger.balanceFor(ownerId);
    return this.requestWithdrawal(ownerId, balance, 'Rilis HQ');
  }

  async ledgerPage(ownerId: string, page: number, limit: number): Promise<Page<LedgerEntryRecord>> {
    const { items, total } = await this.ledger.listForOwner(ownerId, page, limit);
    return buildPage(items, total, page, limit);
  }

  async requestWithdrawal(
    ownerId: string,
    amount: number,
    bankAccountRef: string,
  ): Promise<WithdrawalRecord> {
    if (!(amount > 0)) throw new InvalidWithdrawalAmountError();
    const balance = await this.ledger.balanceFor(ownerId);
    if (amount > balance) throw new InsufficientBalanceError(balance, amount);

    const reference = withdrawalReference(new Date());
    const withdrawal = await this.withdrawals.create({
      franchiseOwnerId: ownerId,
      amount,
      bankAccountRef,
      reference,
      status: 'PROCESSING',
    });
    // Post the matching debit so the balance drops immediately.
    await this.ledger.create({
      franchiseOwnerId: ownerId,
      depotId: null,
      type: 'WITHDRAWAL',
      amount: -amount,
      description: `Pencairan saldo · ${reference}`,
    });
    return withdrawal;
  }
}

function startOfMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/** 15th of this month if still ahead, else the 15th of next month. */
function nextPayoutDate(now: Date): Date {
  const day15 = new Date(now.getFullYear(), now.getMonth(), 15);
  if (now.getDate() < 15) return day15;
  return new Date(now.getFullYear(), now.getMonth() + 1, 15);
}

export function withdrawalReference(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = String(Math.floor(1000 + Math.random() * 9000));
  return `WD-${y}${m}${d}-${rand}`;
}
