import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CAPABILITIES } from '@hydromart/access';
import { AuthenticatedUser, CurrentUser, Roles } from '@hydromart/platform';

import { PerformanceService } from '../application/services/performance.service';
import { PerformanceQueryDto, UpsertPerformanceDto } from './dto/performance.dto';

/** Monthly performance reviews. Read = hrView; write = hrAdmin. */
@ApiTags('HR Performance')
@ApiBearerAuth()
@Controller({ path: 'performance', version: '1' })
export class PerformanceController {
  constructor(private readonly performance: PerformanceService) {}

  @Get()
  @Roles(...CAPABILITIES.hrView)
  @ApiOperation({ summary: 'List an employee’s performance reviews' })
  list(@Query() q: PerformanceQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.performance.listByEmployee(user, q.employeeId);
  }

  @Post()
  @Roles(...CAPABILITIES.hrAdmin)
  @ApiOperation({ summary: 'Create or update a performance review for an employee + period' })
  upsert(@Body() dto: UpsertPerformanceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.performance.upsert(user, dto);
  }
}
