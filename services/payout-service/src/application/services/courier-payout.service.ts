import { Inject, Injectable, Logger } from '@nestjs/common';

import { computeEarning } from '../../domain/courier-earning';
import {
  InsufficientBalanceError,
  InvalidEarningRuleError,
  InvalidWithdrawalAmountError,
} from '../../domain/errors';
import {
  CourierEarningRuleRecord,
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

// Indonesia runs one business timezone; peak hours are WIB (UTC+7). ponytail: fixed
// offset, swap for a per-depot tz only if depots ever span timezones.
const WIB_OFFSET_HOURS = 7;

@Injectable()
export class CourierPayoutService {
  private readonly logger = new Logger(CourierPayoutService.name);

  constructor(
    @Inject(PAYOUT_TOKENS.CourierLedgerRepository)
    private readonly ledger: CourierLedgerRepository,
    @Inject(PAYOUT_TOKENS.CourierWithdrawalRepository)
    private readonly withdrawals: CourierWithdrawalRepository,
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
    const hour = (deliveredAt.getUTCHours() + WIB_OFFSET_HOURS) % 24;
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
    return entry;
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
    const monthStart = startOfMonth(new Date());
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
    const balance = await this.ledger.balanceFor(courierId);
    if (amount > balance) throw new InsufficientBalanceError(balance, amount);

    const reference = withdrawalReference(new Date());
    const withdrawal = await this.withdrawals.create({
      courierId,
      amount,
      bankAccountRef,
      reference,
      status: 'PROCESSING',
    });
    await this.ledger.create({
      courierId,
      depotId: null,
      type: 'WITHDRAWAL',
      amount: -amount,
      description: `Penarikan saldo · ${reference}`,
    });
    return withdrawal;
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
    const { baseFare, peakBonus, onTimeBonus, peakStartHour, peakEndHour } = data;
    if ([baseFare, peakBonus, onTimeBonus].some((v) => v < 0)) throw new InvalidEarningRuleError();
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

function startOfMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}
