import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser, Role, Roles } from '@hydromart/platform';

import {
  CourierPerformance,
  PerformanceService,
} from '../application/services/performance.service';
import { PerformanceQueryDto } from './dto/performance.dto';

/** Courier weekly performance card — deliveries, rating, SLA, rank vs depot (design 4c). */
@ApiTags('Driver Performance')
@ApiBearerAuth()
@Roles(Role.DRIVER)
@Controller({ path: 'driver/performance', version: '1' })
export class DriverPerformanceController {
  constructor(private readonly performance: PerformanceService) {}

  @Get()
  @ApiOperation({ summary: "The courier's weekly performance roll-up" })
  weekly(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PerformanceQueryDto,
  ): Promise<CourierPerformance> {
    return this.performance.weekly(user.sub, query.weekStart, query.depotId);
  }
}
