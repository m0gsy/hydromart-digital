import { Inject, Injectable } from '@nestjs/common';

import { DiscountType } from '../../domain/voucher';
import {
  VoucherRequestRecord,
  VoucherRequestStatus,
  isTerminalStatus,
} from '../../domain/voucher-request';
import { VoucherRequestDecidedError, VoucherRequestNotFoundError } from '../../domain/errors';
import { Page, buildPage } from '../pagination';
import {
  ListVoucherRequestsFilter,
  VoucherRequestRepository,
} from '../ports/voucher-request.repository';
import { PROMO_TOKENS } from '../tokens';
import { VoucherService } from './voucher.service';

export interface ProposeVoucherRequestInput {
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
}

/**
 * Depot→HQ voucher requests (design 14b). A depot manager proposes a voucher for
 * their area; HQ approves or rejects. Approving creates the real voucher through the
 * EXISTING VoucherService.create (unique-code check + normalisation reused — no
 * duplicated voucher logic). Rejecting just closes the request; no voucher is made.
 */
@Injectable()
export class VoucherRequestService {
  constructor(
    @Inject(PROMO_TOKENS.VoucherRequestRepository)
    private readonly requests: VoucherRequestRepository,
    private readonly vouchers: VoucherService,
  ) {}

  propose(
    depotId: string,
    requestedBy: string,
    input: ProposeVoucherRequestInput,
  ): Promise<VoucherRequestRecord> {
    return this.requests.create({
      depotId,
      depotName: input.depotName,
      code: input.code,
      description: input.description,
      discountType: input.discountType,
      value: input.value,
      minSpend: input.minSpend,
      maxDiscount: input.maxDiscount,
      usageLimit: input.usageLimit,
      perCustomerLimit: input.perCustomerLimit,
      note: input.note,
      requestedBy,
    });
  }

  async list(filter: ListVoucherRequestsFilter): Promise<Page<VoucherRequestRecord>> {
    const { items, total } = await this.requests.list(filter);
    return buildPage(items, total, filter.page, filter.limit);
  }

  async approve(id: string, decidedBy: string): Promise<VoucherRequestRecord> {
    const request = await this.require(id);
    if (isTerminalStatus(request.status)) throw new VoucherRequestDecidedError();
    // Create the real voucher via the existing mechanism (dup-code guard + normalise).
    const voucher = await this.vouchers.create({
      code: request.code,
      description: request.description,
      discountType: request.discountType,
      value: request.value,
      minSpend: request.minSpend,
      maxDiscount: request.maxDiscount,
      validFrom: null,
      validUntil: null,
      usageLimit: request.usageLimit,
      perCustomerLimit: request.perCustomerLimit,
    });
    return this.requests.update(id, {
      status: VoucherRequestStatus.APPROVED,
      decidedBy,
      createdVoucherId: voucher.id,
    });
  }

  async reject(id: string, decidedBy: string): Promise<VoucherRequestRecord> {
    const request = await this.require(id);
    if (isTerminalStatus(request.status)) throw new VoucherRequestDecidedError();
    return this.requests.update(id, { status: VoucherRequestStatus.REJECTED, decidedBy });
  }

  private async require(id: string): Promise<VoucherRequestRecord> {
    const request = await this.requests.findById(id);
    if (!request) throw new VoucherRequestNotFoundError();
    return request;
  }
}
