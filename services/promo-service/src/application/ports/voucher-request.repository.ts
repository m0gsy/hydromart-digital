import { DiscountType } from '../../domain/voucher';
import { VoucherRequestRecord, VoucherRequestStatus } from '../../domain/voucher-request';

export interface CreateVoucherRequestData {
  depotId: string;
  depotName: string;
  code: string;
  description: string | null;
  discountType: DiscountType;
  value: number;
  minSpend: number;
  maxDiscount: number | null;
  usageLimit: number | null;
  perCustomerLimit: number;
  note: string | null;
  requestedBy: string;
}

export interface UpdateVoucherRequestData {
  status?: VoucherRequestStatus;
  decidedBy?: string;
  createdVoucherId?: string;
}

export interface ListVoucherRequestsFilter {
  page: number;
  limit: number;
  status?: VoucherRequestStatus;
}

export interface VoucherRequestRepository {
  create(data: CreateVoucherRequestData): Promise<VoucherRequestRecord>;
  /** Queue read: newest first, optionally filtered by status (HQ defaults to PENDING). */
  list(
    filter: ListVoucherRequestsFilter,
  ): Promise<{ items: VoucherRequestRecord[]; total: number }>;
  findById(id: string): Promise<VoucherRequestRecord | null>;
  update(id: string, patch: UpdateVoucherRequestData): Promise<VoucherRequestRecord>;
}
