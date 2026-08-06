import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Can, AuthenticatedUser, CurrentUser } from '@hydromart/platform';

import { PerformanceService } from '../application/services/performance.service';
import {
  GeneratePerformanceDto,
  PerformanceDashboardDto,
  PerformanceQueryDto,
  ScorePerformanceDto,
  UpsertPerformanceDto,
} from './dto/performance.dto';
import { PerformanceReview } from '../../prisma/generated/client';
import { ScoredEmployee } from '../application/services/performance.service';
import { PerformanceReviewResponseDto, ScoredEmployeeResponseDto } from './dto/responses.generated.dto';

/** Monthly performance reviews. Read = hrView; write = hrAdmin. */
@ApiTags('HR Performance')
@ApiBearerAuth()
@Controller({ path: 'performance', version: '1' })
export class PerformanceController {
  constructor(private readonly performance: PerformanceService) {}

  @ApiOkResponse({ type: PerformanceReviewResponseDto, isArray: true })
  @Get()
  @Can('hrView')
  @ApiOperation({ summary: 'List an employee’s performance reviews' })
  list(@Query() q: PerformanceQueryDto, @CurrentUser() user: AuthenticatedUser): Promise<PerformanceReview[]> {
    return this.performance.listByEmployee(user, q.employeeId);
  }

  @ApiOkResponse({ type: ScoredEmployeeResponseDto })
  @Get('score')
  @Can('hrView')
  @ApiOperation({ summary: 'Score one employee for a period without saving anything' })
  score(@Query() q: ScorePerformanceDto, @CurrentUser() user: AuthenticatedUser): Promise<ScoredEmployee> {
    return this.performance.score(user, q.employeeId, q.periodMonth);
  }

  @ApiOkResponse({ type: ScoredEmployeeResponseDto, isArray: true })
  @Get('dashboard')
  @Can('hrView')
  @ApiOperation({ summary: 'Score every employee in scope for a period, best first' })
  dashboard(@Query() q: PerformanceDashboardDto, @CurrentUser() user: AuthenticatedUser): Promise<ScoredEmployee[]> {
    return this.performance.dashboard(user, q.periodMonth, q.depotId);
  }

  @ApiOkResponse({ type: PerformanceReviewResponseDto })
  @Post()
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Create or update a performance review for an employee + period' })
  upsert(@Body() dto: UpsertPerformanceDto, @CurrentUser() user: AuthenticatedUser): Promise<PerformanceReview> {
    return this.performance.upsert(user, dto);
  }

  @ApiOkResponse({ type: PerformanceReviewResponseDto })
  @Post('generate')
  @Can('hrAdmin')
  @ApiOperation({ summary: 'Recompute the score from attendance + sales and save the review' })
  generate(@Body() dto: GeneratePerformanceDto, @CurrentUser() user: AuthenticatedUser): Promise<PerformanceReview> {
    return this.performance.generate(user, dto.employeeId, dto.periodMonth, dto.managerNote);
  }
}
