import { createHmac, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
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
import { PAYMENT_TOKENS } from '../tokens';

export interface InitiatePaymentInput {
  orderId: string;
  method: PaymentMethod;
  amount: number;
  /** Counter sale: the buyer is at the depot, so no courier hands anything over. */
  atCounter?: boolean;
  /** Depot whose drawer takes the money. Counter sales only. */
  depotId?: string | null;
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
  private static readonly MAX_LIMIT = 100;
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @Inject(PAYMENT_TOKENS.PaymentRepository) private readonly payments: PaymentRepository,
    @Inject(PAYMENT_TOKENS.PaymentGateway) private readonly gateway: PaymentGatewayPort,
    @Inject(PAYMENT_TOKENS.OrderCoordination)
    private readonly orderCoordination: OrderCoordinationPort,
    private readonly config: PaymentConfigService,
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
    };

    if (!isOnlineMethod(input.method)) {
      return this.payments.create(base);
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
  async confirm(id: string, changedBy: string, cashReceived?: number): Promise<PaymentRecord> {
    const payment = await this.getAny(id);
    this.assertTransition(payment.status, PaymentStatus.PAID);
    const patch: PaymentStatusPatch = { status: PaymentStatus.PAID, paidAt: new Date() };
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
   * COD deposit total (design 2d/slice 9): sum of PAID cash payments over the
   * courier's delivered orders. This is payment-service's word on "how much" —
   * the settlement snapshots it so a later refund can't silently move the debt.
   */
  async cashCollected(orderIds: string[]): Promise<CashCollectedSummary> {
    return this.payments.sumCashCollected(orderIds);
  }

  /**
   * The same answer as `cashCollected`, plus the per-order split.
   *
   * order-service's daily report needs both: the total is the depot's courier COD for the
   * day, and the split is what lets it say which courier brought which part back. Returning
   * one shape for both means the two figures on that screen cannot come from two reads that
   * saw the book at different moments.
   */
  async cashCollectedByOrder(
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
   * What a depot's drawer should hold for a window: its PAID cash, by settlement time.
   * The cashier's shift close is measured against this, so it is deliberately the same
   * question `cashCollected` answers for a courier — asked by depot instead of by order.
   */
  async depotCashCollected(depotId: string, range: DateRange): Promise<CashCollectedSummary> {
    return this.payments.sumDepotCash(depotId, range);
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
