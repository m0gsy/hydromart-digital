import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import {
  AuthenticatedUser,
  CurrentUser,
  InternalAuthGuard,
  Public,
  Roles,
} from '@hydromart/platform';
import { CAPABILITIES } from '@hydromart/access';

import {
  CourierEarningsSummary,
  CourierPayoutService,
} from '../application/services/courier-payout.service';
import { CourierLedgerEntryRecord } from '../application/ports/courier-ledger.repository';
import { Page } from '../application/pagination';
import { CourierLedgerQueryDto, DeliveryCompletedEventDto } from './dto/courier-payout.dto';

// Courier-scoped: reads the calling courier's own earnings ledger (user.sub).
@ApiTags('Courier Payout')
@ApiBearerAuth()
@Roles(...CAPABILITIES.courierPayout)
@Controller({ path: 'courier', version: '1' })
export class CourierPayoutController {
  constructor(private readonly payout: CourierPayoutService) {}

  @Get('earnings/summary')
  @ApiOperation({ summary: "Balance, this month's earnings + recent activity (design 2c)" })
  summary(@CurrentUser() user: AuthenticatedUser): Promise<CourierEarningsSummary> {
    return this.payout.summary(user.sub);
  }

  @Get('ledger')
  @ApiOperation({ summary: 'Paginated earnings cash-book for the calling courier' })
  ledger(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CourierLedgerQueryDto,
  ): Promise<Page<CourierLedgerEntryRecord>> {
    return this.payout.ledgerPage(user.sub, query.page, query.limit);
  }

  // System-triggered: delivery-service posts a completed delivery, authenticated by the
  // shared INTERNAL_SERVICE_KEY (no end-user token). @Public() skips the JWT guard;
  // InternalAuthGuard is the sole (fail-closed) auth. Idempotent by deliveryId.
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('ledger/internal')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record courier earning for a completed delivery (internal service auth)' })
  async recordEarning(
    @Body() dto: DeliveryCompletedEventDto,
  ): Promise<{ recorded: boolean }> {
    const entry = await this.payout.recordDeliveryEarning({
      courierId: dto.courierId,
      depotId: dto.depotId ?? null,
      deliveryId: dto.deliveryId,
      deliveredAt: dto.deliveredAt,
      onTime: dto.onTime,
    });
    return { recorded: entry !== null };
  }
}
