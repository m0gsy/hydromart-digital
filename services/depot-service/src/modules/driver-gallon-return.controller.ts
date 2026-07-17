import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser, Roles } from '@hydromart/platform';
import { CAPABILITIES } from '@hydromart/access';

import { GallonReturnService } from '../application/services/gallon-return.service';
import { GallonReturnRecord } from '../application/ports/gallon-return.repository';
import { CreateCourierReturnDto } from './dto/gallon-return.dto';

/**
 * Courier-facing empty-gallon return at delivery handover (design 2e). Narrower than the
 * staff `returnsWrite` route: the courier picks quantity + condition, and the deposit refund
 * is derived server-side (GALLON_DEPOSIT_IDR × quantity) — never sent by the client.
 */
@ApiTags('Gallon returns (courier)')
@ApiBearerAuth()
@Controller({ path: 'driver/gallon-returns', version: '1' })
export class DriverGallonReturnController {
  constructor(private readonly returns: GallonReturnService) {}

  @Roles(...CAPABILITIES.courierReturn)
  @Post()
  @ApiOperation({ summary: 'Record an empty-gallon return at delivery handover (courier)' })
  record(
    @Body() dto: CreateCourierReturnDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<GallonReturnRecord> {
    return this.returns.recordFromCourier(
      dto.depotId,
      {
        orderId: dto.orderId,
        customerId: dto.customerId ?? null,
        quantity: dto.quantity,
        condition: dto.condition,
        note: dto.note ?? null,
      },
      user.sub,
    );
  }
}
