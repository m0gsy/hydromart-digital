import { Inject, Injectable } from '@nestjs/common';

import { InsufficientBalanceError, InvalidWithdrawalAmountError } from '../../domain/errors';
import { LedgerEntryRecord, WithdrawalRecord } from '../../domain/ledger';
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

@Injectable()
export class PayoutService {
  constructor(
    @Inject(PAYOUT_TOKENS.LedgerRepository) private readonly ledger: LedgerRepository,
    @Inject(PAYOUT_TOKENS.WithdrawalRepository) private readonly withdrawals: WithdrawalRepository,
  ) {}

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

function withdrawalReference(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = String(Math.floor(1000 + Math.random() * 9000));
  return `WD-${y}${m}${d}-${rand}`;
}
