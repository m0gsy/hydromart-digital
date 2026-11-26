import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuditMutationsInterceptor, AuthenticatedUser, Can, CurrentUser } from '@hydromart/platform';

import { DepotDraftService } from '../application/services/depot-draft.service';
import { Page } from '../application/pagination';
import { DepotRecord } from '../application/ports/depot.repository';
import { DepotDraftRecord } from '../domain/depot-draft';
import { ListDepotDraftsQueryDto, RejectDepotDraftDto } from './dto/ai-crm.dto';
import { CreateDepotDto } from './dto/depot.dto';
import { toCreateDepotData } from './depot.controller';

/**
 * HD-21b: what HQ does with the depot drafts the AI web's CRM made (D5: franchiseApplications
 * holders, HEAD_OFFICE and DIREKTUR). A staff screen only: no @ExternalAccess, so the AI token
 * is refused here whoever it belongs to. The decision is the person's, in hydromart.
 */
@ApiTags('Depot drafts')
@ApiBearerAuth()
@Can('franchiseApplications')
@Controller({ path: 'depot-drafts', version: '1' })
export class DepotDraftController {
  constructor(private readonly drafts: DepotDraftService) {}

  @ApiOkResponse({ description: 'A page of depot drafts, DRAFT first, newest first.' })
  @Get()
  @ApiOperation({ summary: 'HQ: the depot drafts from the CRM (calon mitra)' })
  list(@Query() q: ListDepotDraftsQueryDto): Promise<Page<DepotDraftRecord>> {
    return this.drafts.list({ page: q.page ?? 1, limit: q.limit ?? 20, status: q.status });
  }

  @ApiOkResponse({ description: 'One depot draft.' })
  @Get(':id')
  @ApiOperation({ summary: 'HQ: one depot draft' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<DepotDraftRecord> {
    return this.drafts.get(id);
  }

  @ApiOkResponse({ description: 'The draft, REJECTED.' })
  @UseInterceptors(AuditMutationsInterceptor)
  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'HQ: reject a depot draft with a note' })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectDepotDraftDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DepotDraftRecord> {
    return this.drafts.reject(id, dto.note, user.sub);
  }

  @ApiOkResponse({ description: 'The depot that was created.' })
  @UseInterceptors(AuditMutationsInterceptor)
  @Post(':id/activate')
  @ApiOperation({ summary: 'HQ: create the depot from a draft (same body as a plain depot create)' })
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateDepotDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DepotRecord> {
    return this.drafts.activate(id, toCreateDepotData(dto), user.sub);
  }
}
