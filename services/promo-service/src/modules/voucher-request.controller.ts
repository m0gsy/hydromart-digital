import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser, Role, Roles } from '@hydromart/platform';
import { CAPABILITIES } from '@hydromart/access';

import { Page } from '../application/pagination';
import { VoucherRequestService } from '../application/services/voucher-request.service';
import { VoucherRequestRecord, VoucherRequestStatus } from '../domain/voucher-request';
import { DiscountType } from '../domain/voucher';
import { ListVoucherRequestsQueryDto, ProposeVoucherRequestDto } from './dto/voucher-request.dto';

/**
 * Depot-side propose (design 14b): a depot manager requests a voucher for their
 * depot. Gated on voucherWrite (marketing/depot-manager/super-admin).
 */
@ApiTags('Voucher requests')
@ApiBearerAuth()
@Controller({ path: 'depots/:depotId/voucher-requests', version: '1' })
export class DepotVoucherRequestController {
  constructor(private readonly requests: VoucherRequestService) {}

  @Post()
  @Roles(...CAPABILITIES.voucherWrite)
  @ApiOperation({ summary: 'Propose a voucher for a depot (depot manager)' })
  propose(
    @CurrentUser() user: AuthenticatedUser,
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Body() dto: ProposeVoucherRequestDto,
  ): Promise<VoucherRequestRecord> {
    return this.requests.propose(depotId, user.sub, {
      depotName: dto.depotName,
      code: dto.code,
      description: dto.description ?? null,
      discountType: dto.discountType as DiscountType,
      value: dto.value,
      minSpend: dto.minSpend ?? 0,
      maxDiscount: dto.maxDiscount ?? null,
      usageLimit: dto.usageLimit ?? null,
      perCustomerLimit: dto.perCustomerLimit ?? 1,
      note: dto.note ?? null,
    });
  }
}

/**
 * HQ voucher-request approvals queue (design 14b). HQ-only: HEAD_OFFICE +
 * SUPER_ADMIN. Lists the pending queue by default; approving creates the real voucher.
 */
@ApiTags('Voucher requests')
@ApiBearerAuth()
@Roles(Role.HEAD_OFFICE, Role.SUPER_ADMIN)
@Controller({ path: 'voucher-requests', version: '1' })
export class VoucherRequestController {
  constructor(private readonly requests: VoucherRequestService) {}

  @Get()
  @ApiOperation({ summary: 'List voucher requests (defaults to the pending queue)' })
  list(@Query() query: ListVoucherRequestsQueryDto): Promise<Page<VoucherRequestRecord>> {
    return this.requests.list({
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      status: query.status ?? VoucherRequestStatus.PENDING,
    });
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve → creates the real voucher' })
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VoucherRequestRecord> {
    return this.requests.approve(id, user.sub);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a voucher request (no voucher created)' })
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VoucherRequestRecord> {
    return this.requests.reject(id, user.sub);
  }
}
