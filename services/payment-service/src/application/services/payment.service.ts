import { createHmac, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { money, recordAuditEvent } from '@hydromart/platform';

import {
  CashShortError,
  GatewayUnavailableError,
  InvalidPaymentTransitionError,
  InvalidWebhookSignatureError,
  PaymentAlreadyExistsError,
  PaymentAmountMismatchError,
  PaymentNotFoundError,
  PaymentNotRefundableError,
  RefundNotPendingError,
} from '../../domain/errors';
import {
  EXPIRABLE_PENDING_METHODS,
  PaymentMethod,
  PaymentStatus,
  RefundApproval,
  canTransition,
  computeChange,
  isOnlineMethod,
  isRefundable,
  isWebhookFresh,
  webhookSigningPayload,
} from '../../domain/payment';
import { PaymentConfigService } from '../../config/payment-config.service';
import { Page, buildPage } from '../pagination';
import {
  CashCollectedSummary,
  OrderCashRow,
  CreatePaymentData,
  DateRange,
  PaymentRecord,
  PaymentRepository,
  PaymentStatusPatch,
  UnsettledMethodAggregate,
} from '../ports/payment.repository';
import { PaymentGatewayPort } from '../ports/payment-gateway.port';
import { OrderCoordinationPort } from '../ports/order-coordination.port';
import { CASHIER_SHIFT_PORT, CashierShiftPort } from '../ports/cashier-shift.port';
import { PAYMENT_TOKENS } from '../tokens';

export interface InitiatePaymentInput {
  orderId: string;
  method: PaymentMethod;
  amount: number;
  /** Counter sale: the buyer is at the depot, so no courier hands anything over. */
  atCounter?: boolean;
  /** Depot whose drawer takes the money. Counter sales only. */
  depotId?: string | null;
  /**
   * C2: the cashier's own bearer, used SERVER-side to look up which drawer they have open.
   * Never the shift id itself — a body that could name the shift could name somebody
   * else's, and this column exists precisely so the cash is answerable to a named person.
   */
  authorization?: string;
}

export interface ListPaymentsInput {
  orderId?: string;
  status?: PaymentStatus;
  page?: number;
  limit?: number;
  /** Keyset cursor from the previous page's `nextCursor` (audit Q-16). */
  cursor?: string;
}

/** Provider webhook event mapped to a settlement outcome. */
export type WebhookEvent = 'PAID' | 'FAILED';

/**
 * K2.2 — one run of the stale-payment sweep, in the shape J7 gave every sweep.
 *
 * `ok` is false only when the round failed at something and expired nothing;
 * `scripts/scheduler/sweep.sh` reads it and withholds the scheduler heartbeat.
 */
export interface PaymentExpirySweepResult {
  expired: number;
  failed: number;
  ok: boolean;
}

export interface WebhookPayload {
  reference: string;
  event: WebhookEvent;
  /** Epoch milliseconds when the provider signed it — inside the HMAC, so it cannot be
   *  edited to refresh a captured request (Q-15). */
  timestamp: number;
  signature: string;
}

/** A refund-queue row plus the order's human-readable number (§G-3). */
export type RefundQueueRow = PaymentRecord & { orderNumber: string | null };

@Injectable()
export class PaymentService {
  /**
   * K2.9: how far back a queued COD may claim to have been collected.
   *
   * Matches the offline queue's own retention on the device — past that the job is dropped
   * there, so a `capturedAt` older than this did not come from a job that was waiting, it
   * came from a clock that is wrong.
   */
  private static readonly OFFLINE_CAPTURE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

  /** Clamp a claimed capture time into [now - window, now]; anything else yields now. */
  private static settledAt(capturedAt?: Date): Date {
    const now = new Date();
    if (!capturedAt || Number.isNaN(capturedAt.getTime())) return now;
    const ms = capturedAt.getTime();
    if (ms > now.getTime()) return now;
    if (now.getTime() - ms > PaymentService.OFFLINE_CAPTURE_WINDOW_MS) return now;
    return capturedAt;
  }

  /**
   * K2.2: rows per sweep tick. The backlog on a stack that never had this sweep is
   * unbounded by definition, so the first run must not try to walk all of it in one
   * request. Hourly at 500 clears a five-figure backlog in a day and steady state never
   * comes near it.
   */
  private static readonly EXPIRY_SWEEP_LIMIT = 500;
  private static readonly MAX_LIMIT = 100;
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @Inject(PAYMENT_TOKENS.PaymentRepository) private readonly payments: PaymentRepository,
    @Inject(PAYMENT_TOKENS.PaymentGateway) private readonly gateway: PaymentGatewayPort,
    @Inject(PAYMENT_TOKENS.OrderCoordination)
    private readonly orderCoordination: OrderCoordinationPort,
    private readonly config: PaymentConfigService,
    // C2: optional so a deployment that has not wired it keeps taking payments rather than
    // refusing them. Unwired means every counter payment stays unattributed, and the
    // reader's window rule still answers for it.
    @Optional()
    @Inject(CASHIER_SHIFT_PORT)
    private readonly cashierShift?: CashierShiftPort,
  ) {}

  /**
   * Starts a payment for an order. At most one active (PENDING/PAID) payment may
   * exist per order. Online methods get a gateway charge + reference; cash and
   * bank transfer are settled out-of-band and remain PENDING until confirmed.
   */
  async initiate(customerId: string, input: InitiatePaymentInput): Promise<PaymentRecord> {
    const active = await this.payments.findActiveByOrder(input.orderId);
    if (active) {
      throw new PaymentAlreadyExistsError();
    }

    const amount = money(input.amount);
    // SEC-1: the amount is client-supplied. Validate it against the authoritative order
    // total before charging so a tampered price can't be paid. getOrderTotal returns null
    // only when coordination is disabled (dev); a configured-but-unreachable order-service
    // throws (fail closed) — we never create a payment at an unvalidated amount.
    const orderTotal = await this.orderCoordination.getOrderTotal(input.orderId);
    if (orderTotal !== null && money(orderTotal) !== amount) {
      throw new PaymentAmountMismatchError(money(orderTotal), amount);
    }

    const base: CreatePaymentData = {
      orderId: input.orderId,
      customerId,
      method: input.method,
      amount,
      reference: null,
      instruction: this.offlineInstruction(input.method, input.atCounter ?? false),
      gatewayData: null,
      // Only a counter sale names a depot: that drawer is answerable for this cash at
      // shift close. A delivery order's payment belongs to the order's depot, not a till.
      depotId: input.depotId ?? null,
      // C2: and WHICH drawer. `sumDepotCash` used to sum a depot over a time window with no
      // cashier dimension, so two shifts open at once each claimed the whole window.
      cashierShiftId: await this.resolveShift(input),
    };

    if (!isOnlineMethod(input.method)) {
      return this.payments.create(base);
    }

    /*
     * O5: refuse a gateway method BEFORE it costs a row.
     *
     * E-wallet and virtual account are the only methods that leave the building, and
     * `PAYMENT_GATEWAY_BASE_URL` is empty in production — so both are buttons that cannot
     * succeed. The refusal already existed, but it happened AFTER the payment row was
     * written: the adapter threw, the row was marked FAILED, and every attempt left one
     * behind on the order. Same answer to the customer, one less piece of debris in the
     * ledger, and one less "failed payment" for a depot to explain.
     */
    if (!this.gateway.isConfigured()) {
      this.logger.warn(`${input.method} refused: no payment gateway configured`);
      throw new GatewayUnavailableError();
    }

    // Online method: create the record first so the gateway can reference it,
    // then attach the charge. Fail closed if the gateway is unreachable.
    const payment = await this.payments.create(base);
    try {
      const charge = await this.gateway.createCharge({
        method: input.method,
        amount,
        orderId: input.orderId,
        paymentId: payment.id,
      });
      return this.payments.update(payment.id, {
        status: PaymentStatus.PENDING,
        reference: charge.reference,
        instruction: charge.instruction,
        gatewayData: charge.raw,
      });
    } catch (error) {
      this.logger.error(`Gateway charge failed for ${payment.id}: ${(error as Error).message}`);
      await this.payments.update(payment.id, {
        status: PaymentStatus.FAILED,
        failedAt: new Date(),
      });
      throw new GatewayUnavailableError();
    }
  }

  async getForCustomer(customerId: string, id: string): Promise<PaymentRecord> {
    const payment = await this.payments.findById(id);
    if (!payment || payment.customerId !== customerId) {
      throw new PaymentNotFoundError();
    }
    return payment;
  }

  /**
   * K2.1b: attach the payer's receipt to their own payment.
   *
   * Scoped through `getForCustomer`, which answers a stranger with PaymentNotFound rather
   * than Forbidden — telling somebody "that payment exists but is not yours" already tells
   * them it exists.
   *
   * Any status is allowed. A customer who transferred and only found the receipt after the
   * depot had already confirmed still has evidence worth keeping, and a payment that later
   * goes into dispute is exactly when somebody goes looking for it.
   */
  async attachProof(customerId: string, id: string, proofUrl: string): Promise<PaymentRecord> {
    await this.getForCustomer(customerId, id);
    return this.payments.attachProof(id, proofUrl);
  }

  async getAny(id: string): Promise<PaymentRecord> {
    const payment = await this.payments.findById(id);
    if (!payment) {
      throw new PaymentNotFoundError();
    }
    return payment;
  }

  async listForCustomer(
    customerId: string,
    input: ListPaymentsInput,
  ): Promise<Page<PaymentRecord>> {
    return this.search({ ...input, customerId });
  }

  async listAll(input: ListPaymentsInput): Promise<Page<PaymentRecord>> {
    return this.search(input);
  }

  /**
   * Customers with `minRefunds` or more settled refunds in a window (fraud scan, 15b).
   *
   * The bound is on the ANSWER, not on the query: a network-wide scan is the point, and
   * the filter is what keeps the result a review queue rather than a customer list.
   */
  async refundCountsByCustomer(
    from: Date,
    to: Date,
    minRefunds: number,
  ): Promise<{ customerId: string; refunds: number; amountIdr: number }[]> {
    return this.payments.refundCountsByCustomer(from, to, Math.max(2, minRefunds));
  }

  /**
   * The payments recorded against a set of orders — the depot reconciliation read.
   *
   * Duplicate ids are collapsed so a caller cannot spend its bound twice on one order; the
   * DTO caps the set, and this is the only place that decides what "the same order twice"
   * means.
   */
  async listForOrders(orderIds: string[]): Promise<PaymentRecord[]> {
    return this.payments.findByOrderIds([...new Set(orderIds)]);
  }

  /**
   * Manually mark a payment settled (e.g. cash received on delivery). For COD the
   * driver may pass the cash handed over (design 7a): the change owed back is
   * computed and recorded, and underpayment is rejected (a COD payment cannot
   * settle short).
   */
  /**
   * The open shift of whoever is ringing this up, or null.
   *
   * Only for a counter sale: a delivery payment belongs to no till. Fails soft — see
   * `CashierShiftPort`. Optional dependency so a deployment that has not wired it keeps
   * taking payments rather than refusing them.
   */
  private async resolveShift(input: InitiatePaymentInput): Promise<string | null> {
    if (!input.depotId || !input.authorization || !this.cashierShift) return null;
    return this.cashierShift.openShiftId(input.depotId, input.authorization);
  }

  /**
   * K2.9: `capturedAt` is when the courier actually took the notes, not when the phone
   * managed to say so.
   *
   * COD confirmation now goes through the offline capture queue, because a courier in a
   * dead spot could previously queue the PROOF that they delivered and not the CASH they
   * had just been handed. That makes the sync time wrong for the one thing that reads
   * `paidAt`: shift close sums a depot's PAID cash over the shift WINDOW, so money taken at
   * 16:00 and synced at 19:00 would be booked to whichever drawer happened to be open at
   * 19:00 — one cashier short, another over, for money neither of them touched.
   *
   * Clamped, not trusted, the same rule the other offline jobs already follow: never later
   * than now (a device clock running fast must not book cash into the future) and never
   * older than the queue's own retention window (anything past that is a stale device, not
   * a late sync). Outside those, the sync time stands.
   */
  async confirm(
    id: string,
    changedBy: string,
    cashReceived?: number,
    capturedAt?: Date,
  ): Promise<PaymentRecord> {
    const payment = await this.getAny(id);
    this.assertTransition(payment.status, PaymentStatus.PAID);
    const patch: PaymentStatusPatch = {
      status: PaymentStatus.PAID,
      paidAt: PaymentService.settledAt(capturedAt),
    };
    if (cashReceived != null) {
      const received = money(cashReceived);
      const change = computeChange(payment.amount, received);
      if (change < 0) {
        throw new CashShortError(payment.amount, received);
      }
      patch.cashReceived = received;
      patch.changeGiven = change;
    }
    this.logger.log(`Payment ${id} confirmed PAID by ${changedBy}`);
    const updated = await this.payments.update(id, patch);
    // A settled payment confirms the order (CREATED→CONFIRMED). Fail-open, idempotent.
    await this.orderCoordination.confirmPaid(updated.orderId);
    return updated;
  }

  async fail(id: string, changedBy: string): Promise<PaymentRecord> {
    const payment = await this.getAny(id);
    this.assertTransition(payment.status, PaymentStatus.FAILED);
    this.logger.log(`Payment ${id} marked FAILED by ${changedBy}`);
    return this.payments.update(id, { status: PaymentStatus.FAILED, failedAt: new Date() });
  }

  /**
   * K2.2 — a payment nobody completed has to stop being live eventually.
   *
   * There was no sweep and no cron line, so a PENDING transfer or QRIS row stayed PENDING
   * for as long as the database did. That is not merely untidy: `initiate` refuses to
   * start a payment while an active (PENDING/PAID) one exists, and a partial UNIQUE index
   * enforces it, so the abandoned attempt locks its order out of EVERY other payment
   * method — permanently, with nothing anywhere saying why. Measured on the live stack
   * before this was written: 52 non-cash PENDING rows, the oldest created 26 July.
   *
   * CASH is excluded by `EXPIRABLE_PENDING_METHODS` and must stay excluded — a COD payment
   * is PENDING by design until the courier confirms at the door.
   *
   * Bounded per tick, and the write is a compare-and-set on PENDING: a customer who pays
   * in the same instant the sweep reaches their row wins, because their confirm moved the
   * status and `updateIfStatus` then declines to overwrite it.
   */
  async expireStalePending(now: Date): Promise<PaymentExpirySweepResult> {
    const hours = this.config.pendingPaymentTtlHours;
    // Zero is the kill switch: it restores exactly what this service did before, which is
    // nothing. Reported as a clean round rather than a failure — a switch somebody turned
    // off on purpose is not an outage.
    if (hours <= 0) return { expired: 0, failed: 0, ok: true };

    const before = new Date(now.getTime() - hours * 3_600_000);
    const stale = await this.payments.findStalePending(
      before,
      EXPIRABLE_PENDING_METHODS,
      PaymentService.EXPIRY_SWEEP_LIMIT,
    );

    let expired = 0;
    let failed = 0;
    for (const payment of stale) {
      try {
        const moved = await this.payments.updateIfStatus(payment.id, [PaymentStatus.PENDING], {
          status: PaymentStatus.FAILED,
          failedAt: now,
        });
        if (moved) expired += 1;
      } catch (error) {
        // One row's failure is its own; the rest of the batch still has to run. Counted,
        // because J7: a round that could not expire anything must not look like a round
        // with nothing to expire.
        failed += 1;
        this.logger.warn(
          `Expiring stale payment ${payment.id} failed: ${(error as Error).message}`,
        );
      }
    }
    if (expired > 0) {
      this.logger.log(`Expired ${expired} stale PENDING payment(s) older than ${hours}h`);
    }
    return { expired, failed, ok: failed === 0 || expired > 0 };
  }

  /**
   * BR: an online-paid order that is cancelled must be refunded. Refunds strictly
   * above the HQ threshold (feature 14a) do NOT settle here — they park in the
   * PENDING approval queue and settle only once HQ approves. At or below it, the
   * refund goes through immediately (unchanged behaviour).
   */
  async refund(id: string, changedBy: string, reason?: string): Promise<PaymentRecord> {
    const payment = await this.getAny(id);
    if (!isRefundable(payment.status)) {
      throw new PaymentNotRefundableError(payment.status);
    }
    if (payment.amount > this.config.refundApprovalThreshold) {
      this.logger.log(
        `Refund for ${id} (${payment.amount}) queued for HQ approval by ${changedBy}`,
      );
      await this.audit(changedBy, 'payment.refund.requested', payment, {
        amountIdr: payment.amount,
        thresholdIdr: this.config.refundApprovalThreshold,
        reason: reason ?? null,
      });
      return this.payments.update(id, {
        status: payment.status, // stays PAID until approved
        refundApproval: RefundApproval.PENDING,
        refundReason: reason ?? null,
        refundedAmount: payment.amount,
      });
    }
    return this.executeRefund(payment, changedBy, reason ?? null, RefundApproval.NONE);
  }

  /**
   * Settlement dashboard (design 6a): network-wide unsettled (PENDING) payments
   * grouped by method with total amount + transaction count, over a date range.
   * Read-only aggregate — no pagination, one row per method with activity.
   */
  async unsettledByMethod(range: DateRange): Promise<UnsettledMethodAggregate[]> {
    return this.payments.aggregateUnsettledByMethod(range);
  }

  /**
   * Revenue-export grouping (design 10a): network-wide collected (PAID) revenue by
   * method with amount + transaction count, over a date range. Read-only aggregate.
   */
  async revenueByMethod(range: DateRange): Promise<UnsettledMethodAggregate[]> {
    return this.payments.aggregateRevenueByMethod(range);
  }

  /**
   * COD deposit (design 2d/slice 9): PAID cash over a set of orders, as a total AND per
   * order. This is payment-service's word on "how much" — the settlement snapshots it so
   * a later refund can't silently move the debt.
   *
   * Two callers, one shape: order-service's daily report needs the split to say which
   * courier brought which part back, and delivery-service needs it because a shift's
   * expected deposit is `max(codAmount, cash PAID)` decided one order at a time (C1).
   * One answer for both means the figures on a screen cannot come from two reads that saw
   * the book at different moments.
   *
   * There used to be a second method here returning the total alone, off a second
   * aggregate query. C1 left it with no caller — the split answers both questions — so
   * it and its repository half are gone rather than kept warm.
   */
  async cashCollected(
    orderIds: string[],
  ): Promise<CashCollectedSummary & { byOrder: OrderCashRow[] }> {
    const byOrder = await this.payments.cashByOrder(orderIds);
    return {
      total: byOrder.reduce((s, r) => s + r.amountIdr, 0),
      count: byOrder.length,
      byOrder,
    };
  }

  /**
   * Gives back the money for a counter sale being voided at the till.
   *
   * Called service-to-service by order-service, not by the cashier's token: reversing a
   * counter sale must not need a MANAGER standing at the depot, and `refundIssue` (rightly)
   * excludes the person who took the cash. A PENDING payment is failed rather than refunded
   * — nothing was ever collected to give back.
   *
   * Returns null when the order has no active payment: the sale was recorded and the money
   * leg never landed, which is exactly the case the cashier is now cleaning up.
   */
  async voidForOrder(orderId: string, reason: string, changedBy: string): Promise<PaymentRecord | null> {
    const active = await this.payments.findActiveByOrder(orderId);
    if (!active) return null;
    if (active.status === PaymentStatus.PENDING) {
      return this.fail(active.id, changedBy);
    }
    // Straight to REFUNDED, never the HQ approval queue: a counter void hands cash back
    // across the counter there and then, and parking it for approval would mean the buyer
    // has walked out with money the system still thinks it holds.
    return this.executeRefund(active, changedBy, reason, RefundApproval.NONE);
  }

  /**
   * K2.3 — a cancelled order gives the money back, instead of a sentence saying it will.
   *
   * Cancellation never reached this service at all. The order flipped to CANCELLED, the
   * stock came back, and the customer's screen showed a red panel explaining the refund
   * rule — a paragraph, not a refund. A payment left PENDING stayed live and locked the
   * order out of every other method (K2.2); a payment left PAID stayed revenue the depot
   * no longer had.
   *
   * Deliberately NOT `voidForOrder`. That one settles straight to REFUNDED with no
   * approval because a cashier is handing cash across the counter there and then. A
   * delivery cancellation has no counter and no cashier, so it goes through `refund`,
   * which is what applies the HQ approval threshold (14a) — a high-value refund parks for
   * a human exactly as it does everywhere else.
   */
  async cancelForOrder(
    orderId: string,
    reason: string,
    changedBy: string,
  ): Promise<PaymentRecord | null> {
    const active = await this.payments.findActiveByOrder(orderId);
    // No active payment: the order was placed and the money leg never landed. Nothing owed.
    if (!active) return null;
    // Nothing was ever collected, so there is nothing to hand back — but the row must stop
    // being active, or it goes on blocking the order it belongs to.
    if (active.status === PaymentStatus.PENDING) {
      return this.fail(active.id, changedBy);
    }
    return this.refund(active.id, changedBy, reason);
  }

  /**
   * What a depot's drawer should hold for a window: its PAID cash, by settlement time.
   * The cashier's shift close is measured against this, so it is deliberately the same
   * question `cashCollected` answers for a courier — asked by depot instead of by order.
   */
  async depotCashCollected(
    depotId: string,
    range: DateRange,
    cashierShiftId?: string,
  ): Promise<CashCollectedSummary> {
    return this.payments.sumDepotCash(depotId, range, cashierShiftId);
  }

  /**
   * HQ refund-approval queue (feature 14a): payments awaiting approval, newest first.
   *
   * Each row carries its order's HM-… number (§G-3). A payment row holds only the order
   * id, so this queue was the one screen that asked HQ to approve money against eight
   * hex characters while every other console showed the number.
   */
  async listRefundQueue(input: { page?: number; limit?: number }): Promise<Page<RefundQueueRow>> {
    const page = Math.max(1, input.page ?? 1);
    const limit = Math.min(PaymentService.MAX_LIMIT, Math.max(1, input.limit ?? 20));
    const { items, total } = await this.payments.listPendingRefunds({ page, limit });
    const numbers = await this.orderCoordination.getOrderNumbers(items.map((i) => i.orderId));
    const decorated = items.map((i) => ({
      ...i,
      orderNumber: numbers.get(i.orderId) ?? null,
    }));
    return buildPage(decorated, total, page, limit);
  }

  /** HQ approves a queued refund → it settles now (finance/super-admin). */
  async approveRefund(id: string, changedBy: string): Promise<PaymentRecord> {
    const payment = await this.getAny(id);
    if (payment.refundApproval !== RefundApproval.PENDING) {
      throw new RefundNotPendingError();
    }
    return this.executeRefund(payment, changedBy, payment.refundReason, RefundApproval.APPROVED);
  }

  /** HQ rejects a queued refund → no money moves; payment stays PAID. */
  async rejectRefund(id: string, changedBy: string, reason?: string): Promise<PaymentRecord> {
    const payment = await this.getAny(id);
    if (payment.refundApproval !== RefundApproval.PENDING) {
      throw new RefundNotPendingError();
    }
    this.logger.log(`Refund ${id} rejected by ${changedBy}`);
    // success:false — a refused approval is a decision someone made, and the record of
    // who refused what is exactly as load-bearing as the record of who approved.
    await this.audit(changedBy, 'payment.refund.rejected', payment, {
      amountIdr: payment.amount,
      reason: reason ?? payment.refundReason ?? null,
    }, false);
    return this.payments.update(id, {
      status: payment.status, // stays PAID
      refundApproval: RefundApproval.REJECTED,
      refundReason: reason ?? payment.refundReason,
    });
  }

  /**
   * O5: which methods this deployment can actually take.
   *
   * The screen had no way to ask, so it offered all five and let two of them fail at the
   * gateway. Derived from configuration rather than stored per depot: what makes them
   * impossible today is one missing URL for the whole platform, and a per-depot switch
   * would be a lever that moves nothing until a gateway exists.
   */
  availableMethods(): Record<PaymentMethod, boolean> {
    const online = this.gateway.isConfigured();
    return {
      [PaymentMethod.CASH]: true,
      [PaymentMethod.TRANSFER]: true,
      [PaymentMethod.QRIS]: true,
      [PaymentMethod.EWALLET]: online,
      [PaymentMethod.VA]: online,
    };
  }

  /** Settles a refund: gateway call (online methods) then PAID → REFUNDED. */
  private async executeRefund(
    payment: PaymentRecord,
    changedBy: string,
    reason: string | null,
    approval: RefundApproval,
  ): Promise<PaymentRecord> {
    const patch: PaymentStatusPatch = {
      status: PaymentStatus.REFUNDED,
      refundedAt: new Date(),
      refundReason: reason,
      refundedAmount: payment.amount,
      refundApproval: approval,
    };

    // B-9: CLAIM FIRST. The status move used to happen after the gateway call and matched
    // on `id` alone, so two concurrent refunds both passed the isRefundable check and both
    // sent money back — the customer was paid twice and nothing recorded that it happened.
    // Moving the row out of a refundable status is what makes exactly one caller the
    // refunder, and it only counts if it happens before we spend anything.
    const claimed = await this.payments.updateIfStatus(payment.id, [payment.status], patch);
    if (!claimed) {
      throw new PaymentNotRefundableError(payment.status);
    }

    if (isOnlineMethod(payment.method) && payment.reference) {
      try {
        const result = await this.gateway.refund(payment.reference, payment.amount);
        patch.gatewayData = result.raw;
      } catch (error) {
        // Hand the claim back so a retry is possible. A crash between the claim and this
        // revert leaves the payment REFUNDED without the money having moved — visible in
        // reconciliation and fixable, unlike paying the customer a second time.
        await this.payments
          .update(payment.id, { status: payment.status, refundedAt: null, refundApproval: payment.refundApproval })
          .catch(() => {});
        this.logger.error(`Gateway refund failed for ${payment.id}: ${(error as Error).message}`);
        throw new GatewayUnavailableError();
      }
    }
    this.logger.log(`Payment ${payment.id} refunded by ${changedBy}`);
    const updated = await this.payments.update(payment.id, patch);
    // H-29: recorded AFTER the money moved, so the trail never claims a refund that the
    // gateway refused. `approval` distinguishes an HQ-approved settlement from one under
    // the threshold that needed nobody — that difference is the whole point of the queue.
    await this.audit(changedBy, 'payment.refund.settled', payment, {
      amountIdr: payment.amount,
      method: payment.method,
      approval,
      reason,
    });
    // Record the refund on the order for per-depot reconciliation. Fail-open: the refund
    // is already settled, so a coordination hiccup must never surface as a payment error.
    await this.orderCoordination.notifyRefunded(payment.orderId, payment.amount);
    return updated;
  }

  /**
   * Settles a payment from a signed provider webhook. Verifies the HMAC-SHA256
   * signature over `${reference}.${event}`, then applies the outcome. Unknown
   * references and already-settled payments are ignored (idempotent).
   */
  async handleWebhook(payload: WebhookPayload): Promise<{ handled: boolean }> {
    if (!this.verifySignature(payload)) {
      throw new InvalidWebhookSignatureError();
    }
    const payment = await this.payments.findByReference(payload.reference);
    if (!payment || payment.status !== PaymentStatus.PENDING) {
      return { handled: false };
    }
    if (payload.event === 'PAID') {
      await this.payments.update(payment.id, { status: PaymentStatus.PAID, paidAt: new Date() });
      // A settled payment confirms the order (CREATED→CONFIRMED). Fail-open, idempotent.
      await this.orderCoordination.confirmPaid(payment.orderId);
    } else {
      await this.payments.update(payment.id, {
        status: PaymentStatus.FAILED,
        failedAt: new Date(),
      });
    }
    return { handled: true };
  }

  /**
   * Records one refund decision to the shared audit trail (H-29).
   *
   * Fail-open by construction — see recordAuditEvent. The refund has already settled by
   * the time this runs, so it cannot be allowed to throw; a dropped entry is logged at
   * `error` rather than silently lost.
   */
  private async audit(
    changedBy: string,
    action: string,
    payment: PaymentRecord,
    metadata: Record<string, unknown>,
    success = true,
  ): Promise<void> {
    await recordAuditEvent(
      { authServiceUrl: this.config.authServiceUrl, internalServiceKey: this.config.internalServiceKey },
      {
        action,
        actorId: changedBy || null,
        target: payment.reference ?? payment.id,
        success,
        /*
         * `depotId` is what the depot-scoped audit view (design 8b) filters on, and without
         * it every refund was HQ-only: a depot could not see a refund taken against its own
         * sale. ponytail: `payment.depotId` is set for counter sales only (see the schema
         * note on the column), so a refund on a DELIVERY order still reaches this trail
         * with a null depot and stays visible to head office alone. Fixing that means
         * asking order-service for the order's depot on the refund path — a round trip on
         * a money path, for a filter.
         */
        metadata: {
          ...metadata,
          paymentId: payment.id,
          orderId: payment.orderId,
          depotId: payment.depotId,
        },
      },
      this.logger,
    );
  }

  /**
   * Q-15: the HMAC used to cover `${reference}.${event}` only — two fields of the
   * request, and no timestamp. Any field the provider added later would have arrived
   * unauthenticated, and a captured PAID callback stayed valid forever. It now covers
   * every field except the signature, and the request must be fresh.
   */
  private verifySignature(payload: WebhookPayload, now = Date.now()): boolean {
    if (!isWebhookFresh(Number(payload.timestamp), now)) {
      this.logger.warn(
        `Webhook for ${payload.reference} rejected: timestamp ${payload.timestamp} outside the replay window`,
      );
      return false;
    }
    const expected = createHmac('sha256', this.config.webhookSecret)
      .update(webhookSigningPayload(payload as unknown as Record<string, unknown>))
      .digest('hex');
    const provided = payload.signature ?? '';
    if (provided.length !== expected.length) {
      return false;
    }
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  }

  private assertTransition(from: PaymentStatus, to: PaymentStatus): void {
    if (!canTransition(from, to)) {
      throw new InvalidPaymentTransitionError(from, to);
    }
  }

  private offlineInstruction(method: PaymentMethod, atCounter: boolean): string {
    switch (method) {
      case PaymentMethod.CASH:
        // A counter sale has no courier and no delivery — the cash is already on the till.
        return atCounter
          ? 'Cash paid at the depot counter.'
          : 'Pay with cash to the driver on delivery.';
      case PaymentMethod.TRANSFER:
        return 'Transfer to the depot bank account and keep your receipt.';
      case PaymentMethod.QRIS:
        // Static QRIS displayed at the depot, paid directly to the depot and
        // confirmed by staff — no gateway, settles manually like TRANSFER.
        return 'Scan the depot QRIS and show the payment proof to staff.';
      default:
        return 'Follow the payment instructions from your provider.';
    }
  }

  private async search(
    input: ListPaymentsInput & { customerId?: string },
  ): Promise<Page<PaymentRecord>> {
    const page = Math.max(1, input.page ?? 1);
    const limit = Math.min(PaymentService.MAX_LIMIT, Math.max(1, input.limit ?? 20));
    const { items, total, nextCursor } = await this.payments.search({
      page,
      limit,
      cursor: input.cursor,
      customerId: input.customerId,
      orderId: input.orderId,
      status: input.status,
    });
    return buildPage(items, total, page, limit, nextCursor);
  }
}
