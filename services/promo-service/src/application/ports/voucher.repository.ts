import { DiscountType } from '../../domain/voucher';

export interface VoucherRecord {
  id: string;
  code: string;
  description: string | null;
  discountType: DiscountType;
  value: number;
  minSpend: number;
  maxDiscount: number | null;
  validFrom: Date | null;
  validUntil: Date | null;
  usageLimit: number | null;
  perCustomerLimit: number;
  budgetCap: number | null;
  /** CA-2-65: the depot this voucher belongs to; null = network-wide. */
  depotId: string | null;
  /** Item 5 (B): limit the discount to this product / category's lines; both null = whole order. */
  productId: string | null;
  categoryId: string | null;
  /** PRM-4: 'PUBLIC' (any code-holder) or 'GRANTED' (only the customers it was given to). */
  audience: string;
  usedCount: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** PRM-4: the audience a voucher is created with. Defaults to PUBLIC when unstated. */
export type VoucherAudience = 'PUBLIC' | 'GRANTED';

export interface VoucherRedemptionRecord {
  id: string;
  voucherId: string;
  voucherCode: string;
  customerId: string;
  orderId: string;
  discountApplied: number;
  createdAt: Date;
  /** PRM-8: when a voided order handed this redemption back; null = still spent. */
  releasedAt?: Date | null;
}

/** Fields for creating a voucher; `code` is already normalised (uppercased). */
export interface CreateVoucherData {
  code: string;
  description: string | null;
  discountType: DiscountType;
  value: number;
  minSpend: number;
  maxDiscount: number | null;
  validFrom: Date | null;
  validUntil: Date | null;
  usageLimit: number | null;
  perCustomerLimit: number;
  budgetCap?: number | null;
  /** Create a voucher as a draft (inactive) — defaults to active when omitted. */
  active?: boolean;
  /**
   * CA-2-65: the depot this voucher belongs to; omitted or null = network-wide.
   *
   * Set when HQ approves a depot's own voucher request. Every voucher created from the HQ
   * form is network-wide, which is what it has always been and what the column defaults to.
   */
  depotId?: string | null;
  /** Item 5 (B): at most one of these; omitted = whole order. */
  productId?: string | null;
  categoryId?: string | null;
  /** PRM-4: who may spend it. Omitted = PUBLIC, which is what every voucher used to be. */
  audience?: VoucherAudience;
}

/** Partial patch for an existing voucher; omitted keys are left unchanged. */
export interface UpdateVoucherData {
  description?: string | null;
  discountType?: DiscountType;
  value?: number;
  minSpend?: number;
  maxDiscount?: number | null;
  validFrom?: Date | null;
  validUntil?: Date | null;
  usageLimit?: number | null;
  perCustomerLimit?: number;
  budgetCap?: number | null;
  productId?: string | null;
  categoryId?: string | null;
  active?: boolean;
}

/** What `redemptionAnalytics` returns — every number already aggregated by Postgres. */
export interface RedemptionAnalytics {
  totalUses: number;
  totalSavingsIdr: number;
  usesInWindow: number;
  /** One row per day that had at least one use, `day` as YYYY-MM-DD. */
  dailyUses: { day: string; uses: number }[];
  topCustomers: { customerId: string; uses: number; savingsIdr: number }[];
  orderIds: string[];
}

export interface ExpiringGrant {
  voucherId: string;
  customerId: string;
  code: string;
  description: string | null;
  validUntil: Date;
}

/** One redemption that is still spent (not released), inside a report window. */
export interface RedemptionInWindow {
  voucherId: string;
  voucherCode: string;
  orderId: string;
  discountApplied: number;
}

export interface VoucherRepository {
  findById(id: string): Promise<VoucherRecord | null>;
  findByCode(code: string): Promise<VoucherRecord | null>;
  create(data: CreateVoucherData): Promise<VoucherRecord>;
  update(id: string, data: UpdateVoucherData): Promise<VoucherRecord>;

  /**
   * The admin voucher list. `depotIds` narrows it to a depot-scoped caller's reach: their own
   * depots' vouchers PLUS the network-wide ones (no depot), which a manager may grant but
   * never sees another depot's. Omitted is every voucher (head office).
   */
  search(
    page: number,
    limit: number,
    activeOnly: boolean,
    depotIds?: readonly string[],
  ): Promise<{ items: VoucherRecord[]; total: number }>;

