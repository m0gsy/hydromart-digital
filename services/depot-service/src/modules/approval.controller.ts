import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, AuthenticatedUser, Roles } from '@hydromart/platform';
import { CAPABILITIES } from '@hydromart/access';

import { ApprovalService } from '../application/services/approval.service';
import { Approval } from '../domain/approval';
import {
  CountsApprovalQueryDto,
  CreateApprovalDto,
  DecideApprovalDto,
  ListApprovalQueryDto,
} from './dto/approval.dto';

/** Depot-manager approval queue (design 1c/2a-2c/10c/12a). */
@ApiTags('Approvals')
@ApiBearerAuth()
@Roles(...CAPABILITIES.approvals)
@Controller({ path: 'approvals', version: '1' })
export class ApprovalController {
  constructor(private readonly approvals: ApprovalService) {}

  @Post()
  @ApiOperation({ summary: 'Raise an approval item (auto-passes under the depot threshold)' })
  create(@Body() dto: CreateApprovalDto, @CurrentUser() user: AuthenticatedUser): Promise<Approval> {
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

  @Get()
  @ApiOperation({ summary: "List a depot's approval items (newest first), optional status filter" })
  list(@Query() query: ListApprovalQueryDto): Promise<Approval[]> {
    return this.approvals.list(query.depotId, query.status);
  }

  @Get('counts')
  @ApiOperation({ summary: 'Pending approval counts by type (queue badge)' })
  counts(@Query() query: CountsApprovalQueryDto) {
    return this.approvals.counts(query.depotId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one approval item' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<Approval> {
    return this.approvals.get(id);
  }

  @Patch(':id/decide')
  @ApiOperation({ summary: 'Decide an approval item: APPROVE / REJECT / HOLD' })
  decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideApprovalDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Approval> {
    return this.approvals.decide(id, dto.decision, dto.note ?? null, user.sub);
  }
}
