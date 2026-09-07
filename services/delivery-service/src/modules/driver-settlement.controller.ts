import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, Can, CurrentUser } from '@hydromart/platform';

import { SettlementService } from '../application/services/settlement.service';
import { SettlementRecord } from '../application/ports/settlement.repository';
import { SubmitSettlementDto } from './dto/settlement.dto';
import {
  ExpectedSettlementResponseDto,
  SettlementResponseDto,
} from './dto/responses.generated.dto';

/** Courier-facing COD settlement: deposit a shift's cash, read own history (design 2d/9a). */
@ApiTags('Driver Settlement')
@ApiBearerAuth()
/*
 * O7. `@Roles(STAFF_DEPOT)` — a hard guard, not a capability — meant "who may deposit" was
 * the one half of this flow that could not be administered from the roles screen, while
 * "who may verify" (`courierSettle`) always could. Same list of people as before; the
 * difference is that it is now a row somebody can change.
 *
 * Every route below is still scoped to `user.sub`, so widening the capability widens who
 * may deposit THEIR OWN shift, never who may read another courier's.
 */
@Can('courierDeposit')
@Controller({ path: 'driver/settlement', version: '1' })
export class DriverSettlementController {
  constructor(private readonly settlements: SettlementService) {}

  @ApiOkResponse({ type: SettlementResponseDto, isArray: true })
  @Get()
  @ApiOperation({ summary: "The courier's settlement history, newest first" })
  history(@CurrentUser() user: AuthenticatedUser): Promise<SettlementRecord[]> {
    return this.settlements.listForDriver(user.sub);
  }

  /**
   * CA-4-16 — what the courier is about to be measured against, before they hand over cash.
   *
   * The deposit screen asked for an amount and showed only what the courier typed. The
   * number it is checked against was computed at submit time and never displayed — and any
   * shortfall is debited from their pay. The one figure that decides whether money comes
   * out of their wages was the one figure they could not see.
   *
   * Declared BEFORE `:id` so the static segment wins. Scoped to `user.sub` like every route
   * here, so it can only ever show the caller their own shift.
   */
  @ApiOkResponse({ type: ExpectedSettlementResponseDto })
  @Get('expected/:shiftId')
  @ApiOperation({ summary: "The expected deposit total for one of the courier's own shifts" })
  expected(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('authorization') authorization: string,
    @Param('shiftId', ParseUUIDPipe) shiftId: string,
  ): Promise<{ shiftId: string; expectedIdr: number }> {
    return this.settlements.expectedForShift(user.sub, shiftId, authorization);
  }

  @ApiOkResponse({ type: SettlementResponseDto })
  @Get(':id')
  @ApiOperation({ summary: "Read one of the courier's own settlements" })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SettlementRecord> {
    return this.settlements.getForDriver(user.sub, id);
  }

  @ApiOkResponse({ type: SettlementResponseDto })
  @Post()
  @ApiOperation({ summary: 'Deposit a shift’s COD cash (expected total snapshotted server-side)' })
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('authorization') authorization: string,
    @Body() dto: SubmitSettlementDto,
  ): Promise<SettlementRecord> {
    return this.settlements.submit(user.sub, dto.shiftId, dto.depositedAmount, authorization);
  }
}
