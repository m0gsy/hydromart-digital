import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, AuthenticatedUser, Roles } from '@hydromart/platform';
import { CAPABILITIES } from '@hydromart/access';

import { GallonIssueService } from '../application/services/gallon-issue.service';
import { GallonIssueRecord, GallonIssueSummary } from '../application/ports/gallon-issue.repository';
import { Page } from '../application/pagination';
import { CreateGallonIssueDto, ListIssuesQueryDto } from './dto/gallon-issue.dto';

/** Empty-gallon issues / deposit held nested under a depot (PRD Module 11c). */
@ApiTags('Gallon issues')
@ApiBearerAuth()
@Controller({ path: 'depots/:depotId/gallon-issues', version: '1' })
export class GallonIssueController {
  constructor(private readonly issues: GallonIssueService) {}

  @Roles(...CAPABILITIES.returnsWrite)
  @Post()
  @ApiOperation({ summary: 'Record an empty-gallon issue (staff)' })
  record(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Body() dto: CreateGallonIssueDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<GallonIssueRecord> {
    return this.issues.record(
      depotId,
      {
        customerId: dto.customerId ?? null,
        quantity: dto.quantity,
        depositHeld: dto.depositHeld,
        note: dto.note ?? null,
      },
      user.sub,
    );
  }

  // Static `summary` segment declared before the paginated list so the route is unambiguous.
  @Roles(...CAPABILITIES.returnsRead)
  @Get('summary')
  @ApiOperation({ summary: "A depot's issue totals (count, gallons, deposit held)" })
  summary(@Param('depotId', ParseUUIDPipe) depotId: string): Promise<GallonIssueSummary> {
    return this.issues.summary(depotId);
  }

  @Roles(...CAPABILITIES.returnsRead)
  @Get()
  @ApiOperation({ summary: "List a depot's gallon issues (paginated, newest first)" })
  list(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Query() query: ListIssuesQueryDto,
  ): Promise<Page<GallonIssueRecord>> {
    return this.issues.list(depotId, query.page ?? 1, query.limit ?? 20);
  }
}
