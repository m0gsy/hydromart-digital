import { Inject, Injectable, Logger } from '@nestjs/common';
import { dayStartUtc, localDayKey, startOfLocalMonth } from '@hydromart/platform';

import {
  InsufficientBalanceError,
  InvalidRevenueAmountError,
  InvalidWithdrawalAmountError,
  WithdrawalBelowMinimumError,
  WithdrawalNotFoundError,
  WithdrawalNotProcessingError,
} from '../../domain/errors';
import { LedgerEntryRecord, WithdrawalRecord } from '../../domain/ledger';
import { CommissionSchemeRepository } from '../ports/commission-scheme.repository';
import { RevenueOwner, allocate, assertRevenueOwners } from '../../domain/revenue-split';
import { CreateLedgerEntryData, LedgerRepository } from '../ports/ledger.repository';
import { WithdrawalRepository } from '../ports/withdrawal.repository';
import { PayoutConfigService } from '../../config/payout-config.service';
import { PayoutBankAccountService } from './bank-account.service';
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
  /**
   * The single owner of an older push. A depot with several owners sends `owners` instead;
   * one of the two is required, and `owners` wins when both arrive.
   */
  franchiseOwnerId?: string;
  /** Every owner of the depot as of the order's completion, with revenue shares summing to 100. */
  owners?: RevenueOwner[];
  depotId: string | null;
  /** Order total in whole IDR; must be positive. This is what the owner is CREDITED. */
  amountIdr: number;
  /**
   * What the commission is CHARGED on: the goods subtotal before discount.
   *
   * It used to be `amountIdr` — the order total, which is subtotal + ongkir − discount. So HQ
   * took a cut of the delivery fee (a cost the depot pays out again, not margin) and forfeited
   * its cut of any voucher HQ itself funded. Absent = fall back to `amountIdr`, so an
   * order-service that predates the field behaves exactly as before.
   */
  commissionBaseIdr?: number;
  occurredAt?: Date;
  orderNumber?: string | null;
}

export interface OrderRevenueResult {
  recorded: boolean;
  revenue: number;
  commission: number;
  commissionPct: number;
}

/** Is this ledger key `order:<id>:<KIND>` or `order:<id>:<KIND>:<ownerId>`? */
function isRef(ref: string, orderId: string, kind: string): boolean {
  const base = `order:${orderId}:${kind}`;
  return ref === base || ref.startsWith(`${base}:`);
}

/** The `:<ownerId>` tail of a per-owner key, or '' for the single-owner key. */
function refSuffix(ref: string, orderId: string, kind: string): string {
  return ref.slice(`order:${orderId}:${kind}`.length);
}

