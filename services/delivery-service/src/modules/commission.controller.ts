import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Can, addLocalMonths, startOfLocalMonth } from '@hydromart/platform';

import { CommissionRun, CommissionService } from '../application/services/commission.service';
import { DeliveryConfigService } from '../config/delivery-config.service';
import { CommissionQueryDto } from './dto/commission.dto';

/**
 * Default window: the WIB calendar month [first-of-month, first-of-next-month).
 *
 * H-16: these were `Date.UTC(...)` bounds, which begin and end at 07:00 WIB — so the
 * default "this month" silently dropped the first seven hours of the 1st and picked up
 * the first seven hours of the next 1st.
 */
function monthWindow(now: Date, timeZone: string): { from: Date; to: Date } {
  const from = startOfLocalMonth(now, timeZone);
  return { from, to: addLocalMonths(from, 1, timeZone) };
}

/** Depot courier commission summary (design 11c). Reuses the cashier settlement gate so
 * depot operators/managers + finance can read their couriers' pay run. */
@ApiTags('Commission')
@ApiBearerAuth()
@Can('courierSettle')
@Controller({ path: 'commission', version: '1' })
export class CommissionController {
  constructor(
    private readonly commission: CommissionService,
    private readonly config: DeliveryConfigService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Per-courier commission for a depot over a window (design 11c)' })
  run(@Query() q: CommissionQueryDto): Promise<CommissionRun> {
    const month = monthWindow(new Date(), this.config.businessTimeZone);
    const from = q.from ? new Date(q.from) : month.from;
    const to = q.to ? new Date(q.to) : month.to;
    return this.commission.run(q.depotId, from, to);
  }
}
