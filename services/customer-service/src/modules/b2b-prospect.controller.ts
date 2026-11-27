import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, Can, CurrentUser } from '@hydromart/platform';

import {
  B2bImportSummary,
  B2bProspectIntakeService,
  IntakeRow,
} from '../application/services/b2b-prospect-intake.service';
import {
  B2bProspectService,
  CoverageReport,
  ProspectDetail,
  ProspectListRow,
} from '../application/services/b2b-prospect.service';
import {
  AssignProspectDto,
  CoverageQueryDto,
  CoverageResponseDto,
  CreateProspectDto,
  ImportProspectsDto,
  ImportProspectsResponseDto,
  MineQueryDto,
  ProspectDetailResponseDto,
  ProspectListPageResponseDto,
  ProspectListQueryDto,
  ProspectMinePageResponseDto,
  ProspectOpenedResponseDto,
  SetOwnerDepotDto,
  SetProspectStatusDto,
  SuppressDto,
  SuppressProspectDto,
  SuppressResultResponseDto,
} from './dto/b2b-prospect.dto';

/**
 * B2B prospects: businesses a depot could sell gallons to (kos, schools, clinics...). Every route
 * carries ONE capability; the reach rule (depot scope, and "only mine" for a role that works but
 * does not manage) lives in the service. Static routes are declared before `:id`.
 */
@ApiTags('B2B prospects')
@ApiBearerAuth()
@Controller({ path: 'b2b-prospects', version: '1' })
export class B2bProspectController {
  constructor(
    private readonly prospects: B2bProspectService,
    private readonly intake: B2bProspectIntakeService,
  ) {}

  @Get()
  @Can('b2bProspectRead')
  @ApiOkResponse({ type: ProspectListPageResponseDto })
  @ApiOperation({ summary: 'List prospects (no phone or contact name); scope=map is the opportunity map, network roles only' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ProspectListQueryDto,
  ): Promise<{ items: ProspectListRow[]; nextCursor: string | null }> {
    return this.prospects.list(user, query);
  }

  @Get('mine')
  @Can('b2bProspectWork')
  @ApiOkResponse({ type: ProspectMinePageResponseDto })
  @ApiOperation({ summary: 'My own work list: prospects assigned to me, with phone' })
  mine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MineQueryDto,
  ): Promise<{ items: ProspectDetail[]; nextCursor: string | null }> {
    return this.prospects.mine(user, query);
  }

  @Get('coverage')
  @Can('b2bProspectRead')
  @ApiOperation({ summary: 'Coverage report: counts only, scoped to the caller' })
  @ApiOkResponse({ type: CoverageResponseDto })
  coverage(@CurrentUser() user: AuthenticatedUser, @Query() query: CoverageQueryDto): Promise<CoverageReport> {
    return this.prospects.coverage(user, query.depotId);
  }

  @Get(':id')
  @Can('b2bProspectWork')
  @ApiOkResponse({ type: ProspectOpenedResponseDto })
  @ApiOperation({ summary: 'Open one prospect (phone and the latest visits)' })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.prospects.get(user, id);
  }

  @Post()
  @Can('b2bProspectManage')
  @ApiCreatedResponse({ type: ProspectDetailResponseDto })
  @ApiOperation({ summary: 'Add a business found in the field (source is always FIELD)' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProspectDto) {
    const { latitude: lat, longitude: lng, ...rest } = dto;
    return this.intake.createField(user, { ...rest, lat, lng });
  }

  @Post('import')
  @HttpCode(200)
  @Can('b2bProspectImport')
  @ApiOkResponse({ type: ImportProspectsResponseDto })
  @ApiOperation({ summary: 'Import an AREA-T candidate file (max 500 rows); dryRun=true writes nothing' })
  import(@CurrentUser() user: AuthenticatedUser, @Body() dto: ImportProspectsDto): Promise<B2bImportSummary> {
    return this.intake.importFile(user, {
      dryRun: dto.dryRun,
      costIdr: dto.costIdr ?? 0,
      rows: dto.rows as unknown as IntakeRow[],
    });
  }

  @Post('do-not-contact')
  @HttpCode(200)
  @Can('b2bProspectWork')
  @ApiOkResponse({ type: SuppressResultResponseDto })
  @ApiOperation({ summary: 'Put a phone, or a business name at a pin, on the permanent do-not-contact list' })
  suppress(@CurrentUser() user: AuthenticatedUser, @Body() dto: SuppressDto) {
    return this.prospects.suppress(user, dto);
  }

  @Patch(':id/status')
  @Can('b2bProspectWork')
  @ApiOkResponse({ type: ProspectDetailResponseDto })
  @ApiOperation({ summary: 'Move a prospect along (not to CONVERTED or DO_NOT_CONTACT: they have their own routes)' })
  setStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetProspectStatusDto,
  ): Promise<ProspectDetail> {
    return this.prospects.setStatus(user, id, dto);
  }

  @Patch(':id/assign')
  @Can('b2bProspectManage')
  @ApiOkResponse({ type: ProspectDetailResponseDto })
  @ApiOperation({ summary: 'Assign a prospect to a staff member of its owner depot, or unassign' })
  assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignProspectDto,
  ): Promise<ProspectDetail> {
    return this.prospects.assign(user, id, dto.assigneeId);
  }

  @Patch(':id/owner-depot')
  @Can('b2bProspectReassign')
  @ApiOkResponse({ type: ProspectDetailResponseDto })
  @ApiOperation({ summary: 'HQ arbitration: set the owner depot (or none: the map); audited' })
  setOwnerDepot(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetOwnerDepotDto,
  ): Promise<ProspectDetail> {
    return this.prospects.setOwnerDepot(user, id, dto);
  }

  @Post(':id/do-not-contact')
  @HttpCode(200)
  @Can('b2bProspectWork')
  @ApiOkResponse({ type: ProspectDetailResponseDto })
  @ApiOperation({ summary: 'This prospect refused: terminal, and phone, contact, note and address are wiped' })
  suppressProspect(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuppressProspectDto,
  ): Promise<ProspectDetail> {
    return this.prospects.suppressProspect(user, id, dto.reason);
  }
}