const isUniqueViolation = (error: unknown): boolean =>
  (error as { code?: string } | null)?.code === 'P2002';

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);

  constructor(
    @Inject(PAYOUT_TOKENS.LedgerRepository) private readonly ledger: LedgerRepository,
    @Inject(PAYOUT_TOKENS.WithdrawalRepository) private readonly withdrawals: WithdrawalRepository,
    @Inject(PAYOUT_TOKENS.CommissionSchemeRepository)
    private readonly schemes: CommissionSchemeRepository,
    private readonly config: PayoutConfigService,
    private readonly bankAccounts: PayoutBankAccountService,
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
    const owners = assertRevenueOwners(
      input.owners ??
        (input.franchiseOwnerId
          ? [{ ownerId: input.franchiseOwnerId, sharePct: 100, isPrimary: true }]
          : []),
    );
    const pct = await this.commissionPctFor(input.depotId);
    // Charged on the goods, credited on the total: ongkir is money the depot pays a courier,
    // not margin HQ has a claim on, and a voucher HQ funded must not shrink HQ's own cut.
    const commissionBase = input.commissionBaseIdr ?? input.amountIdr;
    const commission = Math.round((commissionBase * pct) / 100);

    if (!(input.amountIdr > 0)) throw new InvalidRevenueAmountError();
    // Any SALE row for this order means the push already landed, whichever shape wrote it.
    const posted = await this.ledger.findByOrder(input.orderId);
    if (posted.some((e) => isRef(e.sourceRef, input.orderId, 'SALE'))) {
      return { recorded: false, revenue: input.amountIdr, commission, commissionPct: pct };
    }

    const label = input.orderNumber ?? input.orderId;
    const occurredAt = input.occurredAt ?? new Date();
    // A sole owner keeps the original keys ("order:<id>:SALE"), so rows written before depots
    // could have several owners and rows written now are told apart by nothing but their
    // content. Several owners get one key per owner; the unique sourceRef still makes a
    // retried push raise instead of double-crediting.
    const sole = owners.length === 1;
    const revenueShares = allocate(input.amountIdr, owners);
    // The commission is worked out ONCE for the depot and then split, never recomputed from
    // each owner's rounded revenue, or the parts stop adding up to HQ's cut.
    const commissionShares = allocate(commission, owners);
    // H-7: the sale and the commission it owes are one economic event, so they are written
    // as one. Separately, a crash between them left the owner credited for a sale HQ never
    // took its cut of — a discrepancy nobody sees until a month is reconciled by hand.
    const entries: CreateLedgerEntryData[] = [];
    for (const owner of owners) {
      const suffix = sole ? '' : `:${owner.ownerId}`;
      const credit = revenueShares.get(owner.ownerId)!;
      const debit = commissionShares.get(owner.ownerId)!;
      const share = sole ? '' : ` (bagian ${owner.sharePct}%)`;
      if (credit > 0) {
        entries.push({
          franchiseOwnerId: owner.ownerId,
          depotId: input.depotId,
          type: 'SALE_SETTLEMENT',
          amount: credit,
          description: `Penjualan pesanan ${label}${share}`,
          sourceRef: `order:${input.orderId}:SALE${suffix}`,
          occurredAt,
        });
      }
      // Commission is stored as a debit (negative), matching how the summary reports it.
      if (debit > 0) {
        entries.push({
          franchiseOwnerId: owner.ownerId,
          depotId: input.depotId,
          type: 'COMMISSION',
          amount: -debit,
          description: `Komisi HQ ${pct}% pesanan ${label}${share}`,
          sourceRef: `order:${input.orderId}:COMMISSION${suffix}`,
          occurredAt,
        });
      }
    }
    try {
      await this.ledger.createAll(entries);
    } catch (error) {
      // Two pushes for one order past the findByOrder check: the unique sourceRef picked a winner.
      if (isUniqueViolation(error)) {
        return { recorded: false, revenue: input.amountIdr, commission, commissionPct: pct };
      }
      throw error;
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
    const rows = await this.ledger.findByOrder(orderId);
    const sales = rows.filter((e) => isRef(e.sourceRef, orderId, 'SALE'));
    if (sales.length === 0) return { reversed: false };
    if (rows.some((e) => isRef(e.sourceRef, orderId, 'VOID_SALE'))) return { reversed: false };

    const occurredAt = new Date();
    const commissions = rows.filter((e) => isRef(e.sourceRef, orderId, 'COMMISSION'));
    // Same pairing rule as the forward posting (H-7): giving the sale back without giving
    // the commission back leaves the owner short by HQ's cut of a sale that never happened.
    // Every row is mirrored to the owner it credited THEN and for the same amount; nothing is
    // re-derived from today's owners, who may not be the ones that were paid.
    const reversal = [
      ...sales.map((sale) => ({
        franchiseOwnerId: sale.franchiseOwnerId,
        depotId: sale.depotId,
        type: 'SALE_SETTLEMENT' as const,
        amount: -sale.amount,
        description: `Pembatalan: ${sale.description} (${reason})`,
        sourceRef: `order:${orderId}:VOID_SALE${refSuffix(sale.sourceRef, orderId, 'SALE')}`,
        occurredAt,
      })),
      ...commissions.map((commission) => ({
        franchiseOwnerId: commission.franchiseOwnerId,
        depotId: commission.depotId,
        type: 'COMMISSION' as const,
        // The original is a debit (negative), so giving it back is a credit.
        amount: -commission.amount,
        description: `Pembatalan: ${commission.description}`,
        sourceRef: `order:${orderId}:VOID_COMMISSION${refSuffix(commission.sourceRef, orderId, 'COMMISSION')}`,
        occurredAt,
      })),
    ];
    try {
      await this.ledger.createAll(reversal);
    } catch (error) {
      // A concurrent void of the same order won the unique sourceRef: already reversed.
      if (isUniqueViolation(error)) return { reversed: false };
      throw error;
    }
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
   *
   * CA-2-63: it used to record the destination as the literal string `'Rilis HQ'`.
   *
   * `bankAccountRef` is the column the schema describes as "Masked destination shown in the
   * UI, e.g. BCA ···· 4821" — the one field on the record that answers "where did my money
   * go". Filling it with the name of the BUTTON meant an owner asking that question, or an
   * accountant reconciling a transfer against a bank statement, had nothing to match on:
   * every HQ release in the table read identically.
   *
   * The account comes from the caller when HQ names one, and otherwise from the owner's own
   * most recent cash-out — the account they have already been paid to, which is the honest
   * default and saves re-typing one that is already on file. When there is neither, the
   * release is REFUSED rather than recorded against a placeholder: money leaves the balance
   * here, and a debit whose destination is unknown is the thing this row exists to prevent.
   */
  /*
   * PYO-3 (owner decision 2026-09-17): the destination is the owner's VERIFIED account on
   * file, never a string travelling with the request and never "whatever the last one said".
   * `bankAccountRef` is gone from the caller's hands entirely.
   */
  async releaseForOwner(ownerId: string): Promise<WithdrawalRecord> {
    const balance = await this.ledger.balanceFor(ownerId);
    return this.requestWithdrawal(ownerId, balance);
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
    idempotencyKey?: string,
  ): Promise<WithdrawalRecord> {
    if (!(amount > 0)) throw new InvalidWithdrawalAmountError();
    if (amount < this.config.minWithdrawalIdr) {
      throw new WithdrawalBelowMinimumError(this.config.minWithdrawalIdr);
    }
    // PYO-3: the destination comes from the verified account, not from the request body.
    const bankAccountRef = await this.bankAccounts.verifiedDestination(ownerId);

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
      idempotencyKey: idempotencyKey ?? null,
    });
    if (!outcome.ok) {
      throw new InsufficientBalanceError(outcome.balance, amount);
    }
    return outcome.withdrawal;
  }

  /** Withdrawals the bank has not answered for yet — the HQ release queue. */
  listProcessingWithdrawals(limit = 100): Promise<WithdrawalRecord[]> {
    return this.withdrawals.listProcessing(limit);
  }

  /**
   * The way out of PROCESSING, which until now did not exist on either side of the money.
   *
   * `WithdrawalStatus` has carried PAID and FAILED since the first migration and the schema
   * spells out what FAILED means — "a compensating credit re-posts to the ledger" — but no
   * code in this service ever wrote either value. So every payout ever requested sat
   * PROCESSING forever while its debit had already left the balance: an owner could not tell
   * a transfer that cleared from one that was rejected, and a rejected one silently kept
   * their money.
   *
   * PAID is a status change and nothing else — the debit at request time was the money
   * leaving. FAILED re-credits, in the repository's own transaction.
   */
  async settleWithdrawal(
    id: string,
    status: 'PAID' | 'FAILED',
    actorId: string,
    reason?: string,
  ): Promise<WithdrawalRecord> {
    const outcome = await this.withdrawals.settle({
      id,
      status,
      reversal: {
        sourceRef: `withdrawal-reversal:${id}`,
        description: reason?.trim()
          ? `Pencairan gagal · ${reason.trim()}`
          : 'Pencairan gagal, saldo dikembalikan',
      },
    });
    if (!outcome.ok) {
      if (outcome.reason === 'NOT_FOUND') throw new WithdrawalNotFoundError();
      throw new WithdrawalNotProcessingError(outcome.status);
    }
    this.logger.log(`Withdrawal ${outcome.withdrawal.reference} marked ${status} by ${actorId}`);
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
