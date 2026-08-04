import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Can, CurrentUser, AuthenticatedUser } from '@hydromart/platform';

import { DepotTargetService } from '../application/services/depot-target.service';
import { DepotTarget } from '../domain/depot-target';
import { GetDepotTargetQueryDto, UpsertDepotTargetDto } from './dto/depot-target.dto';
import { DepotTargetResponseDto } from './dto/responses.generated.dto';

/** Per-depot monthly performance targets (manager dashboard). */
@ApiTags('Depot Targets')
@ApiBearerAuth()
@Can('depotTargets')
@Controller({ path: 'depot-targets', version: '1' })
export class DepotTargetController {
  constructor(private readonly targets: DepotTargetService) {}

  @ApiOkResponse({ type: DepotTargetResponseDto })
  @Get()
  @ApiOperation({ summary: "Get a depot's target for a month (or null)" })
  get(@Query() query: GetDepotTargetQueryDto): Promise<DepotTarget | null> {
    return this.targets.get(query.depotId, query.month);
  }

  @ApiOkResponse({ type: DepotTargetResponseDto })
  @Put()
  @ApiOperation({ summary: 'Set (create or overwrite) a depot month target' })
  set(
    @Body() dto: UpsertDepotTargetDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DepotTarget> {
    return this.targets.set(
      {
        depotId: dto.depotId,
        month: dto.month,
        revenueTargetIdr: dto.revenueTargetIdr,
        ordersTarget: dto.ordersTarget,
        slaTargetPct: dto.slaTargetPct,
        newCustomersTarget: dto.newCustomersTarget,
      },
      user.sub,
    );
  }
}
