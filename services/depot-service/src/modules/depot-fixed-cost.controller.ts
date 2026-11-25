import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, Can, CurrentUser, ImportSummary } from '@hydromart/platform';

import {
  DepotFixedCostMonth,
  DepotFixedCostService,
} from '../application/services/depot-fixed-cost.service';
import { DepotFixedCostsQueryDto, ImportDepotFixedCostsDto } from './dto/depot-fixed-cost.dto';
import { ImportResponseDto } from './dto/responses.generated.dto';

/** HD-16 (D22): fixed costs per depot, month and category. Finance and head office only. */
@ApiTags('Depot fixed costs')
@ApiBearerAuth()
@Can('depotCostAdmin')
@Controller({ path: 'depot-fixed-costs', version: '1' })
export class DepotFixedCostController {
  constructor(private readonly costs: DepotFixedCostService) {}

  @Get()
  @ApiOperation({ summary: 'The fixed costs of one month, with totals per depot' })
  @ApiOkResponse({ description: 'month, totalIdr, byDepot[], rows[]' })
  list(@Query() query: DepotFixedCostsQueryDto): Promise<DepotFixedCostMonth> {
    return this.costs.list(query.month, query.depotId);
  }

  @Post('import')
  @ApiOperation({ summary: 'Bulk upsert fixed costs from the CSV wizard' })
  @ApiOkResponse({ type: ImportResponseDto })
  import(
    @Body() dto: ImportDepotFixedCostsDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ImportSummary> {
    return this.costs.import(dto.rows, user);
  }
}
