import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '@hydromart/platform';
import { CAPABILITIES } from '@hydromart/access';

import { DepotCrmService } from '../application/services/depot-crm.service';
import {
  DepotCustomerDetailDto,
  DepotCustomerDto,
  DepotCustomerQueryDto,
  DepotDetailQueryDto,
} from './dto/depot-crm.dto';

/** Depot CRM — customer directory scoped to a depot (Depot Operator 6a/7a, Manager 12b). */
@ApiTags('Depot CRM')
@ApiBearerAuth()
@Roles(...CAPABILITIES.depotCrm)
@Controller({ path: 'customers', version: '1' })
export class DepotCrmController {
  constructor(private readonly crm: DepotCrmService) {}

  @Get('depot')
  @ApiOperation({ summary: 'List customers associated with a depot (name/phone searchable)' })
  @ApiOkResponse({ type: [DepotCustomerDto] })
  listDepotCustomers(@Query() query: DepotCustomerQueryDto): Promise<DepotCustomerDto[]> {
    return this.crm.listDepotCustomers(query.depotId, query.q);
  }

  @Get(':id/depot-detail')
  @ApiOperation({ summary: 'Customer detail for the depot CRM: profile, addresses, deposit ledger, recent orders' })
  @ApiOkResponse({ type: DepotCustomerDetailDto })
  getDepotDetail(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: DepotDetailQueryDto,
  ): Promise<DepotCustomerDetailDto> {
    return this.crm.getDepotDetail(id, query.depotId);
  }
}
