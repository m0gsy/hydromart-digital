import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser, Role, Roles } from '@hydromart/platform';

import { SettlementService } from '../application/services/settlement.service';
import { SettlementRecord } from '../application/ports/settlement.repository';
import { SubmitSettlementDto } from './dto/settlement.dto';
import { SettlementResponseDto } from './dto/responses.generated.dto';

/** Courier-facing COD settlement: deposit a shift's cash, read own history (design 2d/9a). */
@ApiTags('Driver Settlement')
@ApiBearerAuth()
@Roles(Role.STAFF_DEPOT)
@Controller({ path: 'driver/settlement', version: '1' })
export class DriverSettlementController {
  constructor(private readonly settlements: SettlementService) {}

  @ApiOkResponse({ type: SettlementResponseDto, isArray: true })
  @Get()
  @ApiOperation({ summary: "The courier's settlement history, newest first" })
  history(@CurrentUser() user: AuthenticatedUser): Promise<SettlementRecord[]> {
    return this.settlements.listForDriver(user.sub);
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
