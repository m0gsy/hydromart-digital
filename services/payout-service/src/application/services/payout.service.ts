import { Inject, Injectable } from '@nestjs/common';
import { dayStartUtc, localDayKey, startOfLocalMonth } from '@hydromart/platform';

import {
  InsufficientBalanceError,
  InvalidRevenueAmountError,
  InvalidWithdrawalAmountError,
} from '../../domain/errors';
import { LedgerEntryRecord, WithdrawalRecord } from '../../domain/ledger';
import { CommissionSchemeRepository } from '../ports/commission-scheme.repository';
import { LedgerRepository } from '../ports/ledger.repository';
import { WithdrawalRepository } from '../ports/withdrawal.repository';
import { PayoutConfigService } from '../../config/payout-config.service';
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
    private readonly config: PayoutConfigService,
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
    // H-7: the sale and the commission it owes are one economic event, so they are written
    // as one. Separately, a crash between them left the owner credited for a sale HQ never
    // took its cut of — a discrepancy nobody sees until a month is reconciled by hand.
    await this.ledger.createAll([
      {
        franchiseOwnerId: input.franchiseOwnerId,
        depotId: input.depotId,
        type: 'SALE_SETTLEMENT',
        amount: input.amountIdr,
        description: `Penjualan pesanan ${label}`,
        sourceRef: saleRef,
        occurredAt,
      },
      // Commission is stored as a debit (negative), matching how the summary reports it.
      ...(commission > 0
        ? [
            {
              franchiseOwnerId: input.franchiseOwnerId,
              depotId: input.depotId,
              type: 'COMMISSION' as const,
              amount: -commission,
              description: `Komisi HQ ${pct}% pesanan ${label}`,
              sourceRef: `order:${input.orderId}:COMMISSION`,
              occurredAt,
            },
          ]
        : []),
    ]);
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
    const commission = await this.ledger.findBySourceRef(`order:${orderId}:COMMISSION`);
    // Same pairing rule as the forward posting (H-7): giving the sale back without giving
    // the commission back leaves the owner short by HQ's cut of a sale that never happened.
    await this.ledger.createAll([
      {
        franchiseOwnerId: sale.franchiseOwnerId,
        depotId: sale.depotId,
        type: 'SALE_SETTLEMENT',
        amount: -sale.amount,
        description: `Pembatalan: ${sale.description} (${reason})`,
        sourceRef: `order:${orderId}:VOID_SALE`,
        occurredAt,
      },
      ...(commission
        ? [
            {
              franchiseOwnerId: commission.franchiseOwnerId,
              depotId: commission.depotId,
              type: 'COMMISSION' as const,
              // The original is a debit (negative), so giving it back is a credit.
              amount: -commission.amount,
              description: `Pembatalan: ${commission.description}`,
              sourceRef: `order:${orderId}:VOID_COMMISSION`,
              occurredAt,
            },
          ]
        : []),
    ]);
    return { reversed: true };
  }

  /** Current scheme percentage for a depot; 0 when the depot has no scheme yet. */
  private async commissionPctFor(depotId: string | null): Promise<number> {
    if (!depotId) return 0;
    // One row, for this depot (audit S-15). This runs on every completed order.
    return (await this.schemes.currentForDepot(depotId))?.pct ?? 0;
  }

  async summary(ownerId: string): Promise<PayoutSummary> {
    const monthStart = startOfMonth(new Date(), this.config.businessTimeZone);
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
      nextPayoutDate: nextPayoutDate(new Date(), this.config.businessTimeZone).toISOString(),
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
    const due = nextPayoutDate(new Date(), this.config.businessTimeZone).toISOString();
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
      nextPayoutDate: nextPayoutDate(new Date(), this.config.businessTimeZone).toISOString(),
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

  async ledgerPage(
    ownerId: string,
    page: number,
    limit: number,
    cursor?: string,
  ): Promise<Page<LedgerEntryRecord>> {
    const { items, total, nextCursor } = await this.ledger.listForOwner(
      ownerId,
      page,
      limit,
      cursor,
    );
    return buildPage(items, total, page, limit, nextCursor);
  }

  async requestWithdrawal(
    ownerId: string,
    amount: number,
    bankAccountRef: string,
  ): Promise<WithdrawalRecord> {
    if (!(amount > 0)) throw new InvalidWithdrawalAmountError();

    // B-8: the balance check and the two writes happen together, serialized per owner.
    // Reading the balance here and writing afterwards let two concurrent requests both
    // pass the same check and overdraw, and a crash between the withdrawal row and its
    // debit left a PROCESSING payout with the balance untouched.
    //
    // H-13: the reference itself comes from a sequence, not a random suffix that collided
    // ~27% of days, and is stamped in the business timezone.
    const reference = withdrawalReference(
      new Date(),
      await this.withdrawals.nextReferenceSequence(),
      this.config.businessTimeZone,
    );
    const outcome = await this.withdrawals.withdrawWithDebit({
      franchiseOwnerId: ownerId,
      amount,
      bankAccountRef,
      reference,
      status: 'PROCESSING',
      description: `Pencairan saldo · ${reference}`,
    });
    if (!outcome.ok) {
      throw new InsufficientBalanceError(outcome.balance, amount);
    }
    return outcome.withdrawal;
  }
}

// H-16: both of these read the HOST's calendar (`getFullYear`/`getMonth`/`getDate`),
// which on a UTC container is not the Indonesian one — a settlement placed at 02:00 WIB
// on the 1st landed in the previous month, and the payout date flipped a day early.
function startOfMonth(now: Date, timeZone: string): Date {
  return startOfLocalMonth(now, timeZone);
}

/** 15th of this WIB month if still ahead, else the 15th of next WIB month. */
function nextPayoutDate(now: Date, timeZone: string): Date {
  const [y, m, d] = localDayKey(now, timeZone).split('-').map(Number);
  const month = d < 15 ? m : m + 1;
  const rolled = new Date(Date.UTC(y, month - 1, 15));
  // tz-ok: `rolled` was BUILT from the local y/m/d above via Date.UTC, so the slice reads
  // back the local date it was made from; dayStartUtc then turns it into the WIB instant.
  return dayStartUtc(rolled.toISOString().slice(0, 10), timeZone);
}

/**
 * `WD-<WIB date>-<counter>` (H-13, H-16).
 *
 * The suffix used to be `Math.random()` over four digits against a UNIQUE column —
 * roughly a 27% chance of a same-day collision, and a collision is a 500 on someone's
 * cash-out. `seq` comes from a Postgres sequence, so distinctness is guaranteed rather
 * than likely. The date part is the WIB calendar date; it used to be the host's local
 * date, which on a UTC container is the previous day for anything before 07:00 WIB.
 */
export function withdrawalReference(now: Date, seq: number, timeZone: string): string {
  const ymd = localDayKey(now, timeZone).replace(/-/g, '');
  return `WD-${ymd}-${String(seq).padStart(4, '0')}`;
}
