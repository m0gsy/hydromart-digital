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

/**
 * K2.2: the methods a stale PENDING row may be expired on — everything except CASH.
 *
 * CASH is deliberately absent and must stay absent. A COD payment is PENDING by design
 * from checkout until the courier confirms at the door, so expiring it on age would fail
 * the payment for a delivery that is still on its way. On the live stack today the
 * PENDING rows split exactly along this line: 56 CASH awaiting a courier, and 52
 * TRANSFER/QRIS rows whose oldest was created 26 July and has been blocking its order
 * from being paid any other way ever since.
 */
export const EXPIRABLE_PENDING_METHODS: readonly PaymentMethod[] = [
  PaymentMethod.TRANSFER,
  PaymentMethod.QRIS,
  PaymentMethod.EWALLET,
  PaymentMethod.VA,
];

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

/** The refund promise made to customers: 1-3 working days. The due date is the 3rd. */
export const REFUND_PROMISE_WORKING_DAYS = 3;

/**
 * National holidays that fall on the same calendar day every year (MM-DD): New Year, Labour
 * Day, Pancasila Day, Independence Day, Christmas. The movable ones (Idul Fitri, Nyepi,
 * Waisak, cuti bersama ...) change each year by SKB, so they come from `PUBLIC_HOLIDAYS`
 * (ISO dates) instead of a table here that would be silently wrong by next January.
 */
const FIXED_HOLIDAYS = new Set(['01-01', '05-01', '06-01', '08-17', '12-25']);

/** The business zone the promise is counted in (WIB). A refund asked at 20:00 UTC is already tomorrow here. */
const PROMISE_TZ = 'Asia/Jakarta';

/**
 * True for a weekend, a fixed national holiday, or a date in the configured list — judged
 * on the LOCAL calendar day, because that is the day a customer reads in the promise.
 */
export function isNonWorkingDay(d: Date, extraHolidays: ReadonlySet<string> = new Set()): boolean {
  // en-CA formats as YYYY-MM-DD. Intl, not a platform import: this file is framework-free.
  const key = new Intl.DateTimeFormat('en-CA', { timeZone: PROMISE_TZ }).format(d);
  const dow = new Date(`${key}T00:00:00.000Z`).getUTCDay();
  if (dow === 0 || dow === 6) return true;
  return FIXED_HOLIDAYS.has(key.slice(5)) || extraHolidays.has(key);
}

/**
 * `from` plus `days` working days: Mon-Fri, UTC, skipping fixed national holidays and the
 * `extraHolidays` ISO dates. A promise made over a long weekend must not count it.
 */
export function addWorkingDays(
  from: Date,
  days: number,
  extraHolidays: ReadonlySet<string> = new Set(),
): Date {
  const d = new Date(from.getTime());
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (!isNonWorkingDay(d, extraHolidays)) left -= 1;
  }
  return d;
}
