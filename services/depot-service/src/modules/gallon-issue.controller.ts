import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, AuthenticatedUser, Role, Roles } from '@hydromart/platform';

import { GallonIssueService } from '../application/services/gallon-issue.service';
import { GallonIssueRecord, GallonIssueSummary } from '../application/ports/gallon-issue.repository';
import { Page } from '../application/pagination';
import { CreateGallonIssueDto, ListIssuesQueryDto } from './dto/gallon-issue.dto';

// Recording an issue is a depot-floor action (operators + managers). Viewing adds
// head-office oversight and the franchise owner (their own depots). Server-authoritative.
const ISSUE_WRITE_ROLES = [Role.DEPOT_OPERATOR, Role.DEPOT_MANAGER, Role.SUPER_ADMIN] as const;
const ISSUE_READ_ROLES = [
  Role.DEPOT_OPERATOR,
  Role.DEPOT_MANAGER,
  Role.HEAD_OFFICE,
  Role.FRANCHISE_OWNER,
  Role.SUPER_ADMIN,
] as const;

/** Empty-gallon issues / deposit held nested under a depot (PRD Module 11c). */
@ApiTags('Gallon issues')
@ApiBearerAuth()
@Controller({ path: 'depots/:depotId/gallon-issues', version: '1' })
export class GallonIssueController {
  constructor(private readonly issues: GallonIssueService) {}

  @Roles(...ISSUE_WRITE_ROLES)
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
  @Roles(...ISSUE_READ_ROLES)
  @Get('summary')
  @ApiOperation({ summary: "A depot's issue totals (count, gallons, deposit held)" })
  summary(@Param('depotId', ParseUUIDPipe) depotId: string): Promise<GallonIssueSummary> {
    return this.issues.summary(depotId);
  }

  @Roles(...ISSUE_READ_ROLES)
  @Get()
  @ApiOperation({ summary: "List a depot's gallon issues (paginated, newest first)" })
  list(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Query() query: ListIssuesQueryDto,
  ): Promise<Page<GallonIssueRecord>> {
    return this.issues.list(depotId, query.page ?? 1, query.limit ?? 20);
  }
}