  countRedemptions(voucherId: string, customerId?: string): Promise<number>;
  /** Spent redemptions made in [from, to), oldest first, at most limit. */
  redemptionsInWindow(from: Date, to: Date, limit: number): Promise<RedemptionInWindow[]>;
  findRedemptionByOrder(orderId: string): Promise<VoucherRedemptionRecord | null>;
  findRedemptionsFor(voucherId: string): Promise<VoucherRedemptionRecord[]>;
  /**
   * The promotion analytics numbers, computed in the database (audit S-14). The console
   * used to read a voucher's ENTIRE redemption history and make five passes over it in
   * JavaScript — a campaign that worked was the one whose analytics page got slowest.
   *
   * `dailyUses` covers [from, to) only; `topCustomers` is the biggest savers first,
   * already limited.
   *
   * `timeZone` is the business zone the day labels are cut on (H-16). Grouping on UTC
   * days would put every redemption before 07:00 WIB in yesterday's bar — and since the
   * caller labels its seven buckets with LOCAL day keys, a UTC label matches none of
   * them and the whole chart reads zero.
   */
  redemptionAnalytics(
    voucherId: string,
    from: Date,
    to: Date,
    topCustomers: number,
    timeZone: string,
    /** PRM-2: only these orders' redemptions. Omitted = the whole voucher. */
    orderIds?: readonly string[],
  ): Promise<RedemptionAnalytics>;

  /**
   * Total rupiah discount burned per voucher (SUM discountApplied). Network-wide when
   * `depotIds` is omitted; otherwise only the vouchers that belong to those depots (a
   * network-wide voucher, with no depot, belongs to none of them). An empty set matches nothing.
   */
  sumRedemptionsByVoucher(
    depotIds?: readonly string[],
  ): Promise<{ voucherId: string; burned: number }[]>;

  /** Total rupiah discount burned by one voucher (for the budget cap). */
  sumRedemptionsFor(voucherId: string): Promise<number>;

  /**
   * Active vouchers paired with this customer's redemption count for each, for
   * the wallet view. One query per side (no N+1).
   */
  listForCustomer(
    customerId: string,
  ): Promise<{ voucher: VoucherRecord; customerRedemptions: number; granted: boolean }[]>;

  /**
   * Redeem under a lock on the voucher row (H-1). The only way to redeem.
   *
   * There used to be a second one, `recordRedemption`, atomic in its WRITE but with the
   * usage/per-customer/budget checks decided before it on a separate connection.
   * Concurrent redemptions of the same code all read the same counts, all passed, and all
   * wrote — so every cap was bypassable by simply sending the requests at once. H-1 added
   * this method and moved the caller; nothing called the old one afterwards, and leaving
   * it on the port left the bypass one `this.repo.` away from anybody adding a feature.
   *
   * Here the voucher row is locked first, so redemptions of one code are serialized: the
   * counts handed to `decide` already include every redemption that committed before us.
   * `decide` stays pure domain logic (it computes the discount and throws if a cap is
   * blown); the lock and the write are infrastructure's business.
   */
  /**
   * C4: undo one order's redemption — the exact inverse of `redeemAtomic`.
   *
   * A voided counter sale gave the buyer their goods back and their money back, but their
   * voucher stayed burned: the redemption row survived and `usedCount` stayed incremented,
   * so a single-use voucher was spent on a sale that never happened. There was no reversal
   * method on the port at all, so nothing downstream could even try.
   *
   * In ONE transaction, and in the same order as the redemption it undoes: delete the row,
   * decrement the counter. Returns null when there is nothing to release — a void of a sale
   * that used no voucher is not an error, it is the common case.
   */
  releaseAtomic(orderId: string): Promise<VoucherRedemptionRecord | null>;

  redeemAtomic(
    input: { voucherId: string; voucherCode: string; customerId: string; orderId: string },
    decide: (counts: { usedCount: number; customerRedemptions: number; burned: number }) => number,
  ): Promise<VoucherRedemptionRecord>;

  /** Record a grant of the voucher to a customer. Returns true only when newly created
   *  (idempotent per voucher+customer) so the notification fires once. */
  grantVoucher(voucherId: string, customerId: string): Promise<boolean>;
  /**
   * Wallet vouchers still worth using that lapse inside [from, to): granted, active, not yet
   * redeemed by the holder (a released redemption does not count as spent) and not yet
   * nudged. With `from` = now this is a catch-up: a sweep that was skipped is made good by
   * the next. Bounded.
   */
  findExpiringGrants(from: Date, to: Date, limit: number): Promise<ExpiringGrant[]>;
  /**
   * Claim the right to nudge this holder: true for exactly one caller. Taken BEFORE the nudge
   * is sent, so it is never doubled; a send that dies after the claim is not retried.
   */
  claimExpiryNotice(voucherId: string, customerId: string): Promise<boolean>;
  /** PRM-4: whether this customer holds a grant for this voucher. */
  hasGrant(voucherId: string, customerId: string): Promise<boolean>;
}
