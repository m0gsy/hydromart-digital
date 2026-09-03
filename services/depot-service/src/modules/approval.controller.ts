import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Can, CurrentUser, AuthenticatedUser, assertDepotAccess } from '@hydromart/platform';

import { ApprovalService } from '../application/services/approval.service';
import { Approval } from '../domain/approval';
import {
  CountsApprovalQueryDto,
  CreateApprovalDto,
  DecideApprovalDto,
  ListApprovalQueryDto,
} from './dto/approval.dto';
import { PendingCounts } from '../application/ports/approval.repository';
import { ApprovalResponseDto, CountsResponseDto } from './dto/responses.generated.dto';

/** Depot-manager approval queue (design 1c/2a-2c/10c/12a). */
@ApiTags('Approvals')
@ApiBearerAuth()
@Can('approvals')
@Controller({ path: 'approvals', version: '1' })
export class ApprovalController {
  constructor(private readonly approvals: ApprovalService) {}

  @ApiOkResponse({ type: ApprovalResponseDto })
  @Post()
  @ApiOperation({ summary: 'Raise an approval item (auto-passes under the depot threshold)' })
  create(
    @Body() dto: CreateApprovalDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Approval> {
    return this.approvals.create(
      {
        depotId: dto.depotId,
        type: dto.type,
        title: dto.title,
        subjectRef: dto.subjectRef ?? null,
        amountIdr: dto.amountIdr,
        payload: dto.payload,
      },
      user.sub,
    );
  }

  @ApiOkResponse({ type: ApprovalResponseDto, isArray: true })
  @Get()
  @ApiOperation({ summary: "List a depot's approval items (newest first), optional status filter" })
  list(@Query() query: ListApprovalQueryDto): Promise<Approval[]> {
    return this.approvals.list(query.depotId, query.status);
  }

  @ApiOkResponse({ type: CountsResponseDto })
  @Get('counts')
  @ApiOperation({ summary: 'Pending approval counts by type (queue badge)' })
  counts(
    @Query() query: CountsApprovalQueryDto,
  ): Promise<{ total: number; byType: PendingCounts }> {
    return this.approvals.counts(query.depotId);
  }

  @ApiOkResponse({ type: ApprovalResponseDto })
  @Get(':id')
  @ApiOperation({ summary: 'Get one approval item' })
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Approval> {
    const approval = await this.approvals.get(id);
    assertDepotAccess(user, approval.depotId);
    return approval;
  }

  @ApiOkResponse({ type: ApprovalResponseDto })
  @Patch(':id/decide')
  @ApiOperation({ summary: 'Decide an approval item: APPROVE / REJECT / HOLD' })
  async decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideApprovalDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Approval> {
    assertDepotAccess(user, (await this.approvals.get(id)).depotId);
    return this.approvals.decide(id, dto.decision, dto.note ?? null, user.sub);
  }
}
