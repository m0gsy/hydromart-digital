import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedUser,
  Can,
  CurrentUser,
  InternalAuthGuard,
  Public,
  recordAuditEvent,
} from '@hydromart/platform';

import {
  AiGrantsOfRole,
  LegalEntityDirectory,
  LegalEntityService,
} from '../application/services/legal-entity.service';
import { AssignedDepot } from '../application/ports/legal-entity.repository';
import { DepotConfigService } from '../config/depot-config.service';
import { LegalEntityNotFoundError } from '../domain/errors';
import {
  BankAccount,
  DepotLegalEntityHistory,
  LegalEntity,
  bankAccountOf,
  parseCalendarDay,
} from '../domain/legal-entity';
import {
  AssignDepotsDto,
  AiGrantsOfRoleResponseDto,
  AssignedDepotResponseDto,
  DepotEntitiesQueryDto,
  DepotEntitiesResponseDto,
  EntityKindsQueryDto,
  EntityKindsResponseDto,
  CreateLegalEntityDto,
  DepotLegalEntityHistoryResponseDto,
  LegalEntityDirectoryResponseDto,
  LegalEntityResponseDto,
  LegalEntitySummaryResponseDto,
  RemovePointQueryDto,
  SetAiGrantsDto,
  UpdateLegalEntityDto,
} from './dto/legal-entity.dto';

type LegalEntitySummary = Pick<LegalEntity, 'id' | 'name' | 'kind' | 'active'> & { bankAccount: BankAccount | null; aiReadRoles?: string[] };

const summaryOf = (e: LegalEntity): LegalEntitySummary => ({
  id: e.id,
  name: e.name,
  kind: e.kind,
  active: e.active,
  bankAccount: bankAccountOf(e),
});

/**
 * HD-5 — /hq/legal-entities. Head office enters the legal entities and dates which one each
 * depot belongs to (`legalEntityAdmin`); the superuser decides which role reads which entity in
 * the AI web (`legalEntityAiAccess`). Every write leaves an audit line with what changed.
 */
@ApiTags('Legal entities')
@Controller({ path: 'legal-entities', version: '1' })
export class LegalEntityController {
  private readonly logger = new Logger(LegalEntityController.name);

  constructor(
    private readonly entities: LegalEntityService,
    private readonly config: DepotConfigService,
  ) {}

  @ApiOkResponse({ type: LegalEntityDirectoryResponseDto })
  @ApiBearerAuth()
  @Can('legalEntityAdmin')
  @Get()
  @ApiOperation({ summary: 'Every legal entity with its AI-web readers, and the roles the matrix can name' })
  directory(): Promise<LegalEntityDirectory> {
    return this.entities.directory();
  }

