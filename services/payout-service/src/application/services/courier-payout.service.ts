import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { localHour, localMonthKey, startOfLocalMonth } from '@hydromart/platform';

import { computeEarning, tiersReached, tiersValid } from '../../domain/courier-earning';
import {
  InsufficientBalanceError,
  InvalidEarningRuleError,
  InvalidWithdrawalAmountError,
} from '../../domain/errors';
import {
  CourierEarningRuleRecord,
  CourierEarningsRow,
  CourierLedgerEntryRecord,
  CourierLedgerRepository,
  CreateEarningRuleData,
} from '../ports/courier-ledger.repository';
import {
  CourierWithdrawalRecord,
  CourierWithdrawalRepository,
} from '../ports/courier-withdrawal.repository';
import { PAYOUT_TOKENS } from '../tokens';
import { Page, buildPage } from '../pagination';
import { PayoutConfigService } from '../../config/payout-config.service';
import { withdrawalReference } from './payout.service';

/** Raw delivery-completion event pushed by delivery-service (design 6b earning). */
export interface DeliveryCompletedEvent {
  courierId: string;
  depotId: string | null;
  deliveryId: string;
  /** ISO timestamp the delivery completed. */
  deliveredAt: string;
  /** Whether the delivery beat its SLA (decided by delivery-service). */
  onTime: boolean;
}

export interface CourierEarningsSummary {
  availableBalance: number;
  monthEarnings: number;
  recentEntries: CourierLedgerEntryRecord[];
  recentWithdrawals: CourierWithdrawalRecord[];
}

@Injectable()
export class CourierPayoutService {
  private readonly logger = new Logger(CourierPayoutService.name);

  constructor(
    @Inject(PAYOUT_TOKENS.CourierLedgerRepository)
    private readonly ledger: CourierLedgerRepository,
    @Inject(PAYOUT_TOKENS.CourierWithdrawalRepository)
    private readonly withdrawals: CourierWithdrawalRepository,
    private readonly config: PayoutConfigService,
  ) {}

  /**
   * Records a courier's pay for one completed delivery. Idempotent: the delivery id
   * is the source ref, so an at-least-once push re-posts nothing. Returns null when no
   * earning rule is configured (the delivery still happened — never throw upstream).
   */
  async recordDeliveryEarning(
    event: DeliveryCompletedEvent,
  ): Promise<CourierLedgerEntryRecord | null> {
    const sourceRef = `earning:${event.deliveryId}`;
    const existing = await this.ledger.findBySourceRef(sourceRef);
    if (existing) {
      return existing;
    }

    const rule = await this.ledger.currentRule(event.depotId);
    if (!rule) {
      this.logger.warn(`No courier earning rule for depot ${event.depotId}; skipped ${sourceRef}`);
      return null;
    }

    const deliveredAt = new Date(event.deliveredAt);
    // H-16: was `getUTCHours() + 7`, a hardcoded offset. The zone is configuration now,
    // so peak-hour pay cannot disagree with every other day boundary in the platform.
    const hour = localHour(deliveredAt, this.config.businessTimeZone);
    const amount = computeEarning(rule, { hour, onTime: event.onTime });

    const entry = await this.ledger.create({
      courierId: event.courierId,
      depotId: event.depotId,
      type: 'EARNING',
      amount,
      description: event.onTime ? 'Ongkos antar (tepat waktu)' : 'Ongkos antar',
      sourceRef,
      occurredAt: deliveredAt,
    });
    this.logger.log(`Courier ${event.courierId} earned ${amount} for delivery ${event.deliveryId}`);
    await this.awardIncentives(event, rule, deliveredAt);
    return entry;
  }

