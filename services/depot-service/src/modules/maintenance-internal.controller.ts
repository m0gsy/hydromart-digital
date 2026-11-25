import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, localDayKey, Public } from '@hydromart/platform';

import { MaintenanceService } from '../application/services/maintenance.service';

/** One due item, as crm-service reads it for the "maintenance due" notification (HD-15). */
export interface DueMaintenanceRow {
  id: string;
  depotId: string;
  depotName: string;
  name: string;
  category: string;
  dueBy: 'DAYS' | 'VOLUME';
  daysSinceService: number;
  m3SinceService: number | null;
  intervalDays: number | null;
  intervalM3: number | null;
  /** The service the cycle starts from (WIB day key of the last service, else the day it was added). */
  cycleStart: string;
}

/** Service-to-service: what is due or overdue across the network (internal key only). */
@ApiTags('Maintenance')
@Controller({ path: 'internal/maintenance', version: '1' })
export class MaintenanceInternalController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @ApiOkResponse({ description: '`{ items: DueMaintenanceRow[] }`: every item due by days or by volume, closed depots left out.' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('due')
  @ApiOperation({ summary: 'Maintenance items due by days or water volume (internal service auth)' })
  async due(): Promise<{ items: DueMaintenanceRow[] }> {
    const rows = await this.maintenance.due();
    return {
      items: rows.map((i) => ({
        id: i.id,
        depotId: i.depotId,
        depotName: i.depotName,
        name: i.name,
        category: i.category,
        dueBy: i.dueBy!,
        daysSinceService: i.daysSinceService,
        m3SinceService: i.m3SinceService,
        intervalDays: i.intervalDays,
        intervalM3: i.intervalM3,
        cycleStart: localDayKey(i.lastServicedAt ?? i.createdAt),
      })),
    };
  }
}