  @ApiOkResponse({ type: LegalEntityResponseDto })
  @ApiBearerAuth()
  @Can('legalEntityAdmin')
  @Post()
  @ApiOperation({ summary: 'Add a legal entity' })
  async create(
    @Body() dto: CreateLegalEntityDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LegalEntity> {
    const created = await this.entities.create(dto, user.sub);
    await this.audit('legal_entity.create', user, created.name, {
      legalEntityId: created.id,
      kind: created.kind,
    });
    return created;
  }

  @ApiOkResponse({ type: LegalEntityResponseDto })
  @ApiBearerAuth()
  @Can('legalEntityAdmin')
  @Patch(':id')
  @ApiOperation({ summary: 'Rename, re-kind or switch off a legal entity' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLegalEntityDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LegalEntity> {
    // `seenUpdatedAt` is the version the form read, not a column: it stops here.
    const { seenUpdatedAt, ...patch } = dto;
    const { before, after, changed } = await this.entities.update(id, patch, seenUpdatedAt, user.sub);
    if (!after) return before;
    await this.audit('legal_entity.update', user, after.name, { legalEntityId: id, changed });
    return after;
  }

  @ApiOkResponse({ type: LegalEntityDirectoryResponseDto })
  @ApiBearerAuth()
  @Can('legalEntityAiAccess')
  @Put('ai-grants')
  @ApiOperation({ summary: 'Set cells of the role x legal entity matrix (AI web and AI read API only)' })
  async setAiGrants(
    @Body() dto: SetAiGrantsDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LegalEntityDirectory> {
    const applied = await this.entities.setAiGrants(dto.changes, user.sub);
    await this.audit('legal_entity.ai_grants.update', user, `${applied.length} cell(s)`, {
      changes: applied.map((c) => ({ legalEntityId: c.legalEntityId, roleKey: c.roleKey, granted: c.granted })),
    });
    return this.entities.directory();
  }

  @ApiOkResponse({ type: DepotLegalEntityHistoryResponseDto, isArray: true })
  @ApiBearerAuth()
  @Can('legalEntityAdmin')
  @Get('depots')
  @ApiOperation({ summary: 'Every depot with its dated legal-entity points, newest first' })
  depotHistories(): Promise<DepotLegalEntityHistory[]> {
    return this.entities.depotHistories();
  }

  @ApiOkResponse({ type: AssignedDepotResponseDto, isArray: true })
  @ApiBearerAuth()
  @Can('legalEntityAdmin')
  @Post('depots')
  @ApiOperation({ summary: 'From a date, these depots belong to this legal entity (same date = a correction)' })
  async assignDepots(
    @Body() dto: AssignDepotsDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AssignedDepot[]> {
    const effectiveFrom = parseCalendarDay(dto.effectiveFrom);
    if (!effectiveFrom) throw new BadRequestException('effectiveFrom must be a calendar day (YYYY-MM-DD)');
    const written = await this.entities.assignDepots(
      { depotIds: dto.depotIds, legalEntityId: dto.legalEntityId, effectiveFrom, seen: dto.seen },
      user.sub,
    );
    if (written.length > 0) {
      await this.audit('legal_entity.depots.assign', user, dto.legalEntityId, {
        legalEntityId: dto.legalEntityId,
        effectiveFrom: dto.effectiveFrom,
        depots: written,
      });
    }
    return written;
  }

  @ApiOkResponse({ description: 'No content.' })
  @ApiBearerAuth()
  @Can('legalEntityAdmin')
  @Delete('depots/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Take back one dated legal-entity point of a depot' })
  async removeDepotPoint(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: RemovePointQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    const removed = await this.entities.removeDepotPoint(id, query.legalEntityId);
    await this.audit('legal_entity.depots.remove', user, removed.legalEntityId, {
      depotId: removed.depotId,
      legalEntityId: removed.legalEntityId,
      effectiveFrom: removed.effectiveFrom,
    });
  }

  /**
   * Service-to-service (HD-6, dashboard-service's AI read API): the legal entity each of these
   * depots belonged to over a period. Declared before `internal/:id` so the static segment wins.
   */
  @ApiOkResponse({ type: DepotEntitiesResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @Get('internal/depot-entities')
  @ApiOperation({ summary: 'Internal: legal entity of each depot over [from, to], W-06 rule' })
  async internalDepotEntities(@Query() query: DepotEntitiesQueryDto): Promise<DepotEntitiesResponseDto> {
    const from = parseCalendarDay(query.from);
    const to = parseCalendarDay(query.to);
    if (!from || !to) throw new BadRequestException('from and to must be calendar days (YYYY-MM-DD)');
    if (from > to) throw new BadRequestException('from is after to');
    return { spans: await this.entities.entityTimeline(query.depotIds, from, to) };
  }

  /** Service-to-service (HD-23, payout-service): the franchisor and its official account; 404 = none entered. */
  @ApiOkResponse({ type: LegalEntitySummaryResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @Get('internal/franchisor')
  @ApiOperation({ summary: 'Internal: the franchisor legal entity with its official bank account' })
  async internalFranchisor(): Promise<LegalEntitySummary> {
    const found = await this.entities.franchisor();
    if (!found) throw new LegalEntityNotFoundError();
    return summaryOf(found);
  }

  /** Service-to-service (HD-6 H5): the kind of each of these entities, for the HKP / waralaba split by date. */
  @ApiOkResponse({ type: EntityKindsResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @Get('internal/kinds')
  @ApiOperation({ summary: 'Internal: the kind of each legal entity named (1 to 100 ids)' })
  async internalKinds(@Query() query: EntityKindsQueryDto): Promise<EntityKindsResponseDto> {
    return { entities: await this.entities.kinds(query.ids) };
  }

  /** Service-to-service (HD-6): what a role may read in the AI web. SUPER_ADMIN reads every entity. */
  @ApiOkResponse({ type: AiGrantsOfRoleResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @Get('internal/ai-grants/:roleKey')
  @ApiOperation({ summary: 'Internal: the legal entities a role key is granted in the AI web' })
  internalAiGrants(@Param('roleKey') roleKey: string): Promise<AiGrantsOfRole> {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(roleKey)) throw new BadRequestException('roleKey is not a role key');
    return this.entities.aiGrantsFor(roleKey);
  }

  /**
   * Service-to-service: hr-service checks that an employee is being given a legal entity that
   * exists and is active. 404 = no such entity.
   */
  @ApiOkResponse({ type: LegalEntitySummaryResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @Get('internal/:id')
  @ApiOperation({ summary: 'Internal: name, kind, on/off and AI-read roles of one legal entity' })
  async internalSummary(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LegalEntitySummary> {
    // AI-26: crm-service picks who is told of a weekly report from the roles granted here.
    return { ...summaryOf(await this.entities.get(id)), aiReadRoles: await this.entities.aiReadRolesOf(id) };
  }

  /** Fail-open like every depot-service trail: a saved change is not undone because the trail was down. */
  private async audit(
    action: string,
    user: AuthenticatedUser,
    target: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await recordAuditEvent(
      { authServiceUrl: this.config.authServiceUrl, internalServiceKey: this.config.internalServiceKey },
      { action, actorId: user.sub, target, metadata },
      this.logger,
    );
  }
}