  /**
   * Posts one INCENTIVE credit per monthly tier the courier has reached, keyed
   * courier/rule/month/tier so a re-pushed or out-of-order delivery pays each rung once.
   */
  private async awardIncentives(
    event: DeliveryCompletedEvent,
    rule: CourierEarningRuleRecord,
    deliveredAt: Date,
  ): Promise<void> {
    if (rule.tiers.length === 0) return;
    // C2: the incentive month is the COURIER's month, in the business zone. The old
    // `startOfMonth` read the server's calendar — UTC on the box — so a delivery made at
    // 02:00 WIB on the 1st counted against the previous month's tally, and the same rung
    // could be paid twice or skipped entirely once the real month's deliveries arrived.
    const tz = this.config.businessTimeZone;
    const monthStart = startOfLocalMonth(deliveredAt, tz);
    // Counted AT THIS DEPOT. The ladder belongs to the depot's earning rule and the depot pays
    // the bonus, so a courier's deliveries elsewhere must not walk it up: 30 at depot A plus 30
    // at depot B used to fire depot B's 50-delivery rung on the 50th combined delivery.
    // A delivery with no depot on it cannot be counted per depot; it falls back to the
    // courier-wide tally, which is what the whole ladder used to be.
    const scope = event.depotId ?? undefined;
    const delivered = await this.ledger.countByType(event.courierId, 'EARNING', monthStart, scope);
    const month = localMonthKey(deliveredAt, tz);
    for (const tier of tiersReached(rule.tiers, delivered)) {
      // NOT keyed by rule id. `applyEarningRule` appends a row rather than editing one, so the
      // rule in force gets a fresh id every time HQ touches the ladder — and a key carrying it
      // made every rung already paid this month look unpaid, paying it again on the courier's
      // next delivery. What must happen once is "this courier, this month, this rung", whoever
      // configured it: a mid-month change to the bonus AMOUNT leaves rungs already paid alone,
      // which is also the honest answer (the courier earned them under the old ladder).
      // Keyed by depot too, now that the rungs are counted per depot: the same courier can
      // legitimately reach depot A's 50-rung and depot B's, and each depot pays its own.
      const sourceRef = `incentive:${event.courierId}:${scope ?? 'nodepot'}:${month}:${tier.deliveries}`;
      if (await this.ledger.findBySourceRef(sourceRef)) continue;
      await this.ledger.create({
        courierId: event.courierId,
        depotId: event.depotId,
        type: 'INCENTIVE',
        amount: tier.bonus,
        description: `Bonus ${tier.deliveries} pengiriman`,
        sourceRef,
        occurredAt: deliveredAt,
      });
      this.logger.log(`Courier ${event.courierId} hit tier ${tier.deliveries} (${month})`);
    }
  }

  /** The earning rule in force for a depot — the courier's goal/tier config (design 6b). */
  effectiveRule(depotId: string | null): Promise<CourierEarningRuleRecord | null> {
    return this.ledger.currentRule(depotId);
  }

  /*
   * Remove a rule that has NOT taken effect yet.
   *
   * The table is append-only so historical pay stays reproducible, and that stays true:
   * a rule whose date has arrived has priced real deliveries, and deleting it would make
   * past payslips unexplainable. So this refuses those, by date, on the server.
   *
   * What it does allow is undoing a mistake before it costs anything. A rule dated in the
   * future has paid nobody, and until now there was no way to remove one at all — a typo
   * in the year was permanent, and (before the query fix alongside this) also immediately
   * live. To change a rule that IS in force, apply a new one from today; that is what
   * effective dating is for, and the screen now says so.
   */
  async deleteScheduledRule(id: string, asOf: Date = new Date()): Promise<void> {
    const rule = await this.ledger.findRule(id);
    if (!rule) throw new NotFoundException(`Earning rule ${id} not found`);
    if (rule.effectiveDate.getTime() <= asOf.getTime()) {
      throw new ConflictException(
        'This rule has already taken effect and may have priced real deliveries. Apply a new rule from today to change what couriers earn; history stays as it was.',
      );
    }
    await this.ledger.deleteRule(id);
    this.logger.log(
      `Deleted scheduled earning rule ${id} (was effective ${rule.effectiveDate.toISOString()})`,
    );
  }

  /**
   * What each courier at a depot was actually paid over a window (E-1).
   *
   * This exists so the depot's commission REPORT can read the payer's own numbers.
   * delivery-service used to answer that report from `delivered × courierRatePerDeliveryIdr`,
   * a flat rate configured in a different service from the one that pays — so a manager's
   * report and a courier's ledger stated two different amounts for the same work, and both
   * were live.
   */
  async earningsByDepot(depotId: string, from: Date, to: Date): Promise<CourierEarningsRow[]> {
    return this.ledger.earningsByDepot(depotId, from, to);
  }

