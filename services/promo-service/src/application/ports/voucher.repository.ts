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
  usedCount: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface VoucherRedemptionRecord {
  id: string;
  voucherId: string;
  voucherCode: string;
  customerId: string;
  orderId: string;
  discountApplied: number;
  createdAt: Date;
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
  active?: boolean;
}

/** Atomic redemption: insert the redemption row and bump the voucher's usedCount. */
export interface RedemptionMutation {
  voucherId: string;
  voucherCode: string;
  customerId: string;
  orderId: string;
  discountApplied: number;
}

export interface VoucherRepository {
  findById(id: string): Promise<VoucherRecord | null>;
  findByCode(code: string): Promise<VoucherRecord | null>;
  create(data: CreateVoucherData): Promise<VoucherRecord>;
  update(id: string, data: UpdateVoucherData): Promise<VoucherRecord>;

  search(
    page: number,
    limit: number,
    activeOnly: boolean,
  ): Promise<{ items: VoucherRecord[]; total: number }>;

  countRedemptions(voucherId: string, customerId?: string): Promise<number>;
  findRedemptionByOrder(orderId: string): Promise<VoucherRedemptionRecord | null>;

  /**
   * Active vouchers paired with this customer's redemption count for each, for
   * the wallet view. One query per side (no N+1).
   */
  listForCustomer(
    customerId: string,
  ): Promise<{ voucher: VoucherRecord; customerRedemptions: number }[]>;

  /** Atomic: insert redemption + increment usedCount, returns the redemption. */
  recordRedemption(mutation: RedemptionMutation): Promise<VoucherRedemptionRecord>;
}
