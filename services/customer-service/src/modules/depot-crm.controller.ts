import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Can, AuthenticatedUser, CurrentUser, ImportSummary } from '@hydromart/platform';

import { CustomerImportService } from '../application/services/customer-import.service';
import { DepotCrmService } from '../application/services/depot-crm.service';
import {
  CrmDashboardDto,
  CrmDashboardQueryDto,
  DepotCustomerDetailDto,
  DepotCustomerDto,
  DepotCustomerQueryDto,
  DepotDetailQueryDto,
  SetAddressPinDto,
} from './dto/depot-crm.dto';
import { ImportAddressesDto, ImportCustomersDto } from './dto/customer-import.dto';
import { AddressResponseDto, ImportResponseDto } from './dto/responses.generated.dto';
import type { AddressRecord } from '../application/ports/address.repository';

/** Depot CRM — customer directory scoped to a depot (Depot Operator 6a/7a, Manager 12b). */
@ApiTags('Depot CRM')
@ApiBearerAuth()
@Can('depotCrm')
@Controller({ path: 'customers', version: '1' })
export class DepotCrmController {
  constructor(
    private readonly crm: DepotCrmService,
    private readonly imports: CustomerImportService,
  ) {}

  @ApiOkResponse({ type: ImportResponseDto })
  @Post('import')
  // Narrower than the class-level depotCrm (which HR now holds read-only): importing
  // customers is a depot-staff write. Handler @Roles overrides the class decorator.
  @Can('depotCrmWrite')
  @ApiOperation({ summary: "Bulk-import a depot's customers from the CSV wizard" })
  import(
    @Body() dto: ImportCustomersDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ImportSummary> {
    return this.imports.importCustomers(user, dto.depotId, dto.rows);
  }

  @ApiOkResponse({ type: ImportResponseDto })
  @Post('import-addresses')
  @Can('depotCrmWrite')
  @ApiOperation({ summary: "Bulk-add delivery addresses to a depot's customers (CSV wizard)" })
  importAddresses(
    @Body() dto: ImportAddressesDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ImportSummary> {
    return this.imports.importAddresses(user, dto.depotId, dto.rows);
  }

  // Still a bare array, not a `{ items, total }` envelope: three consoles read this route
  // and every one of them renders the response directly. The bound is in the query itself
  // (W9) — a full page is the signal that another one may exist, same as `nextCursor`.
  @Get('depot')
  @ApiOperation({
    summary: 'List customers associated with a depot (name/phone searchable, paged)',
  })
  @ApiOkResponse({ type: [DepotCustomerDto] })
  listDepotCustomers(@Query() query: DepotCustomerQueryDto): Promise<DepotCustomerDto[]> {
    return this.crm.listDepotCustomers(query.depotId, query.q, query.page, query.limit);
  }

  // Static `crm/dashboard` declared before `:id/...` so it is not captured by the param route.
  @Get('crm/dashboard')
  @ApiOperation({
    summary: 'Depot CRM lifecycle: segment counts, repeat rate, follow-up queue (Fase 4)',
  })
  @ApiOkResponse({ type: CrmDashboardDto })
  crmDashboard(@Query() query: CrmDashboardQueryDto): Promise<CrmDashboardDto> {
    return this.crm.getCrmDashboard(query.depotId);
  }

  // P2-2: a staff correction of where a customer's door is. A write (depotCrmWrite, not the
  // class-level read HR also holds), and the service checks the customer is this depot's own.
  @ApiOkResponse({ type: AddressResponseDto })
  @Patch(':id/addresses/:addressId/location')
  @Can('depotCrmWrite')
  @ApiOperation({ summary: "Set a customer's address pin from coordinates or a Maps link (audited)" })
  setAddressPin(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('addressId', ParseUUIDPipe) addressId: string,
    @Body() dto: SetAddressPinDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AddressRecord> {
    return this.crm.setAddressPin(user, id, addressId, dto.depotId, dto.location);
  }

  @Get(':id/depot-detail')
  @ApiOperation({
    summary: 'Customer detail for the depot CRM: profile, addresses, deposit ledger, recent orders',
  })
  @ApiOkResponse({ type: DepotCustomerDetailDto })
  getDepotDetail(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: DepotDetailQueryDto,
  ): Promise<DepotCustomerDetailDto> {
    return this.crm.getDepotDetail(id, query.depotId);
  }
}
