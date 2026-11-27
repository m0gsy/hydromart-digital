import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, Can, CurrentUser, InternalAuthGuard, Public } from '@hydromart/platform';

import {
  B2bImportSummary,
  B2bProspectIntakeService,
  IntakeRow,
} from '../application/services/b2b-prospect-intake.service';
import { B2bProspectExportService } from '../application/services/b2b-prospect-export.service';
import { B2bProspectMaintenanceService } from '../application/services/b2b-prospect-maintenance.service';
import { B2bProspectVisitService } from '../application/services/b2b-prospect-visit.service';
import {
  B2bProspectService,
  CoverageReport,
  ProspectDetail,
  ProspectListRow,
} from '../application/services/b2b-prospect.service';
import {
  AssigneeResponseDto,
  AssigneesQueryDto,
  AssignProspectDto,
  ConvertProspectDto,
  CoverageQueryDto,
  CoverageResponseDto,
  CreateProspectDto,
  ExportProspectsDto,
  ExportResponseDto,
  ImportProspectsDto,
  ImportProspectsResponseDto,
  MineQueryDto,
  ProspectDetailResponseDto,
  ProspectListPageResponseDto,
  ProspectListQueryDto,
  ProspectMinePageResponseDto,
  ProspectOpenedResponseDto,
  PurgeProspectsDto,
  PurgeProspectsResponseDto,
  RecomputeOwnersResponseDto,
  SetOwnerDepotDto,
  SetProspectStatusDto,
  SuppressDto,
  SuppressProspectDto,
  SuppressResultResponseDto,
  VisitProspectDto,
  VisitResponseDto,
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
    private readonly visits: B2bProspectVisitService,
    private readonly exporter: B2bProspectExportService,
    private readonly maintenance: B2bProspectMaintenanceService,
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

  @Get('assignees')
  @Can('b2bProspectManage')
  @ApiOkResponse({ type: [AssigneeResponseDto] })
  @ApiOperation({ summary: 'Staff of one depot, name only (no phone): the assign picker' })
  assignees(@CurrentUser() user: AuthenticatedUser, @Query() query: AssigneesQueryDto) {
    return this.prospects.assignees(user, query.depotId);
  }

  @Get(':id')
  @Can('b2bProspectWork')
  @ApiOkResponse({ type: ProspectOpenedResponseDto })
  @ApiOperation({ summary: 'Open one prospect (phone and the latest visits)' })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.prospects.get(user, id);
  }

  @Post()
  @Can('b2bProspectWork')
  @ApiCreatedResponse({ type: ProspectDetailResponseDto })
  @ApiOperation({ summary: 'Add a business found in the field (source is always FIELD); a Work-only caller must own the depot and gets the row assigned' })
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

  @Post('export')
  @HttpCode(200)
  @Can('b2bProspectExport')
  @ApiOkResponse({ type: ExportResponseDto })
  @ApiOperation({ summary: 'Rows to export (max 5000, own depot for a depot role); audited first, 503 and no rows when the audit fails' })
  export(@CurrentUser() user: AuthenticatedUser, @Body() dto: ExportProspectsDto) {
    return this.exporter.export(user, dto);
  }

  @Post('recompute-owners')
  @HttpCode(200)
  @Can('b2bProspectImport')
  @ApiOkResponse({ type: RecomputeOwnersResponseDto })
  @ApiOperation({ summary: 'Monthly refresh: re-run the owner-depot rule for system-placed rows (never HQ-set, converted or do-not-contact)' })
  recomputeOwners(@CurrentUser() user: AuthenticatedUser) {
    return this.maintenance.recomputeOwners(user);
  }

  /*
   * Retention (UU PDP): 12 months without salesperson activity. `@Public()` + InternalAuthGuard: the caller is
   * admin-service's nightly sweep with the shared internal key, not a console session. Declared before ':id'.
   */
  @Post('internal/purge')
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @HttpCode(200)
  @ApiOkResponse({ type: PurgeProspectsResponseDto })
  @ApiOperation({ summary: 'Delete idle prospects and anonymise idle converted ones older than the cutoff (internal)' })
  purge(@Body() dto: PurgeProspectsDto) {
    return this.maintenance.purge(new Date(dto.cutoff));
  }

  @Post('do-not-contact')
  @HttpCode(200)
  @Can('b2bProspectManage')
  @ApiOkResponse({ type: SuppressResultResponseDto })
  @ApiOperation({ summary: 'Put a phone, or a business name at a pin, on the permanent do-not-contact list (global; the count answered is inside your reach)' })
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
    return this.prospects.assign(user, id, dto.assigneeId, dto.seenUpdatedAt);
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

  @Post(':id/visits')
  @Can('b2bProspectWork')
  @ApiCreatedResponse({ type: VisitResponseDto })
  @ApiOperation({ summary: 'GPS check-in at the prospect (within the visit radius, accurate fix only)' })
  visit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VisitProspectDto,
  ) {
    return this.visits.visit(user, id, dto);
  }

  @Post(':id/convert')
  @HttpCode(200)
  @Can('b2bProspectWork')
  @ApiOkResponse({ type: ProspectDetailResponseDto })
  @ApiOperation({ summary: 'The prospect became a customer (idempotent); a customerId is needed when it has no mobile number' })
  convert(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConvertProspectDto,
  ): Promise<ProspectDetail> {
    return this.prospects.convert(user, id, dto.customerId);
  }
}
