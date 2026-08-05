/**
 * Payment domain (PRD Module 5). Framework-free: the single source of truth for
 * which payment methods settle online and which status transitions are legal.
 */
export enum PaymentMethod {
  CASH = 'CASH',
  TRANSFER = 'TRANSFER',
  QRIS = 'QRIS',
  EWALLET = 'EWALLET',
  VA = 'VA',
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
  CANCELLED = 'CANCELLED',
}

/** HQ refund-approval state (feature 14a). See schema RefundApproval enum. */
export enum RefundApproval {
  NONE = 'NONE',
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

/**
 * Refunds strictly above this amount (IDR) require HQ approval before they settle;
 * at or below it, finance/manager refunds go through immediately. Overridable via
 * the REFUND_HQ_THRESHOLD env var (PaymentConfigService.refundApprovalThreshold).
 */
export const DEFAULT_REFUND_APPROVAL_THRESHOLD = 100_000;

/**
 * Methods settled through the payment gateway (need a charge + reference).
 * QRIS is NOT online: depots use their own static QRIS paid directly to the
 * depot and confirmed by staff, so it settles manually like TRANSFER.
 */
/**
 * Freshness window for a provider webhook, in milliseconds (Q-15).
 *
 * Five minutes each way: generous enough for clock skew and a provider retry, short
 * enough that a captured request stops being useful quickly.
 */
export const WEBHOOK_MAX_SKEW_MS = 5 * 60 * 1000;

/**
 * The exact string a webhook's HMAC covers (Q-15).
 *
 * It used to be `${reference}.${event}` — two fields out of the whole request. Anything
 * the provider added later (an amount, a settlement time, a currency) would have arrived
 * unauthenticated, and with no timestamp in the signed material a captured PAID callback
 * stayed replayable forever. Signing every field except the signature itself means a new
 * field is covered the moment it exists, without anybody remembering to come back here.
 *
 * Sorted by key so the sender and the receiver cannot disagree about field order, and
 * `k=v` joined with `&` so two fields cannot be confused for one by moving a delimiter
 * into a value.
 */
export function webhookSigningPayload(payload: Record<string, unknown>): string {
  return Object.keys(payload)
    .filter((key) => key !== 'signature' && payload[key] !== undefined)
    .sort()
    .map((key) => `${key}=${String(payload[key] ?? '')}`)
    .join('&');
}

/** Is `timestamp` (epoch ms) inside the replay window around `now`? */
export function isWebhookFresh(timestamp: number, now: number): boolean {
  return Number.isFinite(timestamp) && Math.abs(now - timestamp) <= WEBHOOK_MAX_SKEW_MS;
}

const ONLINE_METHODS: readonly PaymentMethod[] = [PaymentMethod.EWALLET, PaymentMethod.VA];

export function isOnlineMethod(method: PaymentMethod): boolean {
  return ONLINE_METHODS.includes(method);
}

const TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  [PaymentStatus.PENDING]: [PaymentStatus.PAID, PaymentStatus.FAILED, PaymentStatus.CANCELLED],
  [PaymentStatus.PAID]: [PaymentStatus.REFUNDED],
  [PaymentStatus.FAILED]: [],
  [PaymentStatus.REFUNDED]: [],
  [PaymentStatus.CANCELLED]: [],
};

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isRefundable(status: PaymentStatus): boolean {
  return canTransition(status, PaymentStatus.REFUNDED);
}

/**
 * Change owed back to the customer for a COD payment: cash handed over minus the
 * amount due, rounded to whole rupiah. Negative means the customer underpaid,
 * which the caller rejects — you cannot settle a COD payment short.
 */
export function computeChange(amount: number, cashReceived: number): number {
  return Math.round((cashReceived - amount) * 100) / 100;
}
