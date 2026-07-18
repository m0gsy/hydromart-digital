import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CAPABILITIES } from '@hydromart/access';
import { Roles } from '@hydromart/platform';

import { CommissionRun, CommissionService } from '../application/services/commission.service';
import { CommissionQueryDto } from './dto/commission.dto';

/** UTC calendar-month bounds [first-of-month, first-of-next-month). */
function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
function nextMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/** Depot courier commission summary (design 11c). Reuses the cashier settlement gate so
 * depot operators/managers + finance can read their couriers' pay run. */
@ApiTags('Commission')
@ApiBearerAuth()
@Roles(...CAPABILITIES.courierSettle)
@Controller({ path: 'commission', version: '1' })
export class CommissionController {
  constructor(private readonly commission: CommissionService) {}

  @Get()
  @ApiOperation({ summary: 'Per-courier commission for a depot over a window (design 11c)' })
  run(@Query() q: CommissionQueryDto): Promise<CommissionRun> {
    const now = new Date();
    const from = q.from ? new Date(q.from) : monthStart(now);
    const to = q.to ? new Date(q.to) : nextMonthStart(now);
    return this.commission.run(q.depotId, from, to);
  }
}
