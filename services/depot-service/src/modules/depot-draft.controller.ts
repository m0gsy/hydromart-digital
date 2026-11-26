import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Logger, Param, ParseUUIDPipe, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  AuditMutationsInterceptor,
  AuthenticatedUser,
  Can,
  CurrentUser,
  DomainError,
  recordAuditEvent,
} from '@hydromart/platform';

import { DepotDraftListItem, DepotDraftService } from '../application/services/depot-draft.service';
import { Page } from '../application/pagination';
import { DepotRecord } from '../application/ports/depot.repository';
import { DepotDraftRecord } from '../domain/depot-draft';
import { DepotConfigService } from '../config/depot-config.service';
import { ListDepotDraftsQueryDto, RejectDepotDraftDto } from './dto/ai-crm.dto';
import { CreateDepotDto } from './dto/depot.dto';
import { toCreateDepotData } from './depot.controller';

/**
 * HD-21b: what HQ does with the depot drafts the AI web's CRM made (D5: franchiseApplications
 * holders, HEAD_OFFICE and DIREKTUR). A staff screen only: no @ExternalAccess, so the AI token is
 * refused here whoever it belongs to. The decision is the person's, in hydromart.
 */
@ApiTags('Depot drafts')
@ApiBearerAuth()
@Can('franchiseApplications')
@Controller({ path: 'depot-drafts', version: '1' })
export class DepotDraftController {
  private readonly logger = new Logger(DepotDraftController.name);

  constructor(
    private readonly drafts: DepotDraftService,
    private readonly config: DepotConfigService,
  ) {}

  @ApiOkResponse({ description: 'A page of trimmed list items: open drafts first, oldest first, with their age in days.' })
  @Get()
  @ApiOperation({ summary: 'HQ: the depot drafts from the CRM (calon mitra)' })
  list(@Query() q: ListDepotDraftsQueryDto): Promise<Page<DepotDraftListItem>> {
    return this.drafts.list({ page: q.page ?? 1, limit: q.limit ?? 20, status: q.status });
  }

  @ApiOkResponse({ description: 'One depot draft, everything but the replay hash.' })
  @Get(':id')
  @ApiOperation({ summary: 'HQ: one depot draft' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<Omit<DepotDraftRecord, 'requestHash'>> {
    return this.drafts.view(id);
  }

  @ApiOkResponse({ description: 'The draft, REJECTED.' })
  @UseInterceptors(AuditMutationsInterceptor)
  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'HQ: reject a depot draft with a note' })
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectDepotDraftDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Omit<DepotDraftRecord, 'requestHash'>> {
    await this.drafts.reject(id, dto.note, user.sub);
    return this.drafts.view(id);
  }

  /**
   * No AuditMutationsInterceptor here on purpose: it copies the body into the trail, and this body
   * is a whole depot (address, contact phone, bank account). The trail gets the three ids that say
   * what happened; the depot itself is the record of the rest.
   */
  @ApiOkResponse({ description: 'The depot that was created.' })
  @Post(':id/activate')
  @ApiOperation({ summary: 'HQ: create the depot from a draft (same body as a plain depot create)' })
  async activate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateDepotDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DepotRecord> {
    const sink = { authServiceUrl: this.config.authServiceUrl, internalServiceKey: this.config.internalServiceKey };
    let depot: DepotRecord;
    try {
      depot = await this.drafts.activate(id, toCreateDepotData(dto), user.sub);
    } catch (e) {
      // A refusal (4xx) is worth a line too: who tried, and the code that stopped it. The code only.
      const status = e instanceof DomainError ? e.status : e instanceof HttpException ? e.getStatus() : 500;
      if (status >= 400 && status < 500) {
        const code = e instanceof DomainError ? e.code : `HTTP_${status}`;
        await recordAuditEvent(
          sink,
          { action: 'depot.draft.activate.refused', actorId: user.sub, target: id, metadata: { draftId: id, code } },
          this.logger,
        );
      }
      throw e;
    }
    await recordAuditEvent(
      sink,
      {
        action: 'depot.draft.activated',
        actorId: user.sub,
        target: depot.code,
        metadata: { draftId: id, depotId: depot.id, depotCode: depot.code },
      },
      this.logger,
    );
    return depot;
  }
}