  /**
   * Records a COD deposit shortfall as a debit on the courier's ledger (design 2d, slice
   * 13). Idempotent by settlement id: a retried verify posts nothing new. Amount is the
   * positive shortfall magnitude; stored as a negative CASH_VARIANCE entry.
   */
  async recordCashVariance(event: {
    courierId: string;
    depotId: string | null;
    settlementId: string;
    amount: number;
  }): Promise<CourierLedgerEntryRecord> {
    const sourceRef = `variance:${event.settlementId}`;
    const existing = await this.ledger.findBySourceRef(sourceRef);
    if (existing) return existing;
    const entry = await this.ledger.create({
      courierId: event.courierId,
      depotId: event.depotId,
      type: 'CASH_VARIANCE',
      amount: -Math.abs(event.amount),
      description: 'Selisih kurang setoran COD',
      sourceRef,
    });
    this.logger.log(
      `Courier ${event.courierId} charged ${event.amount} for settlement ${event.settlementId}`,
    );
    return entry;
  }

  async summary(courierId: string): Promise<CourierEarningsSummary> {
    // Same boundary as the incentive tally above: "this month's earnings" on the courier's
    // screen must mean the month they are living in, not the server's.
    const monthStart = startOfLocalMonth(new Date(), this.config.businessTimeZone);
    const [availableBalance, monthEarnings, recent, recentWithdrawals] = await Promise.all([
      this.ledger.balanceFor(courierId),
      this.ledger.sumByType(courierId, 'EARNING', monthStart),
      this.ledger.listForCourier(courierId, 1, 8),
      this.withdrawals.listForCourier(courierId, 5),
    ]);
    return { availableBalance, monthEarnings, recentEntries: recent.items, recentWithdrawals };
  }

  /**
   * Courier cashes out available balance to their bank (design 2c). Same guard + matching
   * debit as the franchise path: reject non-positive or over-balance, record the withdrawal,
   * then post a WITHDRAWAL debit so the balance drops immediately.
   */
  async requestWithdrawal(
    courierId: string,
    amount: number,
    bankAccountRef: string,
  ): Promise<CourierWithdrawalRecord> {
    if (!(amount > 0)) throw new InvalidWithdrawalAmountError();

    // B-8/B-10: balance check and both writes in one serialized step, and the debit now
    // carries a sourceRef. Previously the check ran on its own connection and the two
    // rows were written independently — an overdraft was reachable by sending two
    // requests together, and a crash between the writes left a PROCESSING payout with
    // the balance untouched.
    //
    // H-13: the reference comes from a sequence stamped in the business timezone.
    const reference = withdrawalReference(
      new Date(),
      await this.withdrawals.nextReferenceSequence(),
      this.config.businessTimeZone,
    );
    const outcome = await this.withdrawals.withdrawWithDebit({
      courierId,
      amount,
      bankAccountRef,
      reference,
      status: 'PROCESSING',
      description: `Penarikan saldo · ${reference}`,
    });
    if (!outcome.ok) {
      throw new InsufficientBalanceError(outcome.balance, amount);
    }
    return outcome.withdrawal;
  }

  async withdrawalHistory(courierId: string, limit = 20): Promise<CourierWithdrawalRecord[]> {
    return this.withdrawals.listForCourier(courierId, limit);
  }

  async ledgerPage(
    courierId: string,
    page: number,
    limit: number,
  ): Promise<Page<CourierLedgerEntryRecord>> {
    const { items, total } = await this.ledger.listForCourier(courierId, page, limit);
    return buildPage(items, total, page, limit);
  }

  /** Every earning rule, newest effective first (rule editor, design 6b). */
  listEarningRules(): Promise<CourierEarningRuleRecord[]> {
    return this.ledger.listRules();
  }

  /**
   * Append a new effective-dated earning rule (network default when depotId is null).
   * Rules are never edited in place — a new row supersedes the old one, so pay for past
   * deliveries stays reproducible. Rejects a peak window that would never fire.
   */
  async applyEarningRule(data: CreateEarningRuleData): Promise<CourierEarningRuleRecord> {
    const { baseFare, peakBonus, onTimeBonus, peakStartHour, peakEndHour, monthlyTarget } = data;
    if ([baseFare, peakBonus, onTimeBonus, monthlyTarget].some((v) => v < 0)) {
      throw new InvalidEarningRuleError();
    }
    if (!tiersValid(data.tiers)) throw new InvalidEarningRuleError();
    const hoursValid =
      Number.isInteger(peakStartHour) &&
      Number.isInteger(peakEndHour) &&
      peakStartHour >= 0 &&
      peakEndHour <= 24 &&
      peakStartHour < peakEndHour;
    if (!hoursValid) throw new InvalidEarningRuleError();
    return this.ledger.createRule(data);
  }
}
