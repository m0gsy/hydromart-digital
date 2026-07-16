import { createHmac, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  GatewayUnavailableError,
  InvalidPaymentTransitionError,
  InvalidWebhookSignatureError,
  PaymentAlreadyExistsError,
  PaymentNotFoundError,
  PaymentNotRefundableError,
  RefundNotPendingError,
} from '../../domain/errors';
import {
  PaymentMethod,
  PaymentStatus,
  RefundApproval,
  canTransition,
  isOnlineMethod,
  isRefundable,
} from '../../domain/payment';
import { PaymentConfigService } from '../../config/payment-config.service';
import { Page, buildPage } from '../pagination';
import {
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
}

export interface ListPaymentsInput {
  orderId?: string;
  status?: PaymentStatus;
  page?: number;
  limit?: number;
}

/** Provider webhook event mapped to a settlement outcome. */
export type WebhookEvent = 'PAID' | 'FAILED';

export interface WebhookPayload {
  reference: string;
  event: WebhookEvent;
  signature: string;
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

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
    const base: CreatePaymentData = {
      orderId: input.orderId,
      customerId,
      method: input.method,
      amount,
      reference: null,
      instruction: this.offlineInstruction(input.method),
      gatewayData: null,
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

  /** Manually mark a payment settled (e.g. cash received on delivery). */
  async confirm(id: string, changedBy: string): Promise<PaymentRecord> {
    const payment = await this.getAny(id);
    this.assertTransition(payment.status, PaymentStatus.PAID);
    this.logger.log(`Payment ${id} confirmed PAID by ${changedBy}`);
    const updated = await this.payments.update(id, {
      status: PaymentStatus.PAID,
      paidAt: new Date(),
    });
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

  /** HQ refund-approval queue (feature 14a): payments awaiting approval, newest first. */
  async listRefundQueue(input: { page?: number; limit?: number }): Promise<Page<PaymentRecord>> {
    const page = Math.max(1, input.page ?? 1);
    const limit = Math.min(PaymentService.MAX_LIMIT, Math.max(1, input.limit ?? 20));
    const { items, total } = await this.payments.listPendingRefunds({ page, limit });
    return buildPage(items, total, page, limit);
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
    if (isOnlineMethod(payment.method) && payment.reference) {
      try {
        const result = await this.gateway.refund(payment.reference, payment.amount);
        patch.gatewayData = result.raw;
      } catch (error) {
        this.logger.error(`Gateway refund failed for ${payment.id}: ${(error as Error).message}`);
        throw new GatewayUnavailableError();
      }
    }
    this.logger.log(`Payment ${payment.id} refunded by ${changedBy}`);
    return this.payments.update(payment.id, patch);
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

  private verifySignature(payload: WebhookPayload): boolean {
    const expected = createHmac('sha256', this.config.webhookSecret)
      .update(`${payload.reference}.${payload.event}`)
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

  private offlineInstruction(method: PaymentMethod): string {
    switch (method) {
      case PaymentMethod.CASH:
        return 'Pay with cash to the driver on delivery.';
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
    const { items, total } = await this.payments.search({
      page,
      limit,
      customerId: input.customerId,
      orderId: input.orderId,
      status: input.status,
    });
    return buildPage(items, total, page, limit);
  }
}
