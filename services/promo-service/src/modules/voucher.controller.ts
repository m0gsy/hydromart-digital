import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser, InternalAuthGuard, Public, Role, Roles } from '@hydromart/platform';

import { Page } from '../application/pagination';
import {
  QuoteResult,
  RedeemResult,
  VoucherService,
} from '../application/services/voucher.service';
import { UpdateVoucherData, VoucherRecord } from '../application/ports/voucher.repository';
import {
  BrowseQueryDto,
  CreateVoucherDto,
  MyVoucherDto,
  QuoteVoucherDto,
  RedeemVoucherDto,
  UpdateVoucherDto,
} from './dto/voucher.dto';

// Vouchers are authored by marketing/depot staff and previewed/redeemed by customers.
const ADMIN_ROLES = [Role.MARKETING, Role.DEPOT_MANAGER, Role.SUPER_ADMIN] as const;
const READ_ROLES = [
  Role.MARKETING,
  Role.DEPOT_MANAGER,
  Role.HEAD_OFFICE,
  Role.SUPER_ADMIN,
] as const;

const toDate = (iso?: string): Date | undefined => (iso ? new Date(iso) : undefined);

@ApiTags('Vouchers')
@Controller({ path: 'vouchers', version: '1' })
export class VoucherController {
  constructor(private readonly vouchers: VoucherService) {}

  @ApiBearerAuth()
  @Roles(...READ_ROLES)
  @Get()
  @ApiOperation({ summary: 'List all vouchers (admin, includes inactive)' })
  browse(@Query() query: BrowseQueryDto): Promise<Page<VoucherRecord>> {
    return this.vouchers.browse(query.page, query.limit, false);
  }

  // Declared before the `@Get(':code')` route below so "me" is not captured as a code.
  @ApiBearerAuth()
  @Roles(Role.CUSTOMER)
  @Get('me')
  @ApiOperation({ summary: "The current customer's voucher wallet (spec 4a)" })
  async myVouchers(@CurrentUser() user: AuthenticatedUser): Promise<MyVoucherDto[]> {
    const wallet = await this.vouchers.myVouchers(user.sub);
    return wallet.map((w) => MyVoucherDto.from(w));
  }

  @ApiBearerAuth()
  @Roles(Role.CUSTOMER)
  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Preview the discount a voucher grants for the order (no side effect)' })
  quote(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: QuoteVoucherDto,
  ): Promise<QuoteResult> {
    return this.vouchers.quote(dto.code, user.sub, dto.subtotal);
  }

  // System-to-system call from order-service at checkout, authenticated by the shared
  // INTERNAL_SERVICE_KEY (not a customer token). Idempotent per orderId. Internal auth
  // closes the prior ceiling where a customer could inflate global usage via the wire.
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('redeem')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Redeem a voucher for an order (internal service auth, idempotent per orderId)' })
  redeem(@Body() dto: RedeemVoucherDto): Promise<RedeemResult> {
    return this.vouchers.redeem(dto.code, dto.customerId, dto.orderId, dto.subtotal);
  }

  @ApiBearerAuth()
  @Roles(...ADMIN_ROLES)
  @Post()
  @ApiOperation({ summary: 'Create a voucher (admin)' })
  create(@Body() dto: CreateVoucherDto): Promise<VoucherRecord> {
    return this.vouchers.create({
      code: dto.code,
      description: dto.description ?? null,
      discountType: dto.discountType,
      value: dto.value,
      minSpend: dto.minSpend ?? 0,
      maxDiscount: dto.maxDiscount ?? null,
      validFrom: toDate(dto.validFrom) ?? null,
      validUntil: toDate(dto.validUntil) ?? null,
      usageLimit: dto.usageLimit ?? null,
      perCustomerLimit: dto.perCustomerLimit ?? 1,
    });
  }

  @ApiBearerAuth()
  @Roles(...ADMIN_ROLES)
  @Patch(':id')
  @ApiOperation({ summary: 'Update a voucher (admin)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVoucherDto,
  ): Promise<VoucherRecord> {
    const patch: UpdateVoucherData = {
      description: dto.description,
      discountType: dto.discountType,
      value: dto.value,
      minSpend: dto.minSpend,
      maxDiscount: dto.maxDiscount,
      validFrom: toDate(dto.validFrom),
      validUntil: toDate(dto.validUntil),
      usageLimit: dto.usageLimit,
      perCustomerLimit: dto.perCustomerLimit,
      active: dto.active,
    };
    return this.vouchers.update(id, patch);
  }

  @ApiBearerAuth()
  @Roles(...ADMIN_ROLES)
  @Delete(':id')
  @ApiOperation({ summary: 'Deactivate a voucher (admin)' })
  deactivate(@Param('id', ParseUUIDPipe) id: string): Promise<VoucherRecord> {
    return this.vouchers.deactivate(id);
  }

  @Public()
  @Get(':code')
  @ApiOperation({ summary: 'Public voucher preview by code (FR-089/FR-090)' })
  getByCode(@Param('code') code: string): Promise<VoucherRecord> {
    return this.vouchers.getByCode(code);
  }
}
